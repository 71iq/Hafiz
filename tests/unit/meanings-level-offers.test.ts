import { acceptLevelOffer, declineLevelOffer, recordFirstReview } from "@/lib/meanings/session";
import { MEANINGS_SETTING_KEYS, readMeaningsSettings } from "@/lib/meanings/settings";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/** First reviews of new word cards offer a level change (SPEC 3.6). */
let store: OutboxDatabase;
const now = new Date(2026, 10, 25, 9, 0, 0);
const tomorrow = new Date(2026, 10, 26, 9, 0, 0);

beforeEach(async () => {
  store = await openOutboxDatabase();
  store.sql
    .prepare("INSERT INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)")
    .run(MEANINGS_SETTING_KEYS.level, "2", now.toISOString());
});

afterEach(async () => {
  await store.close();
});

async function record(outcome: "known" | "failed" | "other", times: number, at = now) {
  // The offer made during the run, if any.
  let offer = null;
  for (let i = 0; i < times; i += 1) offer = (await recordFirstReview(store.db, outcome, at)) ?? offer;
  return offer;
}

it("offers a higher level after five words known in a row, and a lower one after three failed in a row", async () => {
  expect(await record("known", 4)).toBeNull();
  expect(await record("known", 1)).toBe("raise");
  expect(await record("failed", 2)).toBeNull();
  expect(await record("failed", 1)).toBe("lower");
});

it("starts a run again after any other first review", async () => {
  await record("known", 4);
  await record("other", 1);
  expect(await record("known", 4)).toBeNull();
});

it("changes the level by one when accepted, and never past 0 to 5", async () => {
  await acceptLevelOffer(store.db, "raise");
  expect((await readMeaningsSettings(store.db)).level).toBe(3);
  await acceptLevelOffer(store.db, "lower");
  await acceptLevelOffer(store.db, "lower");
  await acceptLevelOffer(store.db, "lower");
  await acceptLevelOffer(store.db, "lower");
  expect((await readMeaningsSettings(store.db)).level).toBe(0);
  // At level 0 there is nothing lower to offer.
  expect(await record("failed", 3)).toBeNull();
});

it("does not repeat a declined offer the same day", async () => {
  expect(await record("known", 5)).toBe("raise");
  await declineLevelOffer(store.db, "raise", now);
  expect(await record("known", 5)).toBeNull();
  expect(await record("known", 5, tomorrow)).toBe("raise");
});
