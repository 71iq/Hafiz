import { localStartOfTomorrow } from "@/lib/date";
import { gradeCard, State, type Card, type Grade } from "@/lib/fsrs/scheduler";
import type { DeckReviewSettings, StudyCardRow } from "@/lib/fsrs/types";

export type ReviewRecord = Readonly<{
  rating: Grade;
  state: State;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reviewedAt: string;
}>;

export type ReviewTransition = Readonly<{
  updatedCard: StudyCardRow;
  reviewRecord: ReviewRecord;
  shouldRequeueToday: boolean;
}>;

export type ReviewTransitionInput = Readonly<{
  card: StudyCardRow;
  rating: Grade;
  reviewedAt: Date;
  reviewPolicy?: DeckReviewSettings;
}>;

export function calculateReviewTransition({
  card,
  rating,
  reviewedAt,
  reviewPolicy,
}: ReviewTransitionInput): ReviewTransition {
  const result = gradeCard(toSchedulerCard(card), reviewedAt, rating, reviewPolicy);
  const reviewedAtIso = reviewedAt.toISOString();
  const updatedCard: StudyCardRow = {
    ...card,
    due: result.card.due.toISOString(),
    stability: result.card.stability,
    difficulty: result.card.difficulty,
    elapsed_days: result.card.elapsed_days,
    scheduled_days: result.card.scheduled_days,
    learning_steps: result.card.learning_steps,
    reps: result.card.reps,
    lapses: result.card.lapses,
    state: result.card.state,
    last_review: reviewedAtIso,
    updated_at: reviewedAtIso,
  };

  return {
    updatedCard,
    reviewRecord: {
      rating,
      state: result.log.state,
      due: result.log.due.toISOString(),
      stability: result.log.stability,
      difficulty: result.log.difficulty,
      elapsedDays: result.log.elapsed_days,
      scheduledDays: result.log.scheduled_days,
      reviewedAt: reviewedAtIso,
    },
    shouldRequeueToday: isActiveAndDueToday(updatedCard, reviewedAt),
  };
}

function toSchedulerCard(card: StudyCardRow): Card {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: toSchedulerState(card.state),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
}

function toSchedulerState(state: number): State {
  switch (state) {
    case State.New:
      return State.New;
    case State.Learning:
      return State.Learning;
    case State.Review:
      return State.Review;
    case State.Relearning:
      return State.Relearning;
    default:
      throw new RangeError(`Unsupported study card state: ${state}`);
  }
}

function isActiveAndDueToday(card: StudyCardRow, reviewedAt: Date): boolean {
  const reviewedAtIso = reviewedAt.toISOString();
  return (
    !card.deleted_at &&
    !card.suspended_at &&
    (!card.buried_until || card.buried_until <= reviewedAtIso) &&
    card.due < localStartOfTomorrow(reviewedAt).toISOString()
  );
}
