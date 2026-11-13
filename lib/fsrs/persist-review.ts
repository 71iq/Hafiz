import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { publishReviewLogged, putCardRow, putStudyLogRow, type StudyLogInput } from "@/lib/fsrs/queries";
import type { ReviewTransition } from "@/lib/fsrs/review-transition";
import { recordSessionProgress, type ReviewSessionRef } from "@/lib/fsrs/review-sessions";
import type { DhuhrResolver } from "@/lib/habit/cutoff";
import { localDateOf } from "@/lib/habit/dates";
import { recordWirdProgress, type WirdProgressEvent } from "@/lib/habit/queries";
import { insertRecitationErrors, recordCleanRecitation, type RecitationErrorInput } from "@/lib/hifz/errors";
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

export type ReviewSaveResult = Readonly<{ wird: WirdProgressEvent; resolvedInboxItems: number }>;

/** ERR-03: only a Good or Easy recall at the hidden level with no new errors counts; salah has no check. */
function isCleanRecall(rating: number, context: ReviewSaveContext): boolean {
  return rating >= 3 && context.errors.length === 0 && context.supportLevel === 4 && context.grader !== "salah";
}

/**
 * Save a calculated review (DB-01). The updated card, its review log, the attempt's errors, the
 * session counters, the day's wird status and every queued upload commit together or not at all, so
 * a failed grade leaves the streak, the inbox and the card as they were. Achievements and review
 * listeners run only after the commit.
 */
export async function persistReviewTransition({
  db,
  cardId,
  transition,
  context = DEFAULT_REVIEW_SAVE_CONTEXT,
  extraWork,
}: {
  db: AppDatabase;
  cardId: string;
  transition: ReviewTransition;
  context?: ReviewSaveContext;
  /** Writes that belong to this grade, such as a manzil cycle completing, run inside its transaction. */
  extraWork?: (tx: DatabaseExecutor) => Promise<void>;
}): Promise<ReviewSaveResult> {
  const { reviewRecord } = transition;
  const log: StudyLogInput = {
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
  };
  const reviewedAt = new Date(reviewRecord.reviewedAt);
  const localDate = localDateOf(reviewedAt);
  let result: ReviewSaveResult = { wird: { kind: "none" }, resolvedInboxItems: 0 };
  await db.withTransactionAsync(async (tx) => {
    await putCardRow(tx, transition.updatedCard);
    await putStudyLogRow(tx, log);
    if (context.errors.length > 0) {
      await insertRecitationErrors(tx, {
        cardId,
        sessionId: context.session?.id ?? null,
        errors: context.errors,
        at: reviewRecord.reviewedAt,
        localDate,
      });
    }
    const resolvedInboxItems = isCleanRecall(reviewRecord.rating, context)
      ? await recordCleanRecitation(tx, { cardId, at: reviewRecord.reviewedAt, localDate })
      : 0;
    if (extraWork) await extraWork(tx);
    const wird = await recordWirdProgress(tx, { now: reviewedAt, sessionId: context.session?.id ?? null, dhuhr: context.dhuhr });
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
    result = { wird, resolvedInboxItems };
  });
  publishReviewLogged(db, log);
  return result;
}
