import fc from "fast-check";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import { persistReviewTransition } from "@/lib/fsrs/persist-review";
import { Rating, State, type Grade } from "@/lib/fsrs/scheduler";
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
import type { PageToken } from "@/lib/hifz/page-data";
import { declareMemorizedPages, isMemorized, loadPageCards, loadTodayWird, reviewLeftToday, type PageCard } from "@/lib/hifz/pages";
import {
  completedJuz,
  monthlyCheckCandidates,
  monthlyCheckDue,
  pickMonthlyCheck,
  strengthBands,
} from "@/lib/hifz/progress";
import {
  DEFAULT_HIFZ_PLAN,
  parseHifzPlan,
  readHifzPlan,
  SABAQ_REPETITION_PRESETS,
  sabaqRepetitionPresetOf,
  writeHifzPlan,
  type HifzPlan,
} from "@/lib/hifz/plan";
import { emptyAttempt, savePageGrade } from "@/lib/hifz/review";
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

const FIRST_TOKEN: PageToken = { glyph: "g", surah: 1, ayah: 1, wordPos: 1, isMarker: false, firstLetter: "ب" };

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

  it("keeps a graduated page in manzil after a later Hard or Again", () => {
    const memorized = (grades: GradeEvent[]) => tierFor({ declared: false, firstFluentDate: addDays(TODAY, -30), grades }, TODAY, plan);
    const graduated = [grade(12, 3), grade(11, 3), grade(10, 3)];
    expect(memorized(graduated)).toBe("manzil");
    expect(memorized([...graduated, grade(5, 2)])).toBe("manzil");
    expect(memorized([...graduated, grade(5, 1)])).toBe("manzil.needs_work");
    expect(memorized([...graduated, grade(5, 1), grade(4, 3), grade(3, 3)])).toBe("manzil");
  });

  it("graduates a page by time before its next grade, so later Again grades do not send it back (TIER-01)", () => {
    const memorized = (grades: GradeEvent[]) => tierFor({ declared: false, firstFluentDate: addDays(TODAY, -30), grades }, TODAY, plan);
    // Three Good grades early in sabqi, then no grade until well past sabqi_days: manzil by time alone.
    const early = [grade(29, 3), grade(28, 3), grade(27, 3)];
    expect(memorized(early)).toBe("manzil");
    expect(memorized([...early, grade(5, 1)])).toBe("manzil.needs_work");
    expect(memorized([...early, grade(5, 1), grade(4, 1)])).toBe("manzil.needs_work");
    // Before sabqi_days have passed, two Again grades in a row still send the page back.
    expect(memorized([...early, grade(26, 1), grade(25, 1)])).toBe("sabaq");
  });

  it("relearns a page sent back to sabaq and starts a new sabqi period on its next Good grade", () => {
    const memorized = (grades: GradeEvent[]) => tierFor({ declared: false, firstFluentDate: addDays(TODAY, -30), grades }, TODAY, plan);
    const failed = [grade(29, 3), grade(28, 1), grade(27, 1)];
    expect(memorized(failed)).toBe("sabaq");
    expect(memorized([...failed, grade(26, 2)])).toBe("sabaq");
    expect(memorized([...failed, grade(26, 3)])).toBe("sabqi");
    expect(memorized([...failed, grade(26, 3), grade(20, 3), grade(10, 3)])).toBe("manzil");
    expect(memorized([...failed, grade(5, 3)])).toBe("sabqi");
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
    // Past its floor date, so its recall is the lowest of the slice.
    const overdue = page(100, { lastReviewDate: addDays(TODAY, -33), retrievability: 0.6 });
    const sabqi = page(200, { tier: "sabqi", lastReviewDate: addDays(TODAY, -1) });
    const result = buildDailyPlan(input([...manzil, overdue, sabqi]));
    expect(result.review[0]).toBe(sabqi);
    expect(result.floor[0]).toBe(overdue);
    expect(result.floor).toHaveLength(2);
    expect(result.overdueCount).toBe(1);
  });

  it("holds back Home's wird done for review still due, the due ayah cards in ayah review, not for new work (GOAL-04)", () => {
    const pageDay = { todo: [], plan: { unit: "page" as const } };
    const ayahDay = { todo: [], plan: { unit: "ayah" as const } };
    expect(reviewLeftToday(pageDay, { remediationDue: 0, ayahReviewsDue: 20 })).toBe(false);
    expect(reviewLeftToday(pageDay, { remediationDue: 1, ayahReviewsDue: 0 })).toBe(true);
    expect(reviewLeftToday({ ...pageDay, todo: [page(1)] }, { remediationDue: 0, ayahReviewsDue: 0 })).toBe(true);
    expect(reviewLeftToday(ayahDay, { remediationDue: 0, ayahReviewsDue: 20 })).toBe(true);
    expect(reviewLeftToday(ayahDay, { remediationDue: 0, ayahReviewsDue: 0 })).toBe(false);
  });

  it("orders the day's manzil slice by lowest recall, after pages never reviewed (SCH-05)", () => {
    const strong = page(1, { lastReviewDate: addDays(TODAY, -25), retrievability: 0.99 });
    const weak = page(2, { lastReviewDate: addDays(TODAY, -25), retrievability: 0.1 });
    const unchecked = page(3, { tier: "manzil.unverified", lastReviewDate: null, retrievability: null });
    const others = Array.from({ length: 60 }, (_, i) => page(10 + i, { lastReviewDate: addDays(TODAY, -(i % 20) - 1) }));
    const result = buildDailyPlan(input([strong, weak, unchecked, ...others]));
    // The floor still takes the oldest reviews; within it the weaker page comes first.
    expect(result.floor.slice(0, 3).map((item) => item.page)).toEqual([3, 2, 1]);
  });

  it("puts a page sent back to sabaq first in the review every day", () => {
    const relearn = page(300, { tier: "sabaq", lastReviewDate: addDays(TODAY, -1) });
    const sabqi = page(200, { tier: "sabqi", lastReviewDate: addDays(TODAY, -1) });
    const result = buildDailyPlan(input([page(1), sabqi, relearn]));
    expect(result.review.slice(0, 2)).toEqual([relearn, sabqi]);
  });

  it("waits for a new sabqi page's first due date before its first review", () => {
    // Completed through sabaq today: no page review yet, due tomorrow at local midnight.
    const fresh = page(200, { tier: "sabqi", lastReviewDate: null, dueDate: addDays(TODAY, 1), retrievability: null });
    expect(buildDailyPlan(input([fresh])).sabqi).toEqual([]);
    const dueToday = { ...fresh, dueDate: TODAY };
    expect(buildDailyPlan(input([dueToday])).sabqi).toEqual([dueToday]);
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

  describe("sabaq repetition counts (SBQ-01)", () => {
    const counts = (value: Partial<HifzPlan["sabaqRepetitions"]>) => ({ ...plan.sabaqRepetitions, ...value });

    it("gives a plan saved before the counts existed the '10 looking, then from memory' defaults", () => {
      const { sabaqRepetitions: _omitted, ...olderPlan } = DEFAULT_HIFZ_PLAN;
      expect(parseHifzPlan(JSON.stringify({ ...olderPlan, newPerDay: 1 }))).toMatchObject({
        newPerDay: 1,
        sabaqRepetitions: { listen: 3, looking: 10, cleanInARow: 3 },
      });
      // A partly saved set keeps the counts it has and takes the default for the rest.
      expect(parseHifzPlan(JSON.stringify({ sabaqRepetitions: { looking: 20 } }))?.sabaqRepetitions).toEqual({
        listen: 3,
        looking: 20,
        cleanInARow: 3,
      });
    });

    it("accepts each count at both ends of its range", () => {
      for (const value of [counts({ listen: 1, looking: 1, cleanInARow: 1 }), counts({ listen: 5, looking: 30, cleanInARow: 10 })]) {
        expect(parseHifzPlan(JSON.stringify({ sabaqRepetitions: value }))?.sabaqRepetitions).toEqual(value);
      }
    });

    it.each([
      ["no listening", { listen: 0 }],
      ["6 listens", { listen: 6 }],
      ["no readings", { looking: 0 }],
      ["31 readings", { looking: 31 }],
      ["half a reading", { looking: 10.5 }],
      ["no clean run", { cleanInARow: 0 }],
      ["11 clean in a row", { cleanInARow: 11 }],
    ])("rejects a plan with %s, like any field out of range", (_label, value) => {
      expect(parseHifzPlan(JSON.stringify({ sabaqRepetitions: counts(value) }))).toBeNull();
    });

    it("rejects counts that are not a set of numbers", () => {
      expect(parseHifzPlan(JSON.stringify({ sabaqRepetitions: "twenty" }))).toBeNull();
      expect(parseHifzPlan(JSON.stringify({ sabaqRepetitions: null }))).toBeNull();
      expect(parseHifzPlan(JSON.stringify({ sabaqRepetitions: [20] }))).toBeNull();
    });

    it("offers the default practice and the 20-times method as presets", () => {
      expect(SABAQ_REPETITION_PRESETS).toEqual({
        looking_then_memory: { listen: 3, looking: 10, cleanInARow: 3 },
        twenty_times: { listen: 3, looking: 20, cleanInARow: 3 },
      });
      expect(DEFAULT_HIFZ_PLAN.sabaqRepetitions).toEqual(SABAQ_REPETITION_PRESETS.looking_then_memory);
      expect(sabaqRepetitionPresetOf(counts({ looking: 20 }))).toBe("twenty_times");
      expect(sabaqRepetitionPresetOf(counts({}))).toBe("looking_then_memory");
      expect(sabaqRepetitionPresetOf(counts({ looking: 20, cleanInARow: 5 }))).toBeNull();
    });

    it("saves the counts in the synced plan and refuses counts out of range", async () => {
      const store = await openOutboxDatabase();
      try {
        await writeHifzPlan(store.db, { ...plan, sabaqRepetitions: counts({ looking: 20 }) });
        expect((await readHifzPlan(store.db))?.sabaqRepetitions).toEqual(counts({ looking: 20 }));
        const queued = store.sql.prepare("SELECT data FROM sync_queue WHERE table_name = 'user_settings' AND row_id = 'hifz_plan'").get() as { data: string };
        expect(JSON.parse(JSON.parse(queued.data).value).sabaqRepetitions).toEqual(counts({ looking: 20 }));
        await expect(writeHifzPlan(store.db, { ...plan, sabaqRepetitions: counts({ looking: 31 }) })).rejects.toThrow();
        expect((await readHifzPlan(store.db))?.sabaqRepetitions.looking).toBe(20);
      } finally {
        await store.close();
      }
    });
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
    // The page's own policy: a declared page has no learning steps, so Good schedules it days out.
    const reviewPolicy = pagePolicy("manzil.unverified", { ...plan, cycleDays: 10 }, DEFAULT_DECK_REVIEW_SETTINGS);
    const transition = calculateReviewTransition({ card, rating: Rating.Good, reviewedAt: atLocalTime(TODAY, 610), reviewPolicy });
    await persistReviewTransition({ db: store.db, cardId: target.cardId, transition });
    const second = (await loadTodayWird(store.db, atLocalTime(TODAY, 620)))!;
    expect(second.todo.map((p) => p.cardId)).toEqual([first.todo[1].cardId]);
    expect(second.done.map((p) => p.cardId)).toEqual([target.cardId]);
  });

  it("brings a page graded Again today back once its relearning step is due, and keeps it covered", async () => {
    const wirdPlan: HifzPlan = { ...plan, cycleDays: 10, newPerDay: 0, method: "review_only" };
    const start = addDays(TODAY, -12);
    await writeHifzPlan(store.db, wirdPlan);
    await declareMemorizedPages(store.db, { pages: [1, 2], cycleDays: 10, now: atLocalTime(start, 600) });
    const gradePage = async (page: number, rating: Grade, at: Date) => {
      const cards = await loadPageCards(store.db, { today: localDateOf(at), plan: wirdPlan });
      const card = cards.find((candidate) => candidate.page === page)!;
      return savePageGrade(store.db, {
        card: card.row,
        history: card.history,
        plan: wirdPlan,
        attempt: emptyAttempt(4),
        rating,
        firstToken: FIRST_TOKEN,
        session: null,
        durationMs: 60_000,
        now: at,
      });
    };
    // Page 1 was checked 12 days ago, so like page 2 it is past its 10-day floor today.
    await gradePage(1, Rating.Good, atLocalTime(start, 610));
    const morning = (await loadTodayWird(store.db, atLocalTime(TODAY, 600)))!;
    expect(morning.todo.map((p) => p.page).sort()).toEqual([1, 2]);

    const again = await gradePage(1, Rating.Again, atLocalTime(TODAY, 610));
    expect(again.transition.updatedCard.state).toBe(State.Relearning);
    // 10:30: the 10-minute step is due. The page is pending again after the planned page, and still done.
    const due = (await loadTodayWird(store.db, atLocalTime(TODAY, 630)))!;
    expect(due.todo.map((p) => p.cardId)).toEqual([pageCardId(2), pageCardId(1)]);
    expect(due.done.map((p) => p.cardId)).toEqual([pageCardId(1)]);
    expect(due.total).toBe(2);
    expect(due.remainingMinutes).toBe(2 * due.minutesPerReviewPage);
    // The day's floor share still counts the page once, as reviewed today.
    expect(due.daily.done.map((p) => p.cardId)).toEqual([pageCardId(1)]);

    // Good moves it to the next-day step: it leaves pending and keeps its one place in done.
    const good = await gradePage(1, Rating.Good, atLocalTime(TODAY, 631));
    expect(localDateOf(new Date(good.transition.updatedCard.due)) > TODAY).toBe(true);
    const after = (await loadTodayWird(store.db, atLocalTime(TODAY, 640)))!;
    expect(after.todo.map((p) => p.cardId)).toEqual([pageCardId(2)]);
    expect(after.done.map((p) => p.cardId)).toEqual([pageCardId(1)]);
    expect(after.total).toBe(2);
  });

  it("says when a page's later learning step comes back today, for Home to refresh then", async () => {
    const wirdPlan: HifzPlan = { ...plan, cycleDays: 10, newPerDay: 0, method: "review_only" };
    await writeHifzPlan(store.db, wirdPlan);
    const start = addDays(TODAY, -12);
    await declareMemorizedPages(store.db, { pages: [1], cycleDays: 10, now: atLocalTime(start, 600) });
    const gradePage = async (rating: Grade, at: Date) => {
      const [card] = await loadPageCards(store.db, { today: localDateOf(at), plan: wirdPlan });
      return savePageGrade(store.db, {
        card: card.row,
        history: card.history,
        plan: wirdPlan,
        attempt: emptyAttempt(4),
        rating,
        firstToken: FIRST_TOKEN,
        session: null,
        durationMs: 60_000,
        now: at,
      });
    };
    await gradePage(Rating.Good, atLocalTime(start, 610));
    const again = await gradePage(Rating.Again, atLocalTime(TODAY, 600));
    expect(again.transition.updatedCard.state).toBe(State.Relearning);
    // A step longer than the learn-ahead window, as the sabaq tier's 1-hour step.
    store.sql.prepare("UPDATE study_cards SET due = ? WHERE id = ?").run(atLocalTime(TODAY, 780).toISOString(), pageCardId(1));
    const waiting = (await loadTodayWird(store.db, atLocalTime(TODAY, 610)))!;
    expect(waiting.todo).toEqual([]);
    expect(waiting.nextStepAt).toEqual(atLocalTime(TODAY, 780));
    const back = (await loadTodayWird(store.db, atLocalTime(TODAY, 770)))!;
    expect(back.todo.map((p) => p.cardId)).toEqual([pageCardId(1)]);
    expect(back.nextStepAt).toBeNull();
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

describe("monthly check (MST-05)", () => {
  const card = (page: number, daysAgo: number, rating = 3): PageCard => ({
    row: {} as PageCard["row"],
    page,
    tier: "manzil",
    history: { declared: true, firstFluentDate: null, grades: [{ date: addDays(TODAY, -daysAgo), rating: rating as 3 }] },
  });

  it("checks memorized pages not reviewed in two weeks, once a month", () => {
    const cards = [card(1, 20), card(2, 15), card(3, 14), card(4, 30, 1), card(5, 40), card(6, 50), card(7, 60)];
    expect(monthlyCheckCandidates(cards, TODAY).map((c) => c.page)).toEqual([1, 2, 5, 6, 7]);
    expect(pickMonthlyCheck(monthlyCheckCandidates(cards, TODAY), () => 0)).toHaveLength(5);
    expect(monthlyCheckDue(null, TODAY, 5)).toBe(true);
    expect(monthlyCheckDue("2026-11", TODAY, 5)).toBe(false);
    expect(monthlyCheckDue("2026-10", TODAY, 4)).toBe(false);
  });
});
