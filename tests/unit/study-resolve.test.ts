import path from "node:path";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { writeDeckReviewSettings } from "@/lib/fsrs/queries";
import { addDays, localDateOf } from "@/lib/habit/dates";
import { applyPreset, DEFAULT_HIFZ_PLAN, writeHifzPlan } from "@/lib/hifz/plan";
import { loadTodayWird, newMemorizationOpen } from "@/lib/hifz/pages";
import { writeMeaningsInDailyStudy } from "@/lib/study/daily-decks";
import * as memorize from "@/lib/hifz/memorize";
import { DAILY_SESSION_HREF, loadStudyState, resolveStudy } from "@/lib/study/resolve";
import type { AppDatabase } from "@/lib/database/types";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/** The study resolver (SPEC 3.1) over the bundled Quran and similar-verse data. */
let store: OutboxDatabase;
const now = new Date();
const today = localDateOf(now);
// A plan that reviews pages and adds no new lines, so the memorize step stays out of the way.
const reviewOnly = applyPreset(DEFAULT_HIFZ_PLAN, "maintenance");

beforeEach(async () => {
  store = await openOutboxDatabase();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  store.sql.exec(`ATTACH DATABASE '${path.resolve(__dirname, "../../assets/data/quran.db")}' AS bundled`);
  for (const table of ["quran_text", "surahs", "page_map", "mutashabihat_groups", "mutashabihat_refs"]) {
    store.sql.exec(`DELETE FROM main.${table}`);
    store.sql.exec(`INSERT INTO main.${table} SELECT * FROM bundled.${table}`);
  }
});

afterEach(async () => {
  await store.close();
  jest.restoreAllMocks();
});

const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
function insertCard(id: string, deckId: string, state: number, due: string) {
  store.sql
    .prepare(
      `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps,
        lapses, state, last_review, created_at, updated_at) VALUES (?, ?, ?, 20, 5, 1, 1, 0, 3, 0, ?, ?, ?, ?)`,
    )
    .run(id, deckId, due, state, iso(86_400_000 * 30), iso(86_400_000 * 60), iso(86_400_000 * 60));
}

it("opens Home when there is no plan", async () => {
  expect(await resolveStudy(store.db, now)).toEqual({ kind: "home", reason: "no_plan" });
});

it("opens Home when a read fails", async () => {
  const broken = { ...store.db, getFirstAsync: () => Promise.reject(new Error("disk")) } as unknown as AppDatabase;
  expect(await resolveStudy(broken, now)).toEqual({ kind: "home", reason: "failed" });
});

it("opens the daily cards for a page plan with nothing else left, and Home once the decks are empty", async () => {
  await writeHifzPlan(store.db, reviewOnly);
  expect(await resolveStudy(store.db, now)).toEqual({ kind: "cards", href: DAILY_SESSION_HREF });

  await writeMeaningsInDailyStudy(store.db, false);
  for (const deckId of [SMART_DECK_IDS.mutashabihat, SMART_DECK_IDS.similarTails]) {
    await writeDeckReviewSettings(store.db, deckId, { newCardsLimit: 0, dailyReviewLimit: 20 });
  }
  expect(await resolveStudy(store.db, now)).toEqual({ kind: "home", reason: "done" });
});

it("puts an ayah plan's Retention cards in the review step, ahead of new memorization", async () => {
  await writeHifzPlan(store.db, applyPreset(DEFAULT_HIFZ_PLAN, "short_surahs"));
  // No new ayat, so only the due card can make this a review.
  await writeDeckReviewSettings(store.db, SMART_DECK_IDS.retention, { newCardsLimit: 0, dailyReviewLimit: 20 });
  expect(await resolveStudy(store.db, now)).toEqual({ kind: "memorize", href: "/hifz/memorize" });
  insertCard("2:255", SMART_DECK_IDS.retention, 2, iso(86_400_000));
  expect(await resolveStudy(store.db, now)).toEqual({ kind: "review", href: DAILY_SESSION_HREF });
});

it("opens memorization while new lines are open and a page is left, and reports it for Home", async () => {
  await writeHifzPlan(store.db, applyPreset(DEFAULT_HIFZ_PLAN, "part_time_adult"));
  const state = await loadStudyState(store.db, now);
  expect(state.step).toEqual({ kind: "memorize", href: "/hifz/memorize" });
  expect(state.memorizeOpen).toBe(true);
  // The lesson is the plan work left, which holds the full wird.
  expect(state.planLeft).toBe(1);
});

it("skips memorization with nowhere left to memorize, and says so for Home's full wird", async () => {
  // A long budget and cycle, so today's cycle review fits and new lines stay open.
  await writeHifzPlan(store.db, {
    ...applyPreset(DEFAULT_HIFZ_PLAN, "part_time_adult"),
    dailyBudgetMin: 240,
    cycleDays: 60,
  });
  const steady = store.sql.prepare(
    `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps,
      lapses, state, last_review, created_at, updated_at) VALUES (?, 'hifz-pages', ?, 365, 3, 1, 300, 0, 5, 0, 2, ?, ?, ?)`,
  );
  const memorizePages = (count: number) => {
    for (let page = 1; page <= count; page += 1) {
      steady.run(
        `page:madani15:${page}`,
        iso(-86_400_000 * 300),
        iso(86_400_000),
        iso(86_400_000 * 400),
        iso(86_400_000),
      );
    }
  };
  // Every page but the last in the plan's order: a target is left, so memorization opens.
  memorizePages(604);
  store.sql
    .prepare("DELETE FROM study_cards WHERE id = ?")
    .run(`page:madani15:${memorize.newPageOrder(DEFAULT_HIFZ_PLAN).at(-1)}`);
  const wird = await loadTodayWird(store.db, now);
  expect(wird && newMemorizationOpen(wird)).toBe(true);
  expect((await loadStudyState(store.db, now)).memorizeOpen).toBe(true);

  // The last page memorized too: new lines are open on paper, but there is nowhere to go.
  store.sql.exec("DELETE FROM study_cards");
  memorizePages(604);
  const full = await loadTodayWird(store.db, now);
  expect(full && newMemorizationOpen(full)).toBe(true);
  const state = await loadStudyState(store.db, now);
  expect(state.memorizeOpen).toBe(false);
  expect(state.step.kind).not.toBe("memorize");
});

it("opens memorization for a due second look even with no new lines", async () => {
  await writeHifzPlan(store.db, reviewOnly);
  jest.spyOn(memorize, "countSecondLooks").mockResolvedValue({ due: 1, nextAt: null, offeredAt: null });
  const state = await loadStudyState(store.db, now);
  expect(state.step).toEqual({ kind: "memorize", href: "/hifz/memorize" });
  expect(state.secondLooksDue).toBe(1);
  expect(state.planLeft).toBe(1);
});

it("opens the page review while pages are due", async () => {
  await writeHifzPlan(store.db, reviewOnly);
  insertCard("page:madani15:582", "hifz-pages", 2, iso(86_400_000));
  expect(await resolveStudy(store.db, now)).toEqual({ kind: "review", href: "/hifz/review" });
});

it("welcomes a returning user back before the review, without a level", async () => {
  await writeHifzPlan(store.db, reviewOnly);
  insertCard("page:madani15:582", "hifz-pages", 2, iso(86_400_000));
  const lastDay = addDays(today, -9);
  store.sql
    .prepare(
      `INSERT INTO habit_days (local_date, status, earned_status, minimum_met, full_met, manzil_cycle_completed, created_at, updated_at)
       VALUES (?, 'done', 'done', 1, 0, 0, ?, ?)`,
    )
    .run(lastDay, iso(86_400_000 * 9), iso(86_400_000 * 9));
  expect(await resolveStudy(store.db, now)).toEqual({
    kind: "welcome_back",
    href: { pathname: "/hifz/review", params: { mode: "welcome_back" } },
  });
});
