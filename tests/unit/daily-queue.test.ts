import path from "node:path";
import { writeDeckReviewSettings } from "@/lib/fsrs/queries";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { localDateOf } from "@/lib/habit/dates";
import { applyPreset, DEFAULT_HIFZ_PLAN, writeHifzPlan } from "@/lib/hifz/plan";
import {
  addStudyMore,
  buildDailyQueue,
  countAyahReviewsDue,
  DAILY_SESSION_DECK_ID,
  loadDailyReviewQueue,
} from "@/lib/study/daily-queue";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/**
 * The daily queue (SPEC 3.2) over the bundled similar-verse data. With nothing studied, Mutashabihat
 * and Similar tails each offer their new cards as virtual rows, and the default 1-page minimum gives a
 * budget of 20.
 */
let store: OutboxDatabase;
const now = new Date();
const today = localDateOf(now);
const MUT = SMART_DECK_IDS.mutashabihat;
const TAILS = SMART_DECK_IDS.similarTails;

beforeEach(async () => {
  store = await openOutboxDatabase();
  store.sql.exec(`ATTACH DATABASE '${path.resolve(__dirname, "../../assets/data/quran.db")}' AS bundled`);
  for (const table of ["quran_text", "surahs", "mutashabihat_groups", "mutashabihat_refs"]) {
    store.sql.exec(`DELETE FROM main.${table}`);
    store.sql.exec(`INSERT INTO main.${table} SELECT * FROM bundled.${table}`);
  }
});

afterEach(async () => {
  await store.close();
});

const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
function insertCard(id: string, deckId: string, state: number, due: string) {
  store.sql
    .prepare(
      `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps,
        lapses, state, last_review, created_at, updated_at) VALUES (?, ?, ?, 2, 5, 1, 1, 0, 1, 0, ?, ?, ?, ?)`,
    )
    .run(id, deckId, due, state, iso(86_400_000), iso(86_400_000 * 5), iso(86_400_000 * 5));
}
function logReview(cardId: string, sessionDeck: string | null, makeupFor: string | null = null) {
  const sessionId = `s-${sessionDeck ?? "none"}`;
  store.sql
    .prepare(
      `INSERT OR IGNORE INTO review_sessions (id, kind, deck_id, started_at, local_date, tz, created_at, updated_at)
       VALUES (?, 'cards', ?, ?, ?, 'UTC', ?, ?)`,
    )
    .run(sessionId, sessionDeck, iso(60_000), today, iso(60_000), iso(60_000));
  store.sql
    .prepare(
      `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at,
        local_date, session_id, makeup_for) VALUES (?, 3, 2, ?, 2, 5, 1, 1, ?, ?, ?, ?)`,
    )
    .run(cardId, iso(0), iso(30_000), today, sessionId, makeupFor);
}
const ids = (items: readonly { card: { id: string } }[]) => items.map((item) => item.card.id);

it("caps the daily cards at twice the streak cards and counts the rest as held back", async () => {
  const queue = await buildDailyQueue(store.db, now);
  expect(queue).toMatchObject({
    streakCards: 10,
    baseBudget: 20,
    budget: 20,
    studiedToday: 0,
    heldBack: 20,
    leftAtBase: 20,
  });
  expect(queue.cards).toHaveLength(20);
  // New cards come from the decks in turn.
  expect(queue.cards.slice(0, 4).map((item) => item.card.deck_id)).toEqual([MUT, TAILS, MUT, TAILS]);
  expect(queue.perDeck).toEqual({ [MUT]: 10, [TAILS]: 10 });
  expect(queue.planCards).toEqual([]);
});

it("is read-only: Home's count creates no rows and queues no uploads", async () => {
  await buildDailyQueue(store.db, now);
  expect(store.sql.prepare("SELECT COUNT(*) AS n FROM study_cards").get()).toEqual({ n: 0 });
  expect(store.sql.prepare("SELECT COUNT(*) AS n FROM sync_queue").get()).toEqual({ n: 0 });
});

it("puts learning cards first, then reviews from the most overdue, then new cards", async () => {
  insertCard(`mutashabihat:nq-sim-8b30dec1a07d6e:0`, MUT, 2, iso(86_400_000 * 2));
  insertCard(`mutashabihat:nq-sim-8b30dec1a07d6e:1`, MUT, 2, iso(86_400_000 * 9));
  insertCard(`mutashabihat:nq-sim-8b30dec1a07d6e:2`, MUT, 1, iso(60_000));
  const queue = await buildDailyQueue(store.db, now);
  expect(ids(queue.cards).slice(0, 3)).toEqual([
    "mutashabihat:nq-sim-8b30dec1a07d6e:2",
    "mutashabihat:nq-sim-8b30dec1a07d6e:1",
    "mutashabihat:nq-sim-8b30dec1a07d6e:0",
  ]);
  expect(queue.cards[3].virtual).toBe(true);
});

it("spends the budget only on daily cards graded in a daily session, never on make-up or other sessions", async () => {
  insertCard("mutashabihat:nq-sim-8b30dec1a07d6e:0", MUT, 2, iso(-86_400_000));
  insertCard("mutashabihat:nq-sim-8b30dec1a07d6e:1", MUT, 2, iso(-86_400_000));
  insertCard("mutashabihat:nq-sim-8b30dec1a07d6e:2", MUT, 2, iso(-86_400_000));
  logReview("mutashabihat:nq-sim-8b30dec1a07d6e:0", DAILY_SESSION_DECK_ID);
  logReview("mutashabihat:nq-sim-8b30dec1a07d6e:1", MUT);
  logReview("mutashabihat:nq-sim-8b30dec1a07d6e:2", DAILY_SESSION_DECK_ID, "2026-01-01");
  const queue = await buildDailyQueue(store.db, now);
  expect(queue.studiedToday).toBe(1);
  expect(queue.cards).toHaveLength(19);
});

it("never cuts a card studied today that returns on a learning step", async () => {
  // Spend the whole budget in a daily session, with one card coming back on a learning step.
  for (let n = 0; n < 20; n += 1) {
    const id = `mutashabihat:nq-sim-8b30dec1a07d6e:${n}`;
    insertCard(id, MUT, n === 0 ? 3 : 2, n === 0 ? iso(1_000) : iso(-86_400_000));
    logReview(id, DAILY_SESSION_DECK_ID);
  }
  const queue = await buildDailyQueue(store.db, now);
  expect(queue.studiedToday).toBe(20);
  expect(ids(queue.cards)).toEqual(["mutashabihat:nq-sim-8b30dec1a07d6e:0"]);
  expect(queue.leftAtBase).toBe(1);
  expect(queue.heldBack).toBeGreaterThan(0);
});

it("opens one more budget with Study more, which the full wird ignores", async () => {
  await addStudyMore(store.db, now);
  const queue = await buildDailyQueue(store.db, now);
  expect(queue).toMatchObject({ budget: 40, baseBudget: 20, leftAtBase: 20 });
  expect(queue.cards).toHaveLength(40);
});

it("scales the budget with the minimum wird", async () => {
  store.sql
    .prepare("INSERT INTO user_settings (key, value, updated_at) VALUES ('hifz_minimum_wird', ?, ?)")
    .run(JSON.stringify({ pages: 0.5, minutes: 5 }), iso(0));
  expect(await buildDailyQueue(store.db, now)).toMatchObject({ streakCards: 5, budget: 10 });
});

it("keeps Retention out of a page plan, and makes it plan work outside the budget for an ayah plan", async () => {
  for (let ayah = 1; ayah <= 25; ayah += 1) insertCard(`2:${ayah}`, SMART_DECK_IDS.retention, 2, iso(86_400_000));
  await writeDeckReviewSettings(store.db, SMART_DECK_IDS.retention, { newCardsLimit: 0, dailyReviewLimit: 30 });

  await writeHifzPlan(store.db, applyPreset(DEFAULT_HIFZ_PLAN, "part_time_adult"));
  let queue = await buildDailyQueue(store.db, now);
  expect(queue.planCards).toEqual([]);
  expect(ids(queue.cards).some((id) => /^\d+:\d+$/.test(id))).toBe(false);

  await writeHifzPlan(store.db, applyPreset(DEFAULT_HIFZ_PLAN, "short_surahs"));
  queue = await buildDailyQueue(store.db, now);
  expect(queue.planCards).toHaveLength(25);
  expect(queue.cards).toHaveLength(20);
});

it("creates rows only for the virtual cards a session loads, inside the cut, and queues their upload", async () => {
  const items = await loadDailyReviewQueue(store.db, now);
  expect(items).toHaveLength(20);
  const rows = store.sql.prepare("SELECT id, deck_id FROM study_cards ORDER BY id").all() as {
    id: string;
    deck_id: string;
  }[];
  // Exactly the 20 cards inside the budget; the 20 held back stay virtual.
  expect(rows.map((row) => row.id).sort()).toEqual(items.map((item) => item.card.id).sort());
  const queued = store.sql.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE table_name = 'study_cards'").get() as {
    n: number;
  };
  expect(queued.n).toBe(20);
  // The same day's queue now lists those same cards, as real rows, ahead of the next candidates.
  const again = await buildDailyQueue(store.db, now);
  expect(again.cards.every((item) => !item.virtual)).toBe(true);
  expect(ids(again.cards).sort()).toEqual(ids(items).sort());
});

it("loads an ayah plan's Retention cards first, then the daily cards", async () => {
  await writeHifzPlan(store.db, applyPreset(DEFAULT_HIFZ_PLAN, "short_surahs"));
  await writeDeckReviewSettings(store.db, SMART_DECK_IDS.retention, { newCardsLimit: 0, dailyReviewLimit: 20 });
  insertCard("2:255", SMART_DECK_IDS.retention, 2, iso(86_400_000));
  const items = await loadDailyReviewQueue(store.db, now);
  expect(items[0].card.id).toBe("2:255");
  expect(items.slice(1).every((item) => item.card.deck_id !== SMART_DECK_IDS.retention)).toBe(true);
});

it("counts an ayah plan's reviews due the way its session shows them: a learning card counts past the daily limit", async () => {
  await writeHifzPlan(store.db, applyPreset(DEFAULT_HIFZ_PLAN, "short_surahs"));
  // The lowest daily limit, 10, already spent on ayat reviewed today.
  await writeDeckReviewSettings(store.db, SMART_DECK_IDS.retention, { newCardsLimit: 0, dailyReviewLimit: 10 });
  for (let ayah = 10; ayah < 20; ayah += 1) {
    insertCard(`2:${ayah}`, SMART_DECK_IDS.retention, 2, iso(-86_400_000));
    logReview(`2:${ayah}`, SMART_DECK_IDS.retention);
  }
  insertCard("2:3", SMART_DECK_IDS.retention, 3, iso(60_000)); // relearning, due now
  insertCard("2:4", SMART_DECK_IDS.retention, 2, iso(86_400_000)); // review due, but the limit is spent
  expect(await countAyahReviewsDue(store.db)).toBe(1);
  const queue = await buildDailyQueue(store.db, now);
  expect(ids(queue.planCards)).toEqual(["2:3"]);
});
