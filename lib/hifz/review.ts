import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import { persistReviewTransition, type ReviewSaveResult } from "@/lib/fsrs/persist-review";
import { readDeckReviewSettings } from "@/lib/fsrs/queries";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import type { ReviewSessionRef } from "@/lib/fsrs/review-sessions";
import type { Grade } from "@/lib/fsrs/scheduler";
import type { StudyCardRow } from "@/lib/fsrs/types";
import type { DhuhrResolver } from "@/lib/habit/cutoff";
import { addDays, deviceTimeZone, localDateOf, type LocalDate } from "@/lib/habit/dates";
import { putHabitDay } from "@/lib/habit/queries";
import type { RecitationErrorInput, RecitationErrorType } from "@/lib/hifz/errors";
import { capRating, proposeRating, type AttemptEvents, type Rating, type SupportLevel } from "@/lib/hifz/grading";
import type { PageLine, PageToken, RecitationPage } from "@/lib/hifz/page-data";
import type { HifzPlan } from "@/lib/hifz/plan";
import { T_REV_KEY } from "@/lib/hifz/pages";
import { isManzil, pagePolicy, tierFor, type PageHistory, type Tier } from "@/lib/hifz/tiers";
import { errorHalf, hasSeamAfter, remediateHalf, remediationPolicy, reviewSeam, type Half } from "@/lib/hifz/remediation";
import { HIFZ_PAGES_DECK_ID, parsePageUnit } from "@/lib/hifz/units";
import { bringSimilarCardsForward } from "@/lib/hifz/similar";

/** One location in a recitation attempt, as the user marked or revealed it. */
export type AttemptMark = Readonly<{ token: PageToken; type: RecitationErrorType }>;

/** Everything that happened while reciting one page (GRD-01). */
export type Attempt = Readonly<{
  level: SupportLevel;
  /** Peek: words revealed one at a time to notice an error (tanbih). */
  peeked: readonly PageToken[];
  /** Show me: the first word of each reveal of the rest of a line (fath). */
  shown: readonly PageToken[];
  slips: number;
  /** Mistakes the user marked on words after Done, keyed by token key. */
  marks: ReadonlyMap<string, AttemptMark>;
  /** SCH-06: how the recitation continued into the next page's first ayah, when the user checked it. */
  seam: SeamResult | null;
}>;

export type SeamResult = Readonly<{ clean: boolean; surah: number; ayah: number }>;

export function emptyAttempt(level: SupportLevel): Attempt {
  return { level, peeked: [], shown: [], slips: 0, marks: new Map(), seam: null };
}

/** The words an attempt went wrong on: marked, peeked at, or shown (SCH-08 uses their lines). */
export function errorTokens(attempt: Attempt): PageToken[] {
  return [...[...attempt.marks.values()].map((mark) => mark.token), ...attempt.peeked, ...attempt.shown];
}

/** The index of the next hidden word at or after `from`, skipping ayah markers, or -1. */
export function nextHiddenWord(tokens: readonly PageToken[], from: number): number {
  for (let index = Math.max(0, from); index < tokens.length; index += 1) {
    if (!tokens[index].isMarker) return index;
  }
  return -1;
}

/** One past the last token of the line holding token `index`, in a flattened list of lines. */
export function endOfLineAt(lines: readonly PageLine[], index: number): number {
  let start = 0;
  for (const line of lines) {
    const end = start + line.tokens.length;
    if (index < end) return end;
    start = end;
  }
  return start;
}

export function attemptEvents(attempt: Attempt): AttemptEvents {
  const marks = [...attempt.marks.values()];
  const jali = marks.filter((mark) => mark.type !== "tajweed" && mark.type !== "hesitation");
  return {
    fath: attempt.shown.length,
    tanbih: attempt.peeked.length,
    selfCorrected: attempt.slips,
    uncorrectedJali: jali.filter((mark) => mark.type !== "skip_ayah" && mark.type !== "seam" && mark.type !== "mutashabih_drift").length,
    skippedAyah: jali.some((mark) => mark.type === "skip_ayah"),
    seamFailed: jali.some((mark) => mark.type === "seam") || attempt.seam?.clean === false,
    driftUnnoticed: jali.some((mark) => mark.type === "mutashabih_drift"),
    longHesitations: marks.filter((mark) => mark.type === "hesitation").length,
  };
}

export function proposedRating(attempt: Attempt): 0 | Rating {
  return proposeRating(attemptEvents(attempt), attempt.level, { fluent: false });
}

function location(token: PageToken): Pick<RecitationErrorInput, "surah" | "ayah" | "word"> {
  return { surah: token.surah, ayah: token.ayah, word: token.wordPos };
}

/** ERR-01: the errors to log for an attempt. Slips have no word position; they use the page's first ayah. */
export function attemptErrors(attempt: Attempt, firstToken: PageToken): RecitationErrorInput[] {
  const errors: RecitationErrorInput[] = [
    ...attempt.peeked.map((token) => ({ type: "skip_word" as const, corrected: "tanbih" as const, ...location(token) })),
    ...attempt.shown.map((token) => ({ type: "skip_word" as const, corrected: "fath" as const, ...location(token) })),
    ...[...attempt.marks.values()].map((mark) => ({ type: mark.type, corrected: "none" as const, ...location(mark.token) })),
  ];
  for (let i = 0; i < attempt.slips; i += 1) {
    errors.push({ type: "wrong_word", corrected: "self", surah: firstToken.surah, ayah: null, word: null });
  }
  if (attempt.seam && !attempt.seam.clean) {
    errors.push({ type: "seam", corrected: "none", surah: attempt.seam.surah, ayah: attempt.seam.ayah, word: null });
  }
  return errors;
}

export const MANZIL_CYCLE_START_KEY = "hifz_manzil_cycle_start";

/**
 * MST-04: a manzil cycle completes on the day every manzil page has a graded review dated on or
 * after the cycle start. That day's wird is marked (it feeds board points) and the next cycle starts
 * tomorrow. Runs inside the grade transaction.
 */
export async function completeManzilCycleIfDone(db: DatabaseExecutor, now: Date): Promise<boolean> {
  const today = localDateOf(now);
  const startRow = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [MANZIL_CYCLE_START_KEY]);
  const pages = await db.getAllAsync<{ id: string; tier: string | null; last_review: string | null; created_at: string }>(
    "SELECT id, tier, last_review, created_at FROM study_cards WHERE deck_id = ? AND id LIKE 'page:%' AND deleted_at IS NULL AND suspended_at IS NULL",
    [HIFZ_PAGES_DECK_ID],
  );
  const manzil = pages.filter((page) => page.tier !== null && page.tier.startsWith("manzil"));
  if (manzil.length === 0) return false;
  const start =
    startRow?.value ??
    manzil.map((page) => localDateOf(new Date(page.created_at))).sort()[0];
  if (start > today) return false;
  const complete = manzil.every((page) => page.last_review !== null && localDateOf(new Date(page.last_review)) >= start);
  if (!complete) return false;
  const at = now.toISOString();
  await putHabitDay(db, {
    local_date: today,
    status: null,
    earned_status: null,
    reason: null,
    excuse_updated_at: null,
    minimum_met: 0,
    full_met: 0,
    manzil_cycle_completed: 1,
    source_session_id: null,
    credited_through: null,
    tz: deviceTimeZone(now),
    created_at: at,
    updated_at: at,
  });
  await putUserSetting(db, MANZIL_CYCLE_START_KEY, addDays(today, 1));
  return true;
}

export type PageGradeInput = Readonly<{
  card: StudyCardRow;
  history: PageHistory;
  plan: HifzPlan;
  attempt: Attempt;
  rating: Grade;
  firstToken: PageToken;
  session: ReviewSessionRef | null;
  durationMs: number;
  grader?: "self" | "salah" | "teacher";
  now?: Date;
  dhuhr?: DhuhrResolver;
  /** The page as recited, to find which half held the errors (SCH-08). */
  page?: RecitationPage | null;
}>;

/** What a page grade called up on its own: a half page to relearn (SCH-08) and the seam's review (SCH-06). */
export type PageRemediation = Readonly<{ half: Half | null; seam: "clean" | "lapsed" | null }>;

/**
 * Save one page grade (DB-01): the FSRS step under the page's tier policy, the review log with its
 * support level and the rubric's proposal, the attempt's errors, the new cached tier, a manzil cycle
 * completing, and the day's wird, in one transaction.
 */
export async function savePageGrade(
  db: AppDatabase,
  input: PageGradeInput,
): Promise<ReviewSaveResult & { tier: Tier; remediation: PageRemediation }> {
  const now = input.now ?? new Date();
  const today: LocalDate = localDateOf(now);
  const level = input.attempt.level;
  const rating = input.grader === "salah" ? input.rating : (capRating(input.rating as Rating, level) as Grade);
  const before = tierFor(input.history, today, input.plan);
  const base = await readDeckReviewSettings(db, HIFZ_PAGES_DECK_ID);
  const transition = calculateReviewTransition({
    card: input.card,
    rating,
    reviewedAt: now,
    reviewPolicy: pagePolicy(before, input.plan, base),
  });
  const after = tierFor({ ...input.history, grades: [...input.history.grades, { date: today, rating }] }, today, input.plan);
  const updatedCard: StudyCardRow = {
    ...transition.updatedCard,
    tier: after,
    tier_changed_at: after === input.card.tier ? (input.card.tier_changed_at ?? null) : now.toISOString(),
  };
  const proposed = input.grader === "salah" ? null : proposedRating(input.attempt);
  const recited = input.grader !== "salah";
  const page = parsePageUnit(input.card.id);
  const pageNumber = page?.kind === "page" ? page.page : null;
  // SCH-08: an Again with every error in one half relearns that half from 10 minutes.
  const half = recited && rating === 1 && input.page ? errorHalf(input.page, errorTokens(input.attempt)) : null;
  // SCH-06: a clean continuation counts for the seam after a Good or Easy page; a stumble always does.
  const seamStumbled =
    input.attempt.seam?.clean === false || [...input.attempt.marks.values()].some((mark) => mark.type === "seam");
  const seam: PageRemediation["seam"] =
    !recited || pageNumber === null || !hasSeamAfter(pageNumber)
      ? null
      : seamStumbled
        ? "lapsed"
        : input.attempt.seam?.clean && rating >= 3
          ? "clean"
          : null;
  const result = await persistReviewTransition({
    db,
    cardId: input.card.id,
    transition: { ...transition, updatedCard },
    context: {
      session: input.session,
      firstGradeInSession: true,
      durationMs: input.durationMs,
      supportLevel: input.grader === "salah" ? null : level,
      proposedRating: proposed === 0 ? null : proposed,
      grader: input.grader ?? "self",
      errors: input.grader === "salah" ? [] : attemptErrors(input.attempt, input.firstToken),
      dhuhr: input.dhuhr,
    },
    extraWork: async (tx) => {
      if (isManzil(after)) await completeManzilCycleIfDone(tx, now);
      if (half && pageNumber !== null) await remediateHalf(tx, { page: pageNumber, half, now });
      if (seam && pageNumber !== null) await reviewSeam(tx, { page: pageNumber, clean: seam === "clean", now });
      // SCH-07, MUT-04: a drift into a similar verse brings that pair's cards due within a day.
      if (input.grader !== "salah") {
        for (const mark of input.attempt.marks.values()) {
          if (mark.type === "mutashabih_drift") await bringSimilarCardsForward(tx, { surah: mark.token.surah, ayah: mark.token.ayah, now });
        }
      }
    },
  });
  return { ...result, tier: after, remediation: { half: pageNumber === null ? null : half, seam } };
}

export type RemediationGradeInput = Readonly<{
  card: StudyCardRow;
  rating: Grade;
  attempt: Attempt;
  firstToken: PageToken | null;
  session: ReviewSessionRef | null;
  durationMs: number;
  grader?: "self" | "teacher";
  now?: Date;
  dhuhr?: DhuhrResolver;
}>;

/**
 * Grade a half page or seam that surfaced on its own (SCH-06, SCH-08). It is real recitation, so it
 * logs a review and counts toward the wird like any card.
 */
export async function saveRemediationGrade(db: AppDatabase, input: RemediationGradeInput): Promise<ReviewSaveResult> {
  const now = input.now ?? new Date();
  const level = input.attempt.level;
  const rating = capRating(input.rating as Rating, level) as Grade;
  const base = await readDeckReviewSettings(db, HIFZ_PAGES_DECK_ID);
  const transition = calculateReviewTransition({
    card: input.card,
    rating,
    reviewedAt: now,
    reviewPolicy: remediationPolicy(base),
  });
  const proposed = proposedRating(input.attempt);
  return persistReviewTransition({
    db,
    cardId: input.card.id,
    transition,
    context: {
      session: input.session,
      firstGradeInSession: true,
      durationMs: input.durationMs,
      supportLevel: level,
      proposedRating: proposed === 0 ? null : proposed,
      grader: input.grader ?? "self",
      errors: input.firstToken ? attemptErrors(input.attempt, input.firstToken) : [],
      dhuhr: input.dhuhr,
    },
  });
}

/** PLN-05: minutes per review page learned as an exponential moving average, alpha 0.2. */
export async function recordReviewPace(db: AppDatabase, { minutes, pages, current }: { minutes: number; pages: number; current: number }): Promise<void> {
  if (pages <= 0 || !Number.isFinite(minutes) || minutes <= 0) return;
  const measured = Math.min(30, Math.max(0.5, minutes / pages));
  const next = Math.round((0.8 * current + 0.2 * measured) * 100) / 100;
  await db.withTransactionAsync((tx) => putUserSetting(tx, T_REV_KEY, String(next)));
}
