import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { publishReviewLogged, putCardRow, putStudyLogRow, type StudyLogInput } from "@/lib/fsrs/queries";
import type { ReviewTransition } from "@/lib/fsrs/review-transition";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { recordSessionProgress, type ReviewSessionRef } from "@/lib/fsrs/review-sessions";
import type { DhuhrResolver } from "@/lib/habit/cutoff";
import { localDateOf } from "@/lib/habit/dates";
import { makeUpTarget, recordWirdProgress, type WirdProgressEvent } from "@/lib/habit/queries";
import { readDhuhrResolver } from "@/lib/prayer/settings";
import { insertRecitationErrors, recordCleanRecitation, type RecitationErrorInput } from "@/lib/hifz/errors";
import { createWeakSpotCards } from "@/lib/hifz/weak-spots";
import type { Grader, SupportLevel } from "@/lib/hifz/grading";
import { PAGE_UNITS, recitationUnits } from "@/lib/habit/minimum";

/** What the screen knows about a grade beyond the scheduling transition. */
export type ReviewSaveContext = Readonly<{
  session: ReviewSessionRef | null;
  /** Counts the card once in the session summary, on its first grade. */
  firstGradeInSession: boolean;
  durationMs: number | null;
  supportLevel: SupportLevel | null;
  proposedRating: number | null;
  grader: Grader;
  errors: readonly RecitationErrorInput[];
  dhuhr?: DhuhrResolver;
}>;

export const DEFAULT_REVIEW_SAVE_CONTEXT: ReviewSaveContext = {
  session: null,
  firstGradeInSession: true,
  durationMs: null,
  supportLevel: null,
  proposedRating: null,
  grader: "self",
  errors: [],
};

export type ReviewSaveResult = Readonly<{
  wird: WirdProgressEvent;
  resolvedInboxItems: number;
  /** The transition that was saved, calculated from the card as it was inside the transaction. */
  transition: ReviewTransition;
}>;

/**
 * The card as it is now, for a transition calculated inside the grade's transaction. A screen's copy
 * can be older: sync or another grade may have updated the card since its queue was loaded. Null when
 * the card is gone; saving a transition for it then fails with StudyCardDeletedError.
 */
export async function readCurrentCard(tx: DatabaseExecutor, cardId: string): Promise<StudyCardRow | null> {
  return tx.getFirstAsync<StudyCardRow>("SELECT * FROM study_cards WHERE id = ? AND deleted_at IS NULL", [cardId]);
}

/** ERR-03: only a Good or Easy recall at the hidden level with no new errors counts; salah has no check. */
function isCleanRecall(rating: number, context: ReviewSaveContext): boolean {
  return rating >= 3 && context.errors.length === 0 && context.supportLevel === 4 && context.grader !== "salah";
}

/**
 * Save a calculated review (DB-01). The updated card, its review log, the attempt's errors, the
 * session counters, the day's wird status and every queued upload commit together or not at all, so
 * a failed grade leaves the streak, the inbox and the card as they were. Achievements and review
 * listeners run only after the commit.
 *
 * `transition` can be a function of the transaction, for a caller whose card sync or another grade may
 * have changed since it was read: it then reads the card and calculates inside the same transaction.
 * The result carries the transition that was saved.
 */
export async function persistReviewTransition({
  db,
  cardId,
  transition,
  context = DEFAULT_REVIEW_SAVE_CONTEXT,
  extraWork,
  beforeWork,
}: {
  db: AppDatabase;
  cardId: string;
  transition: ReviewTransition | ((tx: DatabaseExecutor) => Promise<ReviewTransition>);
  context?: ReviewSaveContext;
  /** Writes that belong to this grade, such as a manzil cycle completing, run inside its transaction. */
  extraWork?: (tx: DatabaseExecutor) => Promise<void>;
  /** Writes that must exist before the card is saved, such as creating it, run first in the transaction. */
  beforeWork?: (tx: DatabaseExecutor) => Promise<void>;
}): Promise<ReviewSaveResult> {
  let saved = null as { result: ReviewSaveResult; log: StudyLogInput } | null;
  await db.withTransactionAsync(async (tx) => {
    if (beforeWork) await beforeWork(tx);
    const resolved = typeof transition === "function" ? await transition(tx) : transition;
    await putCardRow(tx, resolved.updatedCard);
    const { reviewRecord } = resolved;
    const reviewedAt = new Date(reviewRecord.reviewedAt);
    const localDate = localDateOf(reviewedAt);
    const dhuhr = context.dhuhr ?? (await readDhuhrResolver(tx));
    // STR-07, STR-08: decided before the log is written and stored on it, so every device credits
    // this review to the same day.
    const makeupFor = await makeUpTarget(tx, { now: reviewedAt, dhuhr });
    const entry: StudyLogInput = {
      cardId,
      rating: reviewRecord.rating,
      state: reviewRecord.state,
      due: reviewRecord.due,
      stability: reviewRecord.stability,
      difficulty: reviewRecord.difficulty,
      elapsedDays: reviewRecord.elapsedDays,
      scheduledDays: reviewRecord.scheduledDays,
      reviewedAt: reviewRecord.reviewedAt,
      sessionId: context.session?.id ?? null,
      durationMs: context.durationMs,
      supportLevel: context.supportLevel,
      proposedRating: context.proposedRating,
      grader: context.grader,
      errorCount: context.errors.length,
      makeupFor,
    };
    await putStudyLogRow(tx, entry);
    if (context.errors.length > 0) {
      await insertRecitationErrors(tx, {
        cardId,
        sessionId: context.session?.id ?? null,
        errors: context.errors,
        at: reviewRecord.reviewedAt,
        localDate,
      });
      // ERR-06: a word wrong in a third session becomes a weak spot with its own cloze card.
      await createWeakSpotCards(tx, context.errors, reviewedAt);
    }
    const resolvedInboxItems = isCleanRecall(reviewRecord.rating, context)
      ? await recordCleanRecitation(tx, { cardId, at: reviewRecord.reviewedAt, localDate })
      : 0;
    if (extraWork) await extraWork(tx);
    const wird = await recordWirdProgress(tx, { now: reviewedAt, sessionId: context.session?.id ?? null, dhuhr, makeupFor });
    if (context.session) {
      const isPage = recitationUnits(cardId) === PAGE_UNITS && cardId.startsWith("page:");
      await recordSessionProgress(
        tx,
        context.session,
        {
          cards: context.firstGradeInSession ? 1 : 0,
          pages: context.firstGradeInSession && isPage ? 1 : 0,
          cleanPages: context.firstGradeInSession && isPage && reviewRecord.rating >= 3 && context.errors.length === 0 ? 1 : 0,
          errors: context.errors.length,
          minimumMet: wird.kind !== "none",
        },
        reviewedAt,
      );
    }
    saved = { result: { wird, resolvedInboxItems, transition: resolved }, log: entry };
  });
  if (!saved) throw new Error("The review transaction ended without saving the grade.");
  publishReviewLogged(db, saved.log);
  return saved.result;
}
