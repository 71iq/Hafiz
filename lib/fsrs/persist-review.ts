import type { AppDatabase } from "@/lib/database/types";
import { insertStudyLog, updateCard } from "@/lib/fsrs/queries";
import type { ReviewTransition } from "@/lib/fsrs/review-transition";

/** Preserve ordered card/log writes and propagate their existing partial-save failures. */
export async function persistReviewTransition({
  db,
  cardId,
  transition,
}: {
  db: AppDatabase;
  cardId: string;
  transition: ReviewTransition;
}): Promise<void> {
  await updateCard(db, transition.updatedCard);
  const { reviewRecord } = transition;
  await insertStudyLog(
    db,
    cardId,
    reviewRecord.rating,
    reviewRecord.state,
    reviewRecord.due,
    reviewRecord.stability,
    reviewRecord.difficulty,
    reviewRecord.elapsedDays,
    reviewRecord.scheduledDays,
    reviewRecord.reviewedAt,
  );
}
