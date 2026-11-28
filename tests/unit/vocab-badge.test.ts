import { backfillAchievements } from "@/lib/achievements/queries";
import { addMeaningCard, MEANINGS_DECK_ID } from "@/lib/fsrs/queries";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/** "First word saved" comes only from a word the user saves (SPEC 3.6), never from a generated card. */
let store: OutboxDatabase;

beforeEach(async () => {
  store = await openOutboxDatabase();
});

afterEach(async () => {
  await store.close();
});

const unlocked = () =>
  store.sql.prepare("SELECT COUNT(*) AS n FROM achievement_unlocks WHERE achievement_id = 'first_vocab_saved'").get();
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

it("does not unlock from word cards that daily study generated", async () => {
  const now = new Date().toISOString();
  store.sql
    .prepare(
      `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps,
        lapses, state, created_at, updated_at) VALUES ('word:2:255:10', ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
    )
    .run(MEANINGS_DECK_ID, now, now, now);
  await backfillAchievements(store.db);
  expect(unlocked()).toEqual({ n: 0 });
});

it("unlocks when the user saves a word, and the backfill keeps that unlock", async () => {
  await addMeaningCard(store.db, 2, 255, 10);
  await flush();
  expect(unlocked()).toEqual({ n: 1 });
  await backfillAchievements(store.db);
  expect(unlocked()).toEqual({ n: 1 });
});

it("does not bring the badge back from progress an account restore left behind", async () => {
  // A restore clears achievement_unlocks but keeps achievement_progress, so a previous person's
  // progress row can sit on the device with no unlock.
  await addMeaningCard(store.db, 2, 255, 10);
  await flush();
  store.sql.exec("DELETE FROM achievement_unlocks; DELETE FROM sync_queue;");
  await backfillAchievements(store.db);
  expect(unlocked()).toEqual({ n: 0 });
  expect(
    store.sql.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE table_name = 'achievement_unlocks'").get(),
  ).toEqual({ n: 0 });
  expect(
    store.sql
      .prepare("SELECT current_value FROM achievement_progress WHERE achievement_id = 'first_vocab_saved'")
      .get(),
  ).toEqual({ current_value: 0 });
});
