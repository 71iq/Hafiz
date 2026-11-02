import {
  clampDailyReviewLimit,
  clampNewCardsLimit,
  clampRequestRetention,
  clampMaximumInterval,
} from "@/lib/fsrs/review-settings-draft";

describe("review settings numeric drafts", () => {
  it.each([
    [-Infinity, 10],
    [-1, 10],
    [-0, 10],
    [0, 10],
    [9.99, 10],
    [10, 10],
    [10.25, 10.25],
    [99999, 99999],
    [Number.MAX_VALUE, Number.MAX_VALUE],
    [Infinity, Infinity],
    [NaN, NaN],
  ])("daily limit %s becomes %s", (value, expected) => {
    expect(clampDailyReviewLimit(value)).toBe(expected);
  });

  it.each([
    [-Infinity, 0],
    [-1, 0],
    [-0, 0],
    [0, 0],
    [Number.MIN_VALUE, Number.MIN_VALUE],
    [0.25, 0.25],
    [99999, 99999],
    [Number.MAX_VALUE, Number.MAX_VALUE],
    [Infinity, Infinity],
    [NaN, NaN],
  ])("new-card limit %s becomes %s", (value, expected) => {
    expect(clampNewCardsLimit(value)).toBe(expected);
  });

  it.each([
    [-Infinity, 0.8],
    [-1, 0.8],
    [-0, 0.8],
    [0, 0.8],
    [0.7999, 0.8],
    [0.8, 0.8],
    [0.804, 0.8],
    [0.805, 0.81],
    [0.814, 0.81],
    [0.815, 0.81],
    [0.825, 0.82],
    [0.826, 0.83],
    [0.984, 0.98],
    [0.985, 0.98],
    [0.986, 0.99],
    [0.99, 0.99],
    [0.991, 0.99],
    [1, 0.99],
    [Infinity, 0.99],
    [NaN, NaN],
  ])("retention %s becomes %s", (value, expected) => {
    expect(clampRequestRetention(value)).toBe(expected);
  });

  it.each([
    [-Infinity, 30],
    [-1, 30],
    [-0, 30],
    [0, 30],
    [29.99, 30],
    [30, 30],
    [30.25, 30.25],
    [100.125, 100.125],
    [3649.99, 3649.99],
    [3650, 3650],
    [3650.01, 3650],
    [Number.MAX_VALUE, 3650],
    [Infinity, 3650],
    [NaN, NaN],
  ])("maximum interval %s becomes %s", (value, expected) => {
    expect(clampMaximumInterval(value)).toBe(expected);
  });
});
