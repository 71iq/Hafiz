import { fsrs, createEmptyCard, Rating, State, type Card, type ReviewLog, type Grade } from "ts-fsrs";
import {
  DEFAULT_DECK_ENABLE_FUZZ,
  DEFAULT_DECK_ENABLE_SHORT_TERM,
  DEFAULT_DECK_LEARNING_STEPS,
  DEFAULT_DECK_MAXIMUM_INTERVAL,
  DEFAULT_DECK_RELEARNING_STEPS,
  DEFAULT_DECK_REQUEST_RETENTION,
  type DeckReviewSettings,
} from "./types";

function createScheduler(settings?: Pick<
  DeckReviewSettings,
  "requestRetention" | "maximumInterval" | "enableFuzz" | "enableShortTerm" | "learningSteps" | "relearningSteps"
>) {
  return fsrs({
    request_retention: settings?.requestRetention ?? DEFAULT_DECK_REQUEST_RETENTION,
    maximum_interval: settings?.maximumInterval ?? DEFAULT_DECK_MAXIMUM_INTERVAL,
    enable_fuzz: settings?.enableFuzz ?? DEFAULT_DECK_ENABLE_FUZZ,
    enable_short_term: settings?.enableShortTerm ?? DEFAULT_DECK_ENABLE_SHORT_TERM,
    learning_steps: settings?.learningSteps ?? DEFAULT_DECK_LEARNING_STEPS,
    relearning_steps: settings?.relearningSteps ?? DEFAULT_DECK_RELEARNING_STEPS,
  });
}

export const scheduler = createScheduler();

/** Grade a card and return { card, log } for the given rating */
export function gradeCard(card: Card, now: Date, rating: Grade, settings?: DeckReviewSettings): { card: Card; log: ReviewLog } {
  const results = createScheduler(settings).repeat(card, now);
  return results[rating];
}

export { createEmptyCard, Rating, State };
export type { Card, ReviewLog, Grade };
