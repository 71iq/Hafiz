import type { AppDatabase } from "@/lib/database/types";
import { publishReviewLogged, putCardRow, putStudyLogRow, type StudyLogInput } from "@/lib/fsrs/queries";
import type { ReviewTransition } from "@/lib/fsrs/review-transition";

/**
 * Save a calculated review. The updated card, its review log and both queued uploads commit
 * together or not at all; achievements and review listeners run only after the commit.
 */
export async function persistReviewTransition({
  db,
  cardId,
  transition,
}: {
  db: AppDatabase;
  cardId: string;
  transition: ReviewTransition;
}): Promise<void> {
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
  };
  await db.withTransactionAsync(async (tx) => {
    await putCardRow(tx, transition.updatedCard);
    await putStudyLogRow(tx, log);
  });
  publishReviewLogged(db, log);
}
