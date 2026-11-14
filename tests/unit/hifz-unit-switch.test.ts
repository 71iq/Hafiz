import { readDeckReviewSettings, writeDeckReviewSettings } from "@/lib/fsrs/queries";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { DEFAULT_DECK_NEW_CARD_LIMIT, type StudyCardRow } from "@/lib/fsrs/types";
import { atLocalTime, localDateOf } from "@/lib/habit/dates";
import { declareMemorizedPages, isMemorized, loadPageCards, toPlanPage } from "@/lib/hifz/pages";
import { isSyncableUserSetting } from "@/lib/database/user-settings";
import { DEFAULT_HIFZ_PLAN, readHifzPlan, writeHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { applyHifzSetup } from "@/lib/hifz/setup";
import { tierFor } from "@/lib/hifz/tiers";
import { pageCardId } from "@/lib/hifz/units";
import { AYAH_NEW_CARDS_LIMIT_KEY, UNIT_SWITCH_SUSPENDED_AT } from "@/lib/hifz/unit-switch";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const TODAY = "2026-11-13";
const DAY = 86_400_000;
const RETENTION = SMART_DECK_IDS.retention;
const USER_SUSPENDED_AT = "2026-11-01T08:00:00.000Z";
const pagePlan: HifzPlan = { ...DEFAULT_HIFZ_PLAN, unit: "page" };
const ayahPlan: HifzPlan = { ...DEFAULT_HIFZ_PLAN, unit: "ayah" };

describe("switching the recitation unit (UNIT-02, 7.6)", () => {
  let store: OutboxDatabase;
  const now = atLocalTime(TODAY, 9 * 60);
  const days = (count: number) => new Date(now.getTime() + count * DAY).toISOString();

  beforeEach(async () => {
    store = await openOutboxDatabase();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    // Page 1 holds al-Fatihah 1-4 and page 2 holds al-Baqarah 1-3 in this fixture.
    const ayah = store.sql.prepare(
      "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, 'x', 'x', 'x', ?)",
    );
    for (const n of [1, 2, 3, 4]) ayah.run(1, n, 1);
    for (const n of [1, 2, 3]) ayah.run(2, n, 2);
    // Page 1: every ayah reviewed, the last one suspended by the user.
    reviewed("1:1", { stability: 2, difficulty: 3, due: days(5), lastReview: days(-10) });
    reviewed("1:2", { stability: 8, difficulty: 4, due: days(1), lastReview: days(-3) });
    reviewed("1:3", { stability: 12, difficulty: 6, due: days(20), lastReview: days(-1) });
    reviewed("1:4", {
      stability: 40,
      difficulty: 7,
      due: days(9),
      lastReview: days(-20),
      suspendedAt: USER_SUSPENDED_AT,
    });
    // Page 2: one ayah is still new.
    reviewed("2:1", { stability: 5, difficulty: 5, due: days(2), lastReview: days(-2) });
    reviewed("2:2", { stability: 6, difficulty: 5, due: days(3), lastReview: days(-2) });
    newAyahCard("2:3");
    await writeHifzPlan(store.db, ayahPlan);
    await writeDeckReviewSettings(store.db, RETENTION, {
      ...(await readDeckReviewSettings(store.db, RETENTION)),
      newCardsLimit: 7,
    });
  });

  afterEach(async () => {
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
    jest.restoreAllMocks();
  });

  function insertCard(
    id: string,
    values: {
      state: number;
      stability: number;
      difficulty: number;
      due: string;
      lastReview: string | null;
      suspendedAt: string | null;
    },
  ) {
    store.sql
      .prepare(
        `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses,
           state, last_review, suspended_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, 0, ?, ?, ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      )
      .run(
        id,
        RETENTION,
        values.due,
        values.stability,
        values.difficulty,
        values.state === 0 ? 0 : 3,
        values.state,
        values.lastReview,
        values.suspendedAt,
      );
  }

  function reviewed(
    id: string,
    values: { stability: number; difficulty: number; due: string; lastReview: string; suspendedAt?: string },
  ) {
    insertCard(id, { state: 2, suspendedAt: null, ...values });
  }

  function newAyahCard(id: string) {
    insertCard(id, { state: 0, stability: 0, difficulty: 0, due: days(0), lastReview: null, suspendedAt: null });
  }

  const cardRow = (id: string) =>
    store.sql.prepare("SELECT * FROM study_cards WHERE id = ?").get(id) as unknown as StudyCardRow;
  const suspendedAt = (id: string) => cardRow(id).suspended_at;
  const newCardsLimit = async () => (await readDeckReviewSettings(store.db, RETENTION)).newCardsLimit;

  /** The data of the last upload queued for a row. */
  function lastQueued(table: string, rowId: string): Record<string, unknown> | null {
    const row = store.sql
      .prepare("SELECT data FROM sync_queue WHERE table_name = ? AND row_id = ? ORDER BY id DESC LIMIT 1")
      .get(table, rowId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  const setup = (plan: HifzPlan, at = now) =>
    applyHifzSetup(store.db, { plan, memorizedSurahs: [1, 2], memorizedJuz: [], now: at });

  it("makes a manzil page card from a page's reviewed ayah cards and suspends them, declaring a page with a new ayah", async () => {
    await expect(setup(pagePlan)).resolves.toEqual({ declaredPages: 1, migratedPages: 1 });

    expect(cardRow(pageCardId(1))).toMatchObject({
      stability: 10, // median of 2, 8, 12 and 40
      difficulty: 5, // mean of 3, 4, 6 and 7
      due: days(1), // the earliest due date
      last_review: days(-1),
      scheduled_days: 2,
      state: 2,
      tier: "manzil",
      suspended_at: null,
    });
    for (const id of ["1:1", "1:2", "1:3"]) expect(suspendedAt(id)).toBe(UNIT_SWITCH_SUSPENDED_AT);
    expect(suspendedAt("1:4")).toBe(USER_SUSPENDED_AT);

    // Page 2 takes the declared path and its ayah cards stay as they were.
    expect(cardRow(pageCardId(2))).toMatchObject({ state: 0, stability: 0, tier: "manzil.unverified" });
    for (const id of ["2:1", "2:2", "2:3"]) expect(suspendedAt(id)).toBeNull();
    expect(await newCardsLimit()).toBe(0);

    expect(lastQueued("study_cards", pageCardId(1))).toMatchObject({
      stability: 10,
      difficulty: 5,
      due: days(1),
      state: 2,
      tier: "manzil",
    });
    for (const id of ["1:1", "1:2", "1:3"])
      expect(lastQueued("study_cards", id)).toMatchObject({ suspended_at: UNIT_SWITCH_SUSPENDED_AT });
    expect(lastQueued("study_cards", "1:4")).toBeNull();
    expect(JSON.parse(String(lastQueued("user_settings", `review_settings_${RETENTION}`)?.value))).toMatchObject({
      newCardsLimit: 0,
    });
  });

  it("restores exactly the ayah cards it suspended and the new-card limit on the switch back, and sets the page card aside", async () => {
    await setup(pagePlan);
    const later = new Date(now.getTime() + 2 * DAY);
    await setup(ayahPlan, later);

    for (const id of ["1:1", "1:2", "1:3"]) {
      expect(suspendedAt(id)).toBeNull();
      expect(lastQueued("study_cards", id)).toMatchObject({ suspended_at: null });
    }
    expect(cardRow("1:2")).toMatchObject({ stability: 8, due: days(1) });
    expect(suspendedAt("1:4")).toBe(USER_SUSPENDED_AT);
    expect(await newCardsLimit()).toBe(7);
    expect(JSON.parse(String(lastQueued("user_settings", `review_settings_${RETENTION}`)?.value))).toMatchObject({
      newCardsLimit: 7,
    });
    expect(
      store.sql.prepare("SELECT 1 FROM user_settings WHERE key = ?").get(AYAH_NEW_CARDS_LIMIT_KEY),
    ).toBeUndefined();

    // The page card is kept with its schedule but suspended, so the same ayat are not reviewed twice.
    expect(cardRow(pageCardId(1))).toMatchObject({
      stability: 10,
      deleted_at: null,
      suspended_at: UNIT_SWITCH_SUSPENDED_AT,
    });
    expect(lastQueued("study_cards", pageCardId(1))).toMatchObject({ suspended_at: UNIT_SWITCH_SUSPENDED_AT });
    expect(cardRow(pageCardId(2))).toMatchObject({ deleted_at: null, suspended_at: null });

    // Page review again: the kept page card comes back as it was and its ayah cards step aside again.
    await expect(setup(pagePlan, new Date(later.getTime() + DAY))).resolves.toMatchObject({ migratedPages: 0 });
    expect(cardRow(pageCardId(1))).toMatchObject({ stability: 10, due: days(1), suspended_at: null });
    for (const id of ["1:1", "1:2", "1:3"]) expect(suspendedAt(id)).toBe(UNIT_SWITCH_SUSPENDED_AT);
    expect(await newCardsLimit()).toBe(0);
  });

  it("derives a page made from ayah cards as manzil and memorized before its first page grade", async () => {
    await setup(pagePlan);
    const cards = await loadPageCards(store.db, { today: TODAY, plan: pagePlan });
    const migrated = cards.find((card) => card.page === 1)!;
    expect(migrated).toMatchObject({ tier: "manzil", history: { declared: false, fromAyahReviews: true, grades: [] } });
    expect(isMemorized(migrated)).toBe(true);
    // Its manzil floor counts from the last ayah review, not as a page never reviewed.
    expect(toPlanPage(migrated, TODAY, now).lastReviewDate).toBe(localDateOf(new Date(migrated.row.last_review!)));
    // The ayah deck's limit before the switch syncs, so another device can restore it.
    expect(isSyncableUserSetting(AYAH_NEW_CARDS_LIMIT_KEY)).toBe(true);
    const declared = cards.find((card) => card.page === 2)!;
    expect(declared).toMatchObject({ tier: "manzil.unverified", history: { declared: true, fromAyahReviews: false } });
    expect(isMemorized(declared)).toBe(false);
  });

  it("gives a page declared before the migration, never reviewed, the schedule of its reviewed ayah cards", async () => {
    await declareMemorizedPages(store.db, { pages: [1], cycleDays: 30, now: new Date(now.getTime() - 5 * DAY) });
    const declared = cardRow(pageCardId(1));
    expect(declared).toMatchObject({ state: 0, tier: "manzil.unverified" });

    await expect(setup(pagePlan)).resolves.toMatchObject({ migratedPages: 1 });
    expect(cardRow(pageCardId(1))).toMatchObject({
      stability: 10,
      difficulty: 5,
      due: days(1),
      state: 2,
      tier: "manzil",
      created_at: declared.created_at,
    });
    expect(lastQueued("study_cards", pageCardId(1))).toMatchObject({ stability: 10, tier: "manzil" });
    for (const id of ["1:1", "1:2", "1:3"]) expect(suspendedAt(id)).toBe(UNIT_SWITCH_SUSPENDED_AT);
  });

  it("gives the ayah deck the default new-card limit when page review set it to 0 without a record", async () => {
    await writeHifzPlan(store.db, pagePlan);
    await writeDeckReviewSettings(store.db, RETENTION, {
      ...(await readDeckReviewSettings(store.db, RETENTION)),
      newCardsLimit: 0,
    });

    await setup(ayahPlan);
    expect(await newCardsLimit()).toBe(DEFAULT_DECK_NEW_CARD_LIMIT);
  });

  it("keeps the old plan and every card when a queued upload fails mid-switch", async () => {
    store.failQueueInsert(3);
    await expect(setup(pagePlan)).rejects.toThrow("Synthetic sync_queue write failure");

    expect((await readHifzPlan(store.db))?.unit).toBe("ayah");
    expect(store.sql.prepare("SELECT 1 FROM study_cards WHERE id = ?").get(pageCardId(1))).toBeUndefined();
    for (const id of ["1:1", "1:2", "1:3"]) expect(suspendedAt(id)).toBeNull();
    expect(await newCardsLimit()).toBe(7);
  });
});

describe("the tier of a page made from ayah cards", () => {
  const plan = DEFAULT_HIFZ_PLAN;

  it("is manzil before its first page grade, and follows its own grades after", () => {
    expect(tierFor({ declared: false, fromAyahReviews: true, firstFluentDate: null, grades: [] }, TODAY, plan)).toBe(
      "manzil",
    );
    expect(tierFor({ declared: true, fromAyahReviews: true, firstFluentDate: null, grades: [] }, TODAY, plan)).toBe(
      "manzil",
    );
    expect(tierFor({ declared: true, firstFluentDate: null, grades: [{ date: TODAY, rating: 1 }] }, TODAY, plan)).toBe(
      "manzil.needs_work",
    );
    expect(tierFor({ declared: true, firstFluentDate: null, grades: [] }, TODAY, plan)).toBe("manzil.unverified");
  });
});
