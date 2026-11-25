import { MEANINGS_DECK_ID, readDeckReviewSettings, writeDeckReviewSettings } from "@/lib/fsrs/queries";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { DEFAULT_DECK_NEW_CARD_LIMIT } from "@/lib/fsrs/types";
import { readHabitSettings } from "@/lib/habit/settings";
import { applyPreset, DEFAULT_HIFZ_PLAN, writeHifzPlan } from "@/lib/hifz/plan";
import {
  DECLARED_WHOLE_QURAN_KEY,
  readDailyDeckIds,
  settleAutomaticDecks,
  STUDY_DECK_SETTING_KEYS,
  writeDeckSwitch,
  writeMeaningsInDailyStudy,
} from "@/lib/study/daily-decks";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

let store: OutboxDatabase;

beforeEach(async () => {
  store = await openOutboxDatabase();
});

afterEach(async () => {
  await store.close();
});

const setSetting = (key: string, value: string) =>
  store.sql
    .prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, '2026-11-25T00:00:00.000Z')")
    .run(key, value);
const queued = (key: string) =>
  store.sql.prepare("SELECT data FROM sync_queue WHERE table_name = 'user_settings' AND row_id = ?").all(key);

describe("daily decks (SPEC 3.6 to 3.8)", () => {
  it("are Mutashabihat, Similar tails and Meanings by default, and never Retention", async () => {
    expect(await readDailyDeckIds(store.db)).toEqual([
      SMART_DECK_IDS.mutashabihat,
      SMART_DECK_IDS.similarTails,
      MEANINGS_DECK_ID,
    ]);
  });

  it("leave Meanings out when it is turned off, and sync that choice", async () => {
    await writeMeaningsInDailyStudy(store.db, false);
    expect(await readDailyDeckIds(store.db)).toEqual([SMART_DECK_IDS.mutashabihat, SMART_DECK_IDS.similarTails]);
    expect(queued(STUDY_DECK_SETTING_KEYS.meanings)).toHaveLength(1);
  });

  it("add Qira'at and Reasons of revelation when on, or on automatic for a full hafiz", async () => {
    await writeDeckSwitch(store.db, "qiraat", "on");
    expect(await readDailyDeckIds(store.db)).toContain(SMART_DECK_IDS.qiraat);
    expect(await readDailyDeckIds(store.db)).not.toContain(SMART_DECK_IDS.reasonsOfRevelation);

    setSetting(DECLARED_WHOLE_QURAN_KEY, "true");
    expect(await readDailyDeckIds(store.db)).toContain(SMART_DECK_IDS.reasonsOfRevelation);

    await writeDeckSwitch(store.db, "reasons", "off");
    expect(await readDailyDeckIds(store.db)).not.toContain(SMART_DECK_IDS.reasonsOfRevelation);
  });

  it("count every memorized page as a full hafiz", async () => {
    const card = store.sql.prepare(
      `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
        reps, lapses, state, created_at, updated_at) VALUES (?, 'hifz-pages', '2026-12-01T00:00:00.000Z', 1, 1, 0, 0, 0, 1, 0, 2,
        '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`,
    );
    for (let page = 1; page <= 603; page += 1) card.run(`page:madani15:${page}`);
    expect(await readDailyDeckIds(store.db)).not.toContain(SMART_DECK_IDS.qiraat);
    card.run("page:madani15:604");
    expect(await readDailyDeckIds(store.db)).toContain(SMART_DECK_IDS.qiraat);
  });
});

describe("deck switches", () => {
  it("raise a zero new-card limit when a deck turns on, so the switch is never empty", async () => {
    await writeDeckReviewSettings(store.db, SMART_DECK_IDS.qiraat, { newCardsLimit: 0, dailyReviewLimit: 20 });
    await writeDeckSwitch(store.db, "qiraat", "on");
    expect((await readDeckReviewSettings(store.db, SMART_DECK_IDS.qiraat)).newCardsLimit).toBe(
      DEFAULT_DECK_NEW_CARD_LIMIT,
    );
  });

  it("keep a limit the user chose, and leave limits alone when a deck turns off", async () => {
    await writeDeckReviewSettings(store.db, SMART_DECK_IDS.qiraat, { newCardsLimit: 5, dailyReviewLimit: 20 });
    await writeDeckSwitch(store.db, "qiraat", "on");
    expect((await readDeckReviewSettings(store.db, SMART_DECK_IDS.qiraat)).newCardsLimit).toBe(5);

    await writeDeckReviewSettings(store.db, SMART_DECK_IDS.reasonsOfRevelation, {
      newCardsLimit: 0,
      dailyReviewLimit: 20,
    });
    await writeDeckSwitch(store.db, "reasons", "off");
    expect((await readDeckReviewSettings(store.db, SMART_DECK_IDS.reasonsOfRevelation)).newCardsLimit).toBe(0);
  });

  it("store On for automatic decks once the user is a full hafiz", async () => {
    await writeDeckReviewSettings(store.db, SMART_DECK_IDS.reasonsOfRevelation, {
      newCardsLimit: 0,
      dailyReviewLimit: 20,
    });
    await settleAutomaticDecks(store.db);
    expect(
      store.sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(STUDY_DECK_SETTING_KEYS.qiraat),
    ).toBeUndefined();

    setSetting(DECLARED_WHOLE_QURAN_KEY, "true");
    await writeDeckSwitch(store.db, "qiraat", "off");
    await settleAutomaticDecks(store.db);
    expect(
      store.sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(STUDY_DECK_SETTING_KEYS.qiraat),
    ).toEqual({ value: "off" });
    expect(
      store.sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(STUDY_DECK_SETTING_KEYS.reasons),
    ).toEqual({ value: "on" });
    expect((await readDeckReviewSettings(store.db, SMART_DECK_IDS.reasonsOfRevelation)).newCardsLimit).toBe(
      DEFAULT_DECK_NEW_CARD_LIMIT,
    );
  });
});

describe("the Retention flag follows the saved plan (SPEC 3.4)", () => {
  it("is on only for a plan that reviews by ayah", async () => {
    expect((await readHabitSettings(store.db)).retentionCounts).toBe(false);
    await writeHifzPlan(store.db, applyPreset(DEFAULT_HIFZ_PLAN, "part_time_adult"));
    expect((await readHabitSettings(store.db)).retentionCounts).toBe(false);
    await writeHifzPlan(store.db, applyPreset(DEFAULT_HIFZ_PLAN, "short_surahs"));
    expect((await readHabitSettings(store.db)).retentionCounts).toBe(true);
  });

  it("is off for an unreadable plan", async () => {
    setSetting("hifz_plan", "{not json");
    expect((await readHabitSettings(store.db)).retentionCounts).toBe(false);
  });
});
