import { gradeCard, State, type Card, type Grade } from "@/lib/fsrs/scheduler";
import type { DeckReviewSettings, StudyCardRow } from "@/lib/fsrs/types";

type ReviewRecord = Readonly<{
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
  shouldRequeueInSession: boolean;
}>;

/**
 * A card counts as due once it is due within this window, like Anki's learn-ahead limit. Home counts,
 * session queues and in-session requeues share it, so a card on a 1m or 10m learning step comes back
 * after the cards ahead of it while one scheduled hours out waits until it is nearly due.
 */
export const REVIEW_LEARN_AHEAD_MS = 20 * 60 * 1000;

export function reviewDueCutoff(now = new Date()): string {
  return new Date(now.getTime() + REVIEW_LEARN_AHEAD_MS).toISOString();
}

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
    shouldRequeueInSession: isActiveAndDueInSession(updatedCard, reviewedAt),
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

function isActiveAndDueInSession(card: StudyCardRow, reviewedAt: Date): boolean {
  const reviewedAtIso = reviewedAt.toISOString();
  return (
    !card.deleted_at &&
    !card.suspended_at &&
    (!card.buried_until || card.buried_until <= reviewedAtIso) &&
    card.due <= reviewDueCutoff(reviewedAt)
  );
}
