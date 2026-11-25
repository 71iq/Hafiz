import type { CheckItem } from "@/lib/meanings/check-bank";
import {
  answer,
  atOrAbove,
  checkResult,
  isFinished,
  languageForRating,
  levelForRating,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  nextBoundary,
  nextItem,
  priorFor,
  startCheck,
  updateLevels,
  type SelfRating,
} from "@/lib/meanings/level-check";

/** "Check my level" (SPEC 3.6) as a pure model, over a synthetic bank of eight items per boundary. */
const position = (n: number) => ({ surah: 2, ayah: n, pos: 1 });
const bank: CheckItem[] = [1, 2, 3, 4, 5].flatMap((boundary) =>
  Array.from({ length: 8 }, (_, i) => ({
    boundary: boundary as CheckItem["boundary"],
    language: "en" as const,
    word: position(boundary * 10 + i),
    distractors: [position(100 + i), position(110 + i), position(120 + i)] as const,
  })),
);
const ratings: SelfRating[] = [0, 1, 2, 3].flatMap((arabic) =>
  [0, 1, 2, 3].map((recited) => ({ arabic, recited }) as SelfRating),
);

it("starts every self-rating from a full distribution centred on the level its answers suggest", () => {
  const centres = ratings.map((rating) => levelForRating(rating));
  expect(centres).toEqual([0, 1, 2, 3, 1, 2, 3, 3, 2, 3, 3, 4, 3, 3, 4, 5]);
  for (const rating of ratings) {
    const prior = priorFor(rating);
    expect(prior).toHaveLength(6);
    expect(prior.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 10);
    expect(prior.every((p) => p > 0)).toBe(true);
  }
});

it("suggests Arabic meanings for readers of Arabic and English for those who know none", () => {
  expect(languageForRating({ arabic: 3 })).toBe("ar");
  expect(languageForRating({ arabic: 2 })).toBe("ar");
  expect(languageForRating({ arabic: 0 })).toBe("en");
  expect(languageForRating({ arabic: 1 })).toBeNull();
});

it("moves belief up after a right answer and down after a wrong one at the same boundary", () => {
  const prior = priorFor({ arabic: 1, recited: 1 });
  expect(atOrAbove(updateLevels(prior, 2, true), 2)).toBeGreaterThan(atOrAbove(prior, 2));
  expect(atOrAbove(updateLevels(prior, 2, false), 2)).toBeLessThan(atOrAbove(prior, 2));
});

it("asks where being at or above the boundary is nearest one half", () => {
  // Certain of level 2: at or above 1 and 2 is 1, at or above 3 is 0; the nearest to a half wins by order.
  const sure = [0, 0, 1, 0, 0, 0];
  expect(nextBoundary(sure, new Set([1, 2, 3, 4, 5]))).toBe(1);
  const even = [0, 0, 0.5, 0.5, 0, 0];
  expect(nextBoundary(even, new Set([1, 2, 3, 4, 5]))).toBe(3);
  expect(nextBoundary(even, new Set([1, 2]))).toBe(1);
});

describe.each([0, 1, 2, 3, 4, 5])("a learner at level %i who answers as the model expects", (level) => {
  it.each(ratings)("is placed at their level from self-rating %o, in 6 to 12 questions", (rating) => {
    let state = startCheck(bank, { language: "en", centre: levelForRating(rating), seed: 7 });
    for (let item = nextItem(state); item; item = nextItem(state)) {
      state = answer(state, item, item.boundary <= level);
    }
    expect(isFinished(state)).toBe(true);
    expect(state.asked.length).toBeGreaterThanOrEqual(MIN_QUESTIONS);
    expect(state.asked.length).toBeLessThanOrEqual(MAX_QUESTIONS);
    expect(checkResult(state)).toBe(level);
    expect(new Set(state.asked).size).toBe(state.asked.length);
  });
});

it("draws the same items for the same seed and other items for another", () => {
  const order = (seed: number) => {
    let state = startCheck(bank, { language: "en", centre: levelForRating({ arabic: 1, recited: 1 }), seed });
    for (let item = nextItem(state); item; item = nextItem(state)) state = answer(state, item, item.boundary <= 2);
    return state.asked.map((item) => item.word.ayah);
  };
  expect(order(3)).toEqual(order(3));
  expect(order(3)).not.toEqual(order(4));
});

it("has nothing to ask in a language the bank does not cover", () => {
  expect(nextItem(startCheck(bank, { language: "ar", centre: 5, seed: 1 }))).toBeNull();
});
