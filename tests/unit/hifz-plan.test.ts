import fc from "fast-check";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import { persistReviewTransition } from "@/lib/fsrs/persist-review";
import { Rating } from "@/lib/fsrs/scheduler";
import {
  DEFAULT_ENABLED_MODES,
  DEFAULT_NEW_CARD_SORT_ORDER,
  DEFAULT_NEW_REVIEW_ORDER,
  DEFAULT_REVIEW_SORT_ORDER,
  DEFAULT_WORD_TEST_MODES,
  type DeckReviewSettings,
} from "@/lib/fsrs/types";
import { addDays, atLocalTime, localDateOf } from "@/lib/habit/dates";
import { buildDailyPlan, type PlanPage } from "@/lib/hifz/daily-plan";
import { declareMemorizedPages, loadTodayWird, type PageCard } from "@/lib/hifz/pages";
import { completedJuz, isMemorized, strengthBands } from "@/lib/hifz/progress";
import { DEFAULT_HIFZ_PLAN, parseHifzPlan, writeHifzPlan } from "@/lib/hifz/plan";
import { pagePolicy, tierFor, type GradeEvent } from "@/lib/hifz/tiers";
import { pageCardId } from "@/lib/hifz/units";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const TODAY = "2026-11-13";
const plan = DEFAULT_HIFZ_PLAN;
const DEFAULT_DECK_REVIEW_SETTINGS: DeckReviewSettings = {
  dailyReviewLimit: 100,
  newCardsLimit: 20,
  requestRetention: 0.9,
  maximumInterval: 365,
  enableFuzz: true,
  enableShortTerm: true,
  learningSteps: ["1m", "10m"],
  relearningSteps: ["10m"],
  newReviewOrder: DEFAULT_NEW_REVIEW_ORDER,
  reviewSortOrder: DEFAULT_REVIEW_SORT_ORDER,
  newCardSortOrder: DEFAULT_NEW_CARD_SORT_ORDER,
  testModes: DEFAULT_ENABLED_MODES,
  wordTestModes: DEFAULT_WORD_TEST_MODES,
};

function grade(daysAgo: number, rating: GradeEvent["rating"]): GradeEvent {
  return { date: addDays(TODAY, -daysAgo), rating };
}

describe("tiers (3.2, 8.6)", () => {
  it("keeps declared pages unverified until their first grade, then manzil", () => {
    expect(tierFor({ declared: true, firstFluentDate: null, grades: [] }, TODAY, plan)).toBe("manzil.unverified");
    expect(tierFor({ declared: true, firstFluentDate: null, grades: [grade(1, 3)] }, TODAY, plan)).toBe("manzil");
  });

  it("marks a manzil lapse as needing work until two Good grades in a row", () => {
    const declared = (grades: GradeEvent[]) => tierFor({ declared: true, firstFluentDate: null, grades }, TODAY, plan);
    expect(declared([grade(5, 3), grade(3, 1)])).toBe("manzil.needs_work");
    expect(declared([grade(5, 3), grade(3, 1), grade(2, 3)])).toBe("manzil.needs_work");
    expect(declared([grade(5, 3), grade(3, 1), grade(2, 3), grade(1, 2), grade(0, 3)])).toBe("manzil.needs_work");
    expect(declared([grade(5, 3), grade(3, 1), grade(2, 3), grade(1, 4)])).toBe("manzil");
  });

  it("keeps a page memorized in the app in sabqi for sabqi_days and until it settles", () => {
    const memorized = (firstFluentDaysAgo: number, grades: GradeEvent[]) =>
      tierFor({ declared: false, firstFluentDate: addDays(TODAY, -firstFluentDaysAgo), grades }, TODAY, plan);
    expect(memorized(3, [grade(2, 3), grade(1, 3)])).toBe("sabqi");
    expect(memorized(20, [grade(3, 3), grade(2, 3), grade(1, 3)])).toBe("manzil");
    expect(memorized(20, [grade(3, 3), grade(2, 2), grade(1, 3)])).toBe("sabqi");
    expect(memorized(5, [grade(2, 1), grade(1, 1)])).toBe("sabaq");
    expect(tierFor({ declared: false, firstFluentDate: null, grades: [] }, TODAY, plan)).toBe("sabaq");
  });

  it("caps manzil intervals at the cycle and sabqi at one day (SCH-02, SCH-03)", () => {
    const manzil = pagePolicy("manzil", { cycleDays: 20, retention: 0.95 }, DEFAULT_DECK_REVIEW_SETTINGS);
    expect(manzil).toMatchObject({ maximumInterval: 20, requestRetention: 0.95, learningSteps: [], relearningSteps: ["10m", "1d"] });
    expect(pagePolicy("sabqi", plan, DEFAULT_DECK_REVIEW_SETTINGS)).toMatchObject({ maximumInterval: 1 });
  });
});

function page(n: number, overrides: Partial<PlanPage> = {}): PlanPage {
  return {
    cardId: pageCardId(n),
    page: n,
    tier: "manzil",
    lastReviewDate: addDays(TODAY, -5),
    reviewedToday: false,
    dueDate: addDays(TODAY, 10),
    retrievability: 0.97,
    ...overrides,
  };
}

const input = (pages: PlanPage[], overrides: Partial<Parameters<typeof buildDailyPlan>[0]> = {}) => ({
  pages,
  plan: { ...plan, cycleDays: 30, dailyBudgetMin: 60 },
  today: TODAY,
  studyDay: true,
  minutesPerNewPage: 30,
  minutesPerReviewPage: 3,
  ...overrides,
});

describe("daily plan (4.3.1)", () => {
  it("takes ceil(O / C) of the oldest manzil pages plus every overdue page, sabqi first", () => {
    const manzil = Array.from({ length: 40 }, (_, i) => page(i + 1, { lastReviewDate: addDays(TODAY, -(i % 25) - 1) }));
    const overdue = page(100, { lastReviewDate: addDays(TODAY, -33) });
    const sabqi = page(200, { tier: "sabqi", lastReviewDate: addDays(TODAY, -1) });
    const result = buildDailyPlan(input([...manzil, overdue, sabqi]));
    expect(result.review[0]).toBe(sabqi);
    expect(result.floor[0]).toBe(overdue);
    expect(result.floor).toHaveLength(2);
    expect(result.overdueCount).toBe(1);
  });

  it("adds manzil pages FSRS wants sooner and pages that need work, needs-work first", () => {
    const weak = page(5, { retrievability: 0.8 });
    const work = page(6, { tier: "manzil.needs_work" });
    // The strong page is the oldest, so it fills the one floor place.
    const strong = page(7, { retrievability: 0.99, lastReviewDate: addDays(TODAY, -20) });
    const result = buildDailyPlan(input([weak, work, strong], { plan: { ...plan, cycleDays: 1000, dailyBudgetMin: 60 } }));
    expect(result.extra.map((p) => p.page)).toEqual([6, 5]);
  });

  it("trims extras first, then floor pages not more than 3 days overdue, and skips new memorization (PLN-01)", () => {
    const old = page(1, { lastReviewDate: addDays(TODAY, -40) });
    const slightly = page(2, { lastReviewDate: addDays(TODAY, -31) });
    const extras = Array.from({ length: 5 }, (_, i) => page(10 + i, { retrievability: 0.5 }));
    const result = buildDailyPlan(input([old, slightly, ...extras], { plan: { ...plan, cycleDays: 30, dailyBudgetMin: 4 } }));
    expect(result.review.map((p) => p.page)).toEqual([1]);
    expect(result.deferred.map((p) => p.page)).toEqual([14, 13, 12, 11, 10, 2]);
    expect(result.newLines).toBe(0);
  });

  it("pauses new memorization while manzil is far behind (PLN-02) and fits new lines in the budget (PLN-03)", () => {
    const behind = Array.from({ length: 6 }, (_, i) => page(i + 1, { lastReviewDate: addDays(TODAY, -40) }));
    expect(buildDailyPlan(input(behind)).backlog).toBe(true);
    expect(buildDailyPlan(input(behind)).newLines).toBe(0);
    expect(buildDailyPlan(input([])).newLines).toBe(7);
    expect(buildDailyPlan(input([], { plan: { ...plan, dailyBudgetMin: 5 } })).newLines).toBe(0);
    expect(buildDailyPlan(input([], { studyDay: false })).newLines).toBe(0);
  });

  it("keeps pages reviewed today in the day's share instead of adding new ones", () => {
    const pages = Array.from({ length: 30 }, (_, i) => page(i + 1, { lastReviewDate: addDays(TODAY, -1 - i) }));
    const first = buildDailyPlan(input(pages));
    expect(first.review).toHaveLength(1);
    const reviewed = pages.map((p) => (p.cardId === first.review[0].cardId ? { ...p, reviewedToday: true } : p));
    const after = buildDailyPlan(input(reviewed));
    expect(after.done).toHaveLength(1);
    expect(after.review).toHaveLength(0);
  });

  it("never plans more review minutes than the budget unless pages are long overdue", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ ago: fc.integer({ min: 0, max: 60 }), r: fc.double({ min: 0.3, max: 1, noNaN: true }) }), { maxLength: 80 }),
        fc.constantFrom(10, 20, 30, 60),
        (specs, budget) => {
          const pages = specs.map((spec, i) => page(i + 1, { lastReviewDate: addDays(TODAY, -spec.ago - 1), retrievability: spec.r }));
          const result = buildDailyPlan(input(pages, { plan: { ...plan, cycleDays: 30, dailyBudgetMin: budget } }));
          const protectedPages = result.review.filter((p) => p.lastReviewDate! < addDays(TODAY, -33)).length;
          return result.reviewMinutes <= budget || result.review.length === protectedPages;
        },
      ),
    );
  });
});

describe("plan setting", () => {
  it("parses saved plans over the defaults and rejects malformed ones", () => {
    expect(parseHifzPlan(JSON.stringify({ newPerDay: 1 }))).toMatchObject({ newPerDay: 1, cycleDays: 30 });
    expect(parseHifzPlan(JSON.stringify({ cycleDays: 0 }))).toBeNull();
    expect(parseHifzPlan("not json")).toBeNull();
    expect(parseHifzPlan(null)).toBeNull();
  });
});

describe("memorized pages and today's wird (ONB-04, PLAN-01)", () => {
  let store: OutboxDatabase;
  beforeEach(async () => {
    store = await openOutboxDatabase();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
    jest.restoreAllMocks();
  });

  it("spreads declared pages' first checks over the first cycle", async () => {
    const now = atLocalTime(TODAY, 600);
    const pages = Array.from({ length: 23 }, (_, i) => 582 + i);
    expect(await declareMemorizedPages(store.db, { pages, cycleDays: 30, now })).toBe(23);
    expect(await declareMemorizedPages(store.db, { pages, cycleDays: 30, now })).toBe(0);
    const dues = store.sql.prepare("SELECT due, tier FROM study_cards ORDER BY id").all() as { due: string; tier: string }[];
    const dates = dues.map((row) => localDateOf(new Date(row.due)));
    expect(new Set(dates).size).toBeGreaterThan(15);
    expect(dates.every((date) => date >= TODAY && date < addDays(TODAY, 30))).toBe(true);
    expect(dues.every((row) => row.tier === "manzil.unverified")).toBe(true);
    expect(Number(store.sql.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE table_name = 'study_cards'").get()?.n)).toBe(23);
  });

  it("keeps today's page list stable as pages are reviewed", async () => {
    const now = atLocalTime(TODAY, 600);
    await writeHifzPlan(store.db, { ...plan, cycleDays: 10, newPerDay: 0, method: "review_only" });
    await declareMemorizedPages(store.db, { pages: Array.from({ length: 20 }, (_, i) => i + 1), cycleDays: 10, now });
    const first = (await loadTodayWird(store.db, now))!;
    expect(first.todo.length).toBe(2);
    const target = first.todo[0];
    const card = store.sql.prepare("SELECT * FROM study_cards WHERE id = ?").get(target.cardId) as never;
    const transition = calculateReviewTransition({ card, rating: Rating.Good, reviewedAt: atLocalTime(TODAY, 610) });
    await persistReviewTransition({ db: store.db, cardId: target.cardId, transition });
    const second = (await loadTodayWird(store.db, atLocalTime(TODAY, 620)))!;
    expect(second.todo.map((p) => p.cardId)).toEqual([first.todo[1].cardId]);
    expect(second.done.map((p) => p.cardId)).toEqual([target.cardId]);
  });
});

describe("progress views (MST-01 to MST-03)", () => {
  const card = (page: number, tier: PageCard["tier"], ratings: number[]): PageCard => ({
    row: {} as PageCard["row"],
    page,
    tier,
    history: { declared: true, firstFluentDate: null, grades: ratings.map((rating, i) => ({ date: addDays(TODAY, -i - 1), rating: rating as 1 | 2 | 3 | 4 })) },
  });

  it("counts a page as memorized only after a Good grade in sabqi or manzil", () => {
    expect(isMemorized(card(1, "manzil", [3]))).toBe(true);
    expect(isMemorized(card(1, "manzil.unverified", []))).toBe(false);
    expect(isMemorized(card(1, "manzil.needs_work", [1]))).toBe(false);
    expect(isMemorized(card(1, "sabaq", [4]))).toBe(false);
  });

  it("bands recall at 0.90 and 0.75 and completes a juz only when every page is memorized", () => {
    expect(strengthBands([0.95, 0.9, 0.8, 0.75, 0.5])).toEqual({ steady: 2, fair: 2, needsReview: 1 });
    const juz30 = new Set(Array.from({ length: 23 }, (_, i) => 582 + i));
    expect(completedJuz(juz30)).toEqual([30]);
    juz30.delete(600);
    expect(completedJuz(juz30)).toEqual([]);
  });
});
