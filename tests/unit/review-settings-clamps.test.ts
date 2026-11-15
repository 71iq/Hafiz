import {
  clampDailyReviewLimit,
  clampNewCardsLimit,
  clampRequestRetention,
  clampMaximumInterval,
  validateDailyReviewLimitText,
} from "@/lib/fsrs/review-settings-draft";
import { isSchedulerDraftChanged, schedulerDraftFromSettings, schedulerFieldsFromDraft } from "@/lib/fsrs/scheduler-draft";
import type { DeckReviewSettings } from "@/lib/fsrs/types";

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

describe("typed daily limit within the existing domain", () => {
  it.each([
    ["10", 10],
    ["750", 750],
    ["٢٠", 20],
    [" 1000 ", 1000],
    ["020", 20],
  ])("accepts %j as %s with no upper cap", (text, value) => {
    expect(validateDailyReviewLimitText(text)).toEqual({ ok: true, value });
  });

  it.each(["", "9", "0", "-20", "+20", "12.5", "1e3", "2O", "99999999999999999999"])("rejects %j", (text) => {
    expect(validateDailyReviewLimitText(text)).toEqual({ ok: false });
  });
});

describe("scheduler draft dirtiness and serialization", () => {
  const base = {
    dailyReviewLimit: 20,
    newCardsLimit: 10,
    requestRetention: 0.9,
    maximumInterval: 365,
    enableFuzz: true,
    enableShortTerm: true,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"],
    newReviewOrder: "mixed",
    reviewSortOrder: "random",
    newCardSortOrder: "random",
    testModes: ["nextAyah"],
    wordTestModes: ["wordMeaningArabic"],
  } as const satisfies DeckReviewSettings;

  it("is clean when only formatting differs and dirty for an invalid or changed field", () => {
    const draft = schedulerDraftFromSettings({ ...base, learningSteps: [...base.learningSteps], relearningSteps: [...base.relearningSteps], testModes: [...base.testModes], wordTestModes: [...base.wordTestModes] }, false);
    expect(isSchedulerDraftChanged(draft, base)).toBe(false);
    expect(isSchedulerDraftChanged({ ...draft, learningStepsText: "1m 10m" }, base)).toBe(false);
    expect(isSchedulerDraftChanged({ ...draft, learningStepsText: "1m bad" }, base)).toBe(true);
    expect(isSchedulerDraftChanged({ ...draft, dailyLimitText: "30" }, base)).toBe(true);
    expect(schedulerFieldsFromDraft({ ...draft, dailyLimitText: "9" })).toBeNull();
    expect(schedulerFieldsFromDraft({ ...draft, dailyLimitText: "600" })?.dailyReviewLimit).toBe(600);
  });
});
