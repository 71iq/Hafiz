import type { CheckItem } from "@/lib/meanings/check-bank";
import { MAX_LEVEL, type MeaningLanguage } from "@/lib/meanings/lemma-index";

/**
 * "Check my level" (SPEC 3.6): a short adaptive check that estimates how many bands of the commonest
 * words a learner already knows. It keeps a probability for each of the six levels, 0 to 5:
 *
 * - It starts from a fixed table over the two self-rating answers, or around the stored level when
 *   retaken from Settings.
 * - A correct answer has probability 0.9 when the item's word is in a band the level counts as known
 *   (its boundary is at or below the level), otherwise 0.25, the chance of a guess among four.
 *   "I don't know" counts as a wrong answer.
 * - Each question asks at the boundary where the chance of being at or above it is nearest one half.
 * - It asks at least 6 and at most 12 questions, stopping early once one level reaches 85%.
 * - The result is the most probable level, a tie going to the lower one.
 */

export const LEVELS = MAX_LEVEL + 1;
export const MIN_QUESTIONS = 6;
export const MAX_QUESTIONS = 12;
export const STOP_AT = 0.85;
const P_KNOWN = 0.9;
const P_GUESS = 0.25;

/** 0 to 3 on each question: how well the user understands Arabic, and what they recite. */
export type SelfRating = Readonly<{ arabic: 0 | 1 | 2 | 3; recited: 0 | 1 | 2 | 3 }>;

/** The starting probabilities centred on a level, falling away on either side. */
export function priorAround(centre: number): number[] {
  const weights = Array.from(
    { length: LEVELS },
    (_, level) => [0.5, 0.2, 0.06, 0.02, 0.01, 0.01][Math.abs(level - centre)],
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

/**
 * The starting probabilities for a self-rating: centred on the level the two answers suggest
 * (their sum, 0 to 6, scaled to 0 to 5). Written out as a rule rather than 16 rows, which it
 * reproduces exactly; the unit test pins every row.
 */
export function priorFor(rating: SelfRating): number[] {
  return priorAround(levelForRating(rating));
}

/** The level "Choose for me" takes, and the check's starting centre: the self-rating's most probable level. */
export function levelForRating(rating: SelfRating): number {
  return Math.round(((rating.arabic + rating.recited) * MAX_LEVEL) / 6);
}

/** The meaning language the Arabic answer suggests, or null to fall back to the interface language. */
export function languageForRating(rating: Pick<SelfRating, "arabic">): MeaningLanguage | null {
  if (rating.arabic >= 2) return "ar";
  if (rating.arabic === 0) return "en";
  return null;
}

export function mostProbable(probabilities: readonly number[]): number {
  let best = 0;
  for (let level = 1; level < probabilities.length; level += 1) {
    if (probabilities[level] > probabilities[best] + 1e-12) best = level;
  }
  return best;
}

/** The chance of being at or above a boundary (1 to 5). */
export function atOrAbove(probabilities: readonly number[], boundary: number): number {
  return probabilities.slice(boundary).reduce((sum, p) => sum + p, 0);
}

/** The probabilities after one answer to an item at `boundary`. */
export function updateLevels(probabilities: readonly number[], boundary: number, correct: boolean): number[] {
  const next = probabilities.map((p, level) => {
    const pCorrect = boundary <= level ? P_KNOWN : P_GUESS;
    return p * (correct ? pCorrect : 1 - pCorrect);
  });
  const total = next.reduce((sum, p) => sum + p, 0);
  return total > 0 ? next.map((p) => p / total) : [...probabilities];
}

/** The boundary the next question should test: where being at or above it is nearest one half. */
export function nextBoundary(probabilities: readonly number[], available: ReadonlySet<number>): number | null {
  let best: number | null = null;
  let bestGap = Infinity;
  for (let boundary = 1; boundary <= MAX_LEVEL; boundary += 1) {
    if (!available.has(boundary)) continue;
    const gap = Math.abs(atOrAbove(probabilities, boundary) - 0.5);
    if (gap < bestGap - 1e-12) {
      best = boundary;
      bestGap = gap;
    }
  }
  return best;
}

export type CheckState = Readonly<{
  language: MeaningLanguage;
  probabilities: readonly number[];
  asked: readonly CheckItem[];
  /** The order items are drawn in, fixed by the seed: never twice from one lemma's item. */
  pool: readonly CheckItem[];
  answers: readonly boolean[];
}>;

/** A small seeded generator, so a check draws the same items for the same seed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * A check in one meaning language, starting from probabilities centred on `centre`: the self-rating's
 * level at setup, or the stored level when retaken from Settings.
 */
export function startCheck(
  bank: readonly CheckItem[],
  { language, centre, seed }: { language: MeaningLanguage; centre: number; seed: number },
): CheckState {
  const random = seeded(seed);
  const pool = bank
    .filter((item) => item.language === language)
    .map((item) => ({ item, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
  return {
    language,
    probabilities: priorAround(Math.max(0, Math.min(MAX_LEVEL, Math.round(centre)))),
    asked: [],
    pool,
    answers: [],
  };
}

/** The next item to ask, or null when the check is finished. */
export function nextItem(state: CheckState): CheckItem | null {
  if (isFinished(state)) return null;
  const asked = new Set(state.asked);
  const remaining = state.pool.filter((item) => !asked.has(item));
  const boundary = nextBoundary(state.probabilities, new Set(remaining.map((item) => item.boundary)));
  return boundary === null ? null : (remaining.find((item) => item.boundary === boundary) ?? null);
}

export function answer(state: CheckState, item: CheckItem, correct: boolean): CheckState {
  return {
    ...state,
    probabilities: updateLevels(state.probabilities, item.boundary, correct),
    asked: [...state.asked, item],
    answers: [...state.answers, correct],
  };
}

export function isFinished(state: CheckState): boolean {
  const count = state.asked.length;
  if (count >= MAX_QUESTIONS) return true;
  const asked = new Set(state.asked);
  if (!state.pool.some((item) => !asked.has(item))) return true;
  return count >= MIN_QUESTIONS && Math.max(...state.probabilities) >= STOP_AT;
}

/** Whether the bank can run a check in this language; with no items the check is not offered. */
export function hasCheckItems(bank: readonly CheckItem[], language: MeaningLanguage): boolean {
  return bank.some((item) => item.language === language);
}

export function checkResult(state: CheckState): number {
  return mostProbable(state.probabilities);
}

/**
 * How many of the commonest words a level counts as known, from the rank figures of the band floors
 * (distinct lemmas): 125, 376, 694, 1,467 and 2,408, rounded for reading.
 */
export const KNOWN_WORDS_AT_LEVEL: readonly number[] = [0, 125, 400, 700, 1500, 2400];
