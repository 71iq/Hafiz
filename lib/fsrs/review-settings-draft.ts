import {
  MAX_DECK_MAXIMUM_INTERVAL,
  MAX_DECK_REQUEST_RETENTION,
  MIN_DECK_MAXIMUM_INTERVAL,
  MIN_DECK_DAILY_REVIEW_LIMIT,
  MIN_DECK_NEW_CARD_LIMIT,
  MIN_DECK_REQUEST_RETENTION,
} from "@/lib/fsrs/types";

export function clampDailyReviewLimit(value: number): number {
  return Math.max(MIN_DECK_DAILY_REVIEW_LIMIT, value);
}

export function clampNewCardsLimit(value: number): number {
  return Math.max(MIN_DECK_NEW_CARD_LIMIT, value);
}

export function clampRequestRetention(value: number): number {
  const clamped = Math.max(MIN_DECK_REQUEST_RETENTION, Math.min(MAX_DECK_REQUEST_RETENTION, value));
  return Number(clamped.toFixed(2));
}

export function clampMaximumInterval(value: number): number {
  return Math.max(MIN_DECK_MAXIMUM_INTERVAL, Math.min(MAX_DECK_MAXIMUM_INTERVAL, value));
}
