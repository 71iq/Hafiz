import { fsrs, createEmptyCard, Rating, State, type Card, type ReviewLog, type Grade } from "ts-fsrs";

// FSRS scheduler configured for Quran memorization (higher retention than default)
export const scheduler = fsrs({
  request_retention: 0.95,
  maximum_interval: 365,
  enable_fuzz: true,
  enable_short_term: true,
});

/** Grade a card and return { card, log } for the given rating */
export function gradeCard(card: Card, now: Date, rating: Grade): { card: Card; log: ReviewLog } {
  const results = scheduler.repeat(card, now);
  return results[rating];
}

export { createEmptyCard, Rating, State };
export type { Card, ReviewLog, Grade };
