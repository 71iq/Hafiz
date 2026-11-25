import { getDeckTodayStats, readDeckReviewSettings, writeDeckReviewSettings } from "@/lib/fsrs/queries";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { DEFAULT_DECK_DAILY_REVIEW_LIMIT, DEFAULT_DECK_NEW_CARD_LIMIT } from "@/lib/fsrs/types";
import { atLocalTime } from "@/lib/habit/dates";
import { applyPreset, DEFAULT_HIFZ_PLAN, type HifzPlan } from "@/lib/hifz/plan";
import { applyHifzSetup } from "@/lib/hifz/setup";
import { startingDeckLimits } from "@/lib/hifz/starting-limits";
import { AYAH_NEW_CARDS_LIMIT_KEY } from "@/lib/hifz/unit-switch";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const SMART = Object.values(SMART_DECK_IDS);
const pagePlan: HifzPlan = applyPreset(DEFAULT_HIFZ_PLAN, "part_time_adult");
const shortSurahs: HifzPlan = applyPreset(DEFAULT_HIFZ_PLAN, "short_surahs");

describe("starting deck limits from the pace (issue 14)", () => {
  it.each([
    [10, { retention: 5, mutashabihat: 0, similarTails: 0, daily: 10 }],
    [20, { retention: 10, mutashabihat: 5, similarTails: 0, daily: 20 }],
    [30, { retention: 10, mutashabihat: 5, similarTails: 0, daily: 20 }],
    [60, { retention: 15, mutashabihat: 5, similarTails: 5, daily: 30 }],
    [90, { retention: 15, mutashabihat: 5, similarTails: 5, daily: 30 }],
  ])("gives %i minutes a day lighter limits on the settings steps", (dailyBudgetMin, expected) => {
    const limits = startingDeckLimits({ dailyBudgetMin });
    expect(limits[SMART_DECK_IDS.retention]?.newCardsLimit).toBe(expected.retention);
    expect(limits[SMART_DECK_IDS.mutashabihat]?.newCardsLimit).toBe(expected.mutashabihat);
    expect(limits[SMART_DECK_IDS.similarTails]?.newCardsLimit).toBe(expected.similarTails);
    // Qira'at and Reasons of revelation keep the deck defaults: being off keeps them out of daily
    // study, and a zero would leave a deck turned on later with nothing to offer (SPEC 3.7).
    expect(limits[SMART_DECK_IDS.qiraat]).toBeUndefined();
    expect(limits[SMART_DECK_IDS.reasonsOfRevelation]).toBeUndefined();
    for (const deckId of [SMART_DECK_IDS.retention, SMART_DECK_IDS.mutashabihat, SMART_DECK_IDS.similarTails]) {
      const limit = limits[deckId]!;
      expect(limit.dailyReviewLimit).toBe(expected.daily);
      expect(limit.dailyReviewLimit % 10).toBe(0);
      expect(limit.dailyReviewLimit).toBeGreaterThanOrEqual(10);
      expect(limit.newCardsLimit % 5).toBe(0);
    }
  });
});

describe("applyHifzSetup writes starting limits only on a true first setup", () => {
  let store: OutboxDatabase;
  const now = atLocalTime("2026-11-13", 9 * 60);

  beforeEach(async () => {
    store = await openOutboxDatabase();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    // Page 1 holds al-Fatihah 1-4 and page 2 holds al-Baqarah 1-3 in this fixture.
    const ayah = store.sql.prepare(
      "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, 'x', 'x', 'x', ?)",
    );
    for (const n of [1, 2, 3, 4]) ayah.run(1, n, 1);
    for (const n of [1, 2, 3]) ayah.run(2, n, 2);
  });

  afterEach(async () => {
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
    jest.restoreAllMocks();
  });

  const setup = (plan: HifzPlan, at = now) =>
    applyHifzSetup(store.db, { plan, memorizedSurahs: [1, 2], memorizedJuz: [], now: at });
  const limits = async (deckId: string) => {
    const { newCardsLimit, dailyReviewLimit } = await readDeckReviewSettings(store.db, deckId);
    return { newCardsLimit, dailyReviewLimit };
  };
  const stored = (key: string) =>
    (store.sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(key) as { value: string } | undefined)
      ?.value ?? null;
  function lastQueued(rowId: string): Record<string, unknown> | null {
    const row = store.sql
      .prepare("SELECT data FROM sync_queue WHERE table_name = 'user_settings' AND row_id = ? ORDER BY id DESC LIMIT 1")
      .get(rowId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }
  function logReview() {
    store.sql
      .prepare(
        `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
         VALUES ('1:1', 3, 2, ?, 1, 1, 0, 1, ?)`,
      )
      .run(now.toISOString(), new Date(now.getTime() - 86_400_000).toISOString());
  }

  it("lightens every smart deck for page review, keeps the ayah deck at 0 new and records the pace's ayah limit", async () => {
    await setup(pagePlan);

    expect(await limits(SMART_DECK_IDS.retention)).toEqual({ newCardsLimit: 0, dailyReviewLimit: 20 });
    expect(stored(AYAH_NEW_CARDS_LIMIT_KEY)).toBe("10");
    expect(await limits(SMART_DECK_IDS.mutashabihat)).toEqual({ newCardsLimit: 5, dailyReviewLimit: 20 });
    expect(await limits(SMART_DECK_IDS.similarTails)).toEqual({ newCardsLimit: 0, dailyReviewLimit: 20 });
    // Qira'at and Reasons of revelation keep the deck defaults (SPEC 3.7), and so does Meanings.
    expect(stored(`review_settings_${SMART_DECK_IDS.qiraat}`)).toBeNull();
    expect(stored(`review_settings_${SMART_DECK_IDS.reasonsOfRevelation}`)).toBeNull();
    expect(stored("review_settings_meanings")).toBeNull();
    // Each setting queued its upload, so the limits reach the account like any deck setting.
    for (const deckId of [SMART_DECK_IDS.retention, SMART_DECK_IDS.mutashabihat, SMART_DECK_IDS.similarTails]) {
      const upload = lastQueued(`review_settings_${deckId}`);
      expect(upload).not.toBeNull();
      expect(JSON.parse(String(upload!.value))).toMatchObject(await limits(deckId));
    }
    expect(lastQueued(AYAH_NEW_CARDS_LIMIT_KEY)).toMatchObject({ value: "10" });
  });

  it("starts ayah review at the pace's new-card limit and adds no rows to decks that start at 0 or are off", async () => {
    await setup(shortSurahs);

    expect(await limits(SMART_DECK_IDS.retention)).toEqual({ newCardsLimit: 5, dailyReviewLimit: 10 });
    const retention = await getDeckTodayStats(
      store.db,
      SMART_DECK_IDS.retention,
      await readDeckReviewSettings(store.db, SMART_DECK_IDS.retention),
    );
    expect(retention).toMatchObject({ newCount: 5, dueCount: 0, heldBack: 0, total: 7 });
    const rows = store.sql.prepare("SELECT deck_id, COUNT(*) AS n FROM study_cards GROUP BY deck_id").all();
    expect(rows).toEqual([{ deck_id: SMART_DECK_IDS.retention, n: 5 }]);
  });

  it("leaves the limits alone on a later setup, even with another pace", async () => {
    await setup(pagePlan);
    await writeDeckReviewSettings(store.db, SMART_DECK_IDS.mutashabihat, {
      ...(await readDeckReviewSettings(store.db, SMART_DECK_IDS.mutashabihat)),
      newCardsLimit: 15,
    });
    const queued = store.sql
      .prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE row_id LIKE 'review_settings_%'")
      .get();

    await setup(applyPreset(DEFAULT_HIFZ_PLAN, "full_time"), new Date(now.getTime() + 60_000));

    expect(await limits(SMART_DECK_IDS.mutashabihat)).toEqual({ newCardsLimit: 15, dailyReviewLimit: 20 });
    expect(await limits(SMART_DECK_IDS.similarTails)).toEqual({ newCardsLimit: 0, dailyReviewLimit: 20 });
    expect(stored(AYAH_NEW_CARDS_LIMIT_KEY)).toBe("10");
    expect(
      store.sql.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE row_id LIKE 'review_settings_%'").get(),
    ).toEqual(queued);
  });

  it("leaves the defaults for someone who has already reviewed", async () => {
    logReview();

    await setup(pagePlan);

    // Page review still stops new ayah cards and records the limit the person had.
    expect(await limits(SMART_DECK_IDS.retention)).toEqual({
      newCardsLimit: 0,
      dailyReviewLimit: DEFAULT_DECK_DAILY_REVIEW_LIMIT,
    });
    expect(stored(AYAH_NEW_CARDS_LIMIT_KEY)).toBe(String(DEFAULT_DECK_NEW_CARD_LIMIT));
    for (const deckId of SMART.filter((id) => id !== SMART_DECK_IDS.retention)) {
      expect(stored(`review_settings_${deckId}`)).toBeNull();
    }
  });

  it("keeps a deck's stored or synced settings and lightens only the decks without any", async () => {
    await writeDeckReviewSettings(store.db, SMART_DECK_IDS.qiraat, { newCardsLimit: 15, dailyReviewLimit: 50 });

    await setup(pagePlan);

    expect(await limits(SMART_DECK_IDS.qiraat)).toEqual({ newCardsLimit: 15, dailyReviewLimit: 50 });
    expect(await limits(SMART_DECK_IDS.mutashabihat)).toEqual({ newCardsLimit: 5, dailyReviewLimit: 20 });
  });
});

describe("plan setup and the full-hafiz flag (SPEC 3.7)", () => {
  let store: OutboxDatabase;
  const now = atLocalTime("2026-11-13", 9 * 60);

  beforeEach(async () => {
    store = await openOutboxDatabase();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    // One ayah per page, so the whole Quran is 604 pages across the 30 juz.
    const ayah = store.sql.prepare(
      "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (2, ?, 'x', 'x', 'x', ?)",
    );
    for (let page = 1; page <= 604; page += 1) ayah.run(page, page);
  });

  afterEach(async () => {
    await store.close();
    jest.restoreAllMocks();
  });

  const flag = () =>
    (store.sql.prepare("SELECT value FROM user_settings WHERE key = 'habit_declared_whole_quran'").get() as { value: string } | undefined)
      ?.value ?? null;
  const switchOf = (deck: string) =>
    (store.sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(`habit_study_${deck}`) as { value: string } | undefined)
      ?.value ?? null;
  const allJuz = Array.from({ length: 30 }, (_, index) => index + 1);

  it("declares the whole Quran, turns both decks on and gives them new cards", async () => {
    await applyHifzSetup(store.db, { plan: pagePlan, memorizedSurahs: [], memorizedJuz: allJuz, now });

    expect(flag()).toBe("true");
    expect(switchOf("qiraat")).toBe("on");
    expect(switchOf("reasons")).toBe("on");
    expect((await readDeckReviewSettings(store.db, SMART_DECK_IDS.qiraat)).newCardsLimit).toBe(DEFAULT_DECK_NEW_CARD_LIMIT);
  });

  it("clears the flag for a smaller portion and leaves it alone when the step is empty", async () => {
    await applyHifzSetup(store.db, { plan: pagePlan, memorizedSurahs: [], memorizedJuz: [30], now });
    expect(flag()).toBe("false");
    expect(switchOf("qiraat")).toBeNull();

    await applyHifzSetup(store.db, { plan: pagePlan, memorizedSurahs: [], memorizedJuz: allJuz, now });
    expect(flag()).toBe("true");
    // A plan edit opens the memorized step empty: it says nothing about the portion.
    await applyHifzSetup(store.db, { plan: pagePlan, memorizedSurahs: [], memorizedJuz: [], now });
    expect(flag()).toBe("true");
  });
});
