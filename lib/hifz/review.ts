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
import { verseRef, type RecitationErrorInput, type RecitationErrorType, type VerseKey } from "@/lib/hifz/errors";
import { capRating, proposeRating, type AttemptEvents, type Rating, type SupportLevel } from "@/lib/hifz/grading";
import type { PageLine, PageToken, RecitationPage } from "@/lib/hifz/page-data";
import type { HifzPlan } from "@/lib/hifz/plan";
import {
  derivePageTiers,
  ensureManzilCycleStart,
  loadPageCard,
  MANZIL_CYCLE_START_KEY,
  readMemorizedPageNumbers,
  T_REV_KEY,
} from "@/lib/hifz/pages";
import { isManzil, pagePolicy, tierFor, type PageHistory, type Tier } from "@/lib/hifz/tiers";
import { errorHalf, hasSeamAfter, remediateHalf, remediationPolicy, reviewSeam, type Half } from "@/lib/hifz/remediation";
import { HIFZ_PAGES_DECK_ID, pageCardId, parsePageUnit } from "@/lib/hifz/units";
import { bringSimilarCardsForward, pickDriftSibling, similarGroupsForAyahs } from "@/lib/hifz/similar";

export type AttemptMark = Readonly<{ token: PageToken; type: RecitationErrorType }>;

export type Attempt = Readonly<{
  level: SupportLevel;
  peeked: readonly PageToken[];
  shown: readonly PageToken[];
  slips: number;
  marks: ReadonlyMap<string, AttemptMark>;
  seam: SeamResult | null;
}>;

export type SeamResult = Readonly<{ clean: boolean; surah: number; ayah: number }>;

export function emptyAttempt(level: SupportLevel): Attempt {
  return { level, peeked: [], shown: [], slips: 0, marks: new Map(), seam: null };
}

function errorTokens(attempt: Attempt): PageToken[] {
  return [...[...attempt.marks.values()].map((mark) => mark.token), ...attempt.peeked, ...attempt.shown];
}

export function nextHiddenWord(tokens: readonly PageToken[], from: number): number {
  for (let index = Math.max(0, from); index < tokens.length; index += 1) {
    if (!tokens[index].isMarker) return index;
  }
  return -1;
}

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

export type HalfAttempts = Readonly<{ a: Attempt; b: Attempt }>;

export function combineHalves({ a, b }: HalfAttempts): Attempt {
  return {
    level: Math.min(a.level, b.level) as SupportLevel,
    peeked: [...a.peeked, ...b.peeked],
    shown: [...a.shown, ...b.shown],
    slips: a.slips + b.slips,
    marks: new Map([...a.marks, ...b.marks]),
    seam: b.seam,
  };
}

export function proposedHalvesRating(halves: HalfAttempts): 0 | Rating {
  const a = proposedRating(halves.a);
  const b = proposedRating(halves.b);
  return a === 0 || b === 0 ? 0 : (Math.min(a, b) as Rating);
}

function location(token: PageToken): Pick<RecitationErrorInput, "surah" | "ayah" | "word"> {
  return { surah: token.surah, ayah: token.ayah, word: token.wordPos };
}

export function attemptErrors(
  attempt: Attempt,
  firstToken: PageToken,
  driftSiblings: ReadonlyMap<string, string> = new Map(),
): RecitationErrorInput[] {
  const errors: RecitationErrorInput[] = [
    ...attempt.peeked.map((token) => ({ type: "skip_word" as const, corrected: "tanbih" as const, ...location(token) })),
    ...attempt.shown.map((token) => ({ type: "skip_word" as const, corrected: "fath" as const, ...location(token) })),
    ...[...attempt.marks.values()].map((mark) =>
      mark.type === "mutashabih_drift"
        ? { type: mark.type, corrected: "none" as const, ...location(mark.token), siblingRef: driftSiblings.get(verseRef(mark.token)) ?? null }
        : { type: mark.type, corrected: "none" as const, ...location(mark.token) },
    ),
  ];
  for (let i = 0; i < attempt.slips; i += 1) {
    errors.push({ type: "wrong_word", corrected: "self", surah: firstToken.surah, ayah: null, word: null });
  }
  if (attempt.seam && !attempt.seam.clean) {
    errors.push({ type: "seam", corrected: "none", surah: attempt.seam.surah, ayah: attempt.seam.ayah, word: null });
  }
  return errors;
}

function driftedAyahs(attempt: Attempt): Map<string, VerseKey> {
  const drifted = new Map<string, VerseKey>();
  for (const mark of attempt.marks.values()) {
    if (mark.type === "mutashabih_drift") drifted.set(verseRef(mark.token), { surah: mark.token.surah, ayah: mark.token.ayah });
  }
  return drifted;
}

async function readPageStability(db: DatabaseExecutor, pages: readonly number[]): Promise<Map<number, number>> {
  if (pages.length === 0) return new Map();
  const rows = await db.getAllAsync<{ id: string; stability: number }>(
    `SELECT id, stability FROM study_cards WHERE id IN (${pages.map(() => "?").join(", ")}) AND deleted_at IS NULL`,
    pages.map(pageCardId),
  );
  return new Map(
    rows.flatMap((row): [number, number][] => {
      const unit = parsePageUnit(row.id);
      return unit?.kind === "page" ? [[unit.page, row.stability]] : [];
    }),
  );
}

async function resolveDriftSiblings(db: DatabaseExecutor, attempt: Attempt): Promise<Map<string, string>> {
  const siblings = new Map<string, string>();
  const drifted = driftedAyahs(attempt);
  if (drifted.size === 0) return siblings;
  const memorized = await readMemorizedPageNumbers(db);
  for (const [key, ayah] of drifted) {
    const groups = await similarGroupsForAyahs(db, [ayah]);
    const pages = [...new Set(groups.flatMap((group) => group.siblings.map((sibling) => sibling.page)))].filter((page) => memorized.has(page));
    const sibling = pickDriftSibling(groups, memorized, await readPageStability(db, pages));
    if (sibling) siblings.set(key, verseRef(sibling));
  }
  return siblings;
}

async function bringDriftCardsForward(tx: DatabaseExecutor, attempt: Attempt, now: Date): Promise<void> {
  for (const ayah of driftedAyahs(attempt).values()) await bringSimilarCardsForward(tx, { ...ayah, now });
}

export { MANZIL_CYCLE_START_KEY };

async function completeManzilCycleIfDone(
  db: DatabaseExecutor,
  now: Date,
  plan: Pick<HifzPlan, "sabqiDays">,
): Promise<boolean> {
  const today = localDateOf(now);
  const [pages, lastReviews] = await Promise.all([
    db.getAllAsync<{ id: string; tier: string | null; created_at: string }>(
      "SELECT id, tier, created_at FROM study_cards WHERE deck_id = ? AND id LIKE 'page:%' AND deleted_at IS NULL AND suspended_at IS NULL",
      [HIFZ_PAGES_DECK_ID],
    ),
    db.getAllAsync<{ card_id: string; last: LocalDate | null }>(
      "SELECT card_id, MAX(local_date) AS last FROM study_log WHERE card_id LIKE 'page:%' GROUP BY card_id",
    ),
  ]);
  const uncertain = pages.filter((page) => !page.tier?.startsWith("manzil")).map((page) => page.id);
  const derived = await derivePageTiers(db, uncertain, { today, plan });
  const manzil = pages.filter((page) => {
    const tier = derived.get(page.id) ?? page.tier;
    return tier !== null && tier !== undefined && tier.startsWith("manzil");
  });
  if (manzil.length === 0) return false;
  const start = await ensureManzilCycleStart(db, manzil.map((page) => localDateOf(new Date(page.created_at))).sort()[0]);
  if (start > today) return false;
  const last = new Map(lastReviews.map((row) => [row.card_id, row.last]));
  const complete = manzil.every((page) => {
    const reviewed = last.get(page.id);
    return reviewed !== null && reviewed !== undefined && reviewed >= start;
  });
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

type PageRecitation =
  | Readonly<{ attempt: Attempt; halves?: undefined }>
  | Readonly<{ halves: HalfAttempts; attempt?: undefined }>;

export type PageGradeInput = PageRecitation & Readonly<{
  card: StudyCardRow;
  history: PageHistory;
  plan: HifzPlan;
  rating: Grade;
  firstToken: PageToken;
  session: ReviewSessionRef | null;
  firstGradeInSession?: boolean;
  durationMs: number;
  grader?: "self" | "salah" | "teacher";
  now?: Date;
  dhuhr?: DhuhrResolver;
  page?: RecitationPage | null;
}>;

export type PageRemediation = Readonly<{ half: Half | null; seam: "clean" | "lapsed" | null }>;

export async function savePageGrade(
  db: AppDatabase,
  input: PageGradeInput,
): Promise<ReviewSaveResult & { tier: Tier; remediation: PageRemediation }> {
  const now = input.now ?? new Date();
  const today: LocalDate = localDateOf(now);
  const attempt = input.halves ? combineHalves(input.halves) : input.attempt;
  const level = attempt.level;
  const rating = input.grader === "salah" ? input.rating : (capRating(input.rating as Rating, level) as Grade);
  const base = await readDeckReviewSettings(db, HIFZ_PAGES_DECK_ID);
  let after = null as Tier | null;
  const proposed =
    input.grader === "salah" ? null : input.halves ? proposedHalvesRating(input.halves) : proposedRating(attempt);
  const recited = input.grader !== "salah";
  const page = parsePageUnit(input.card.id);
  const pageNumber = page?.kind === "page" ? page.page : null;
  const half = recited && rating === 1 && input.page ? errorHalf(input.page, errorTokens(attempt)) : null;
  const seamStumbled = attempt.seam?.clean === false || [...attempt.marks.values()].some((mark) => mark.type === "seam");
  const seam: PageRemediation["seam"] =
    !recited || pageNumber === null || !hasSeamAfter(pageNumber)
      ? null
      : seamStumbled
        ? "lapsed"
        : attempt.seam?.clean && rating >= 3
          ? "clean"
          : null;
  const driftSiblings = recited ? await resolveDriftSiblings(db, attempt) : new Map<string, string>();
  const result = await persistReviewTransition({
    db,
    cardId: input.card.id,
    transition: async (tx) => {
      const current = await loadPageCard(tx, input.card.id, { today, plan: input.plan });
      const card = current?.row ?? input.card;
      const history = current?.history ?? input.history;
      const transition = calculateReviewTransition({
        card,
        rating,
        reviewedAt: now,
        reviewPolicy: pagePolicy(tierFor(history, today, input.plan), input.plan, base),
      });
      const tier = tierFor({ ...history, grades: [...history.grades, { date: today, rating }] }, today, input.plan);
      after = tier;
      const updatedCard: StudyCardRow = {
        ...transition.updatedCard,
        tier,
        tier_changed_at: tier === card.tier ? (card.tier_changed_at ?? null) : now.toISOString(),
      };
      return { ...transition, updatedCard };
    },
    context: {
      session: input.session,
      firstGradeInSession: input.firstGradeInSession ?? true,
      durationMs: input.durationMs,
      supportLevel: input.grader === "salah" ? null : level,
      proposedRating: proposed === 0 ? null : proposed,
      grader: input.grader ?? "self",
      errors: input.grader === "salah" ? [] : attemptErrors(attempt, input.firstToken, driftSiblings),
      dhuhr: input.dhuhr,
    },
    extraWork: async (tx) => {
      if (after !== null && isManzil(after)) await completeManzilCycleIfDone(tx, now, input.plan);
      if (half && pageNumber !== null) await remediateHalf(tx, { page: pageNumber, half, now });
      if (seam && pageNumber !== null) await reviewSeam(tx, { page: pageNumber, clean: seam === "clean", now });
      if (recited) await bringDriftCardsForward(tx, attempt, now);
    },
  });
  if (after === null) throw new Error("The page grade was saved without its tier.");
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

export async function saveRemediationGrade(db: AppDatabase, input: RemediationGradeInput): Promise<ReviewSaveResult> {
  const now = input.now ?? new Date();
  const level = input.attempt.level;
  const rating = capRating(input.rating as Rating, level) as Grade;
  const base = await readDeckReviewSettings(db, HIFZ_PAGES_DECK_ID);
  const proposed = proposedRating(input.attempt);
  const driftSiblings = await resolveDriftSiblings(db, input.attempt);
  return persistReviewTransition({
    db,
    cardId: input.card.id,
    transition: async (tx) => {
      const current =
        (await tx.getFirstAsync<StudyCardRow>("SELECT * FROM study_cards WHERE id = ? AND deleted_at IS NULL", [input.card.id])) ??
        input.card;
      return calculateReviewTransition({ card: current, rating, reviewedAt: now, reviewPolicy: remediationPolicy(base) });
    },
    context: {
      session: input.session,
      firstGradeInSession: true,
      durationMs: input.durationMs,
      supportLevel: level,
      proposedRating: proposed === 0 ? null : proposed,
      grader: input.grader ?? "self",
      errors: input.firstToken ? attemptErrors(input.attempt, input.firstToken, driftSiblings) : [],
      dhuhr: input.dhuhr,
    },
    extraWork: (tx) => bringDriftCardsForward(tx, input.attempt, now),
  });
}

export async function recordReviewPace(db: AppDatabase, { minutes, pages, current }: { minutes: number; pages: number; current: number }): Promise<void> {
  if (pages <= 0 || !Number.isFinite(minutes) || minutes <= 0) return;
  const measured = Math.min(30, Math.max(0.5, minutes / pages));
  const next = Math.round((0.8 * current + 0.2 * measured) * 100) / 100;
  await db.withTransactionAsync((tx) => putUserSetting(tx, T_REV_KEY, String(next)));
}
