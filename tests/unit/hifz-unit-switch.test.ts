import type { SQLInputValue } from "node:sqlite";
import {
  readDeckReviewSettings,
  resetStudyCardProgress,
  setStudyCardSuspended,
  writeDeckReviewSettings,
} from "@/lib/fsrs/queries";
import { getDueCardsForReview, SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { DEFAULT_DECK_NEW_CARD_LIMIT, type StudyCardRow } from "@/lib/fsrs/types";
import { atLocalTime, localDateOf } from "@/lib/habit/dates";
import { declareMemorizedPages, isMemorized, loadPageCards, loadTodayWird, toPlanPage } from "@/lib/hifz/pages";
import { markUnitAppliedFromPlan, reconcileUnitAfterSync, unitReconcileNeeded } from "@/lib/hifz/unit-applied";
import { isSyncableUserSetting } from "@/lib/database/user-settings";
import { DEFAULT_HIFZ_PLAN, readHifzPlan, writeHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { loadDueRemediation } from "@/lib/hifz/remediation";
import { applyHifzSetup } from "@/lib/hifz/setup";
import { tierFor } from "@/lib/hifz/tiers";
import { HIFZ_PAGES_DECK_ID, pageCardId } from "@/lib/hifz/units";
import {
  AYAH_NEW_CARDS_LIMIT_KEY,
  UNIT_SWITCH_RESUMED_BURIED_UNTIL,
  UNIT_SWITCH_SUSPENDED_AT,
} from "@/lib/hifz/unit-switch";
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
  const minutes = (count: number) => new Date(now.getTime() + count * 60_000);

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

  it("keeps an ayah resumed by hand when a plan edit keeps page review", async () => {
    await setup(pagePlan);
    expect(suspendedAt("1:2")).toBe(UNIT_SWITCH_SUSPENDED_AT);
    store.sql.prepare("UPDATE study_cards SET suspended_at = NULL WHERE id = '1:2'").run();

    await expect(setup({ ...pagePlan, dailyBudgetMin: 45 }, new Date(now.getTime() + 60_000))).resolves.toMatchObject({ migratedPages: 0 });
    expect(suspendedAt("1:2")).toBeNull();
    // Page and half page are the same kind of review: no switch either.
    await setup({ ...pagePlan, unit: "half" }, new Date(now.getTime() + 120_000));
    expect(suspendedAt("1:2")).toBeNull();
  });

  it("brings the cards in line with a plan another device saved with the other kind of review", async () => {
    await setup(pagePlan);
    expect(suspendedAt("1:1")).toBe(UNIT_SWITCH_SUSPENDED_AT);
    // Sync brings the other device's ayah plan; this device's cards are still set for pages.
    await writeHifzPlan(store.db, { ...ayahPlan, dailyBudgetMin: 50 });
    const later = new Date(now.getTime() + 60_000);
    await store.db.withTransactionAsync((tx) => reconcileUnitAfterSync(tx, later));
    expect(suspendedAt("1:1")).toBeNull();
    expect(suspendedAt(pageCardId(1))).toBe(UNIT_SWITCH_SUSPENDED_AT);
    // Nothing more to do once the cards follow the plan.
    const queued = store.sql.prepare("SELECT COUNT(*) AS n FROM sync_queue").get() as { n: number };
    await store.db.withTransactionAsync((tx) => reconcileUnitAfterSync(tx, new Date(later.getTime() + 60_000)));
    expect((store.sql.prepare("SELECT COUNT(*) AS n FROM sync_queue").get() as { n: number }).n).toBe(queued.n);
  });

  it("brings back ayah cards another device's losing switch set aside, keeping the person's own suspension", async () => {
    await setup(ayahPlan);
    // Another device switched to pages; its ayah suspensions arrive, but this device's later ayah plan won.
    store.sql.prepare("UPDATE study_cards SET suspended_at = ? WHERE id IN ('1:1', '1:2')").run(UNIT_SWITCH_SUSPENDED_AT);
    const later = new Date(now.getTime() + 60_000);
    await store.db.withTransactionAsync((tx) => reconcileUnitAfterSync(tx, later));
    expect(suspendedAt("1:1")).toBeNull();
    expect(suspendedAt("1:2")).toBeNull();
    expect(suspendedAt("1:4")).toBe(USER_SUSPENDED_AT);
    expect(lastQueued("study_cards", "1:1")).toMatchObject({ suspended_at: null });
  });

  it("brings back page cards another device's losing switch set aside", async () => {
    await setup(pagePlan);
    store.sql.prepare("UPDATE study_cards SET suspended_at = ? WHERE id = ?").run(UNIT_SWITCH_SUSPENDED_AT, pageCardId(1));
    await store.db.withTransactionAsync((tx) => reconcileUnitAfterSync(tx, new Date(now.getTime() + 60_000)));
    expect(suspendedAt(pageCardId(1))).toBeNull();
    // The ayah cards this device set aside for page review stay set aside.
    expect(suspendedAt("1:1")).toBe(UNIT_SWITCH_SUSPENDED_AT);
  });

  it("lists a migrated page in today's wird although today's list was first built in ayah review", async () => {
    await setup(ayahPlan);
    const before = (await loadTodayWird(store.db, now))!;
    expect(before.todo).toEqual([]);
    await setup(pagePlan, new Date(now.getTime() + 60_000));
    const after = (await loadTodayWird(store.db, new Date(now.getTime() + 120_000)))!;
    expect(after.total).toBeGreaterThan(0);
    expect(after.daily.review.map((page) => page.cardId)).toEqual(expect.arrayContaining(after.todo.map((page) => page.cardId)));
    expect(after.todo.length).toBe(after.daily.review.length);
  });

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
    // A declared page with no ayah cards behind it is set aside too: ayah review has no page tasks.
    expect(cardRow(pageCardId(2))).toMatchObject({ deleted_at: null, suspended_at: UNIT_SWITCH_SUSPENDED_AT });

    // Page review again: the kept page card comes back as it was and its ayah cards step aside again.
    await expect(setup(pagePlan, new Date(later.getTime() + DAY))).resolves.toMatchObject({ migratedPages: 0 });
    expect(cardRow(pageCardId(1))).toMatchObject({ stability: 10, due: days(1), suspended_at: null });
    expect(cardRow(pageCardId(2))).toMatchObject({ tier: "manzil.unverified", suspended_at: null });
    for (const id of ["1:1", "1:2", "1:3"]) expect(suspendedAt(id)).toBe(UNIT_SWITCH_SUSPENDED_AT);
    expect(await newCardsLimit()).toBe(0);
  });

  it("sets every page, half-page and seam card aside in ayah review, lists no page task, and brings them all back for pages", async () => {
    await declareMemorizedPages(store.db, { pages: [3, 4], cycleDays: 1, now });
    await setup(pagePlan);
    const pageWird = (await loadTodayWird(store.db, now))!;
    expect(pageWird.todo.length).toBeGreaterThan(0);
    // A half page relearning after a missed page, a seam, and a page the user suspended by hand.
    for (const id of ["half:madani15:3:b", "seam:madani15:3"]) {
      store.sql
        .prepare(
          `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses,
             state, created_at, updated_at)
           VALUES (?, 'hifz-pages', ?, 1, 5, 0, 0, 1, 1, 1, 3, ?, ?)`,
        )
        .run(id, now.toISOString(), now.toISOString(), now.toISOString());
    }
    store.sql.prepare("UPDATE study_cards SET suspended_at = ? WHERE id = ?").run(USER_SUSPENDED_AT, pageCardId(4));

    const later = new Date(now.getTime() + 60_000);
    await setup(ayahPlan, later);
    for (const id of [pageCardId(1), pageCardId(2), pageCardId(3), "half:madani15:3:b", "seam:madani15:3"]) {
      expect(suspendedAt(id)).toBe(UNIT_SWITCH_SUSPENDED_AT);
      expect(lastQueued("study_cards", id)).toMatchObject({ suspended_at: UNIT_SWITCH_SUSPENDED_AT });
    }
    expect(suspendedAt(pageCardId(4))).toBe(USER_SUSPENDED_AT);
    const ayahWird = (await loadTodayWird(store.db, later))!;
    expect(ayahWird).toMatchObject({ todo: [], done: [], total: 0 });
    expect(await loadDueRemediation(store.db, new Date(later.getTime() + DAY))).toEqual([]);

    await setup(pagePlan, new Date(later.getTime() + 60_000));
    for (const id of [pageCardId(1), pageCardId(2), pageCardId(3), "half:madani15:3:b", "seam:madani15:3"]) {
      expect(suspendedAt(id)).toBeNull();
    }
    expect(suspendedAt(pageCardId(4))).toBe(USER_SUSPENDED_AT);
    expect((await loadTodayWird(store.db, new Date(later.getTime() + 120_000)))!.todo.length).toBeGreaterThan(0);
  });

  it("lists no page task in ayah review for a page card still live, as one synced from a device that had not switched", async () => {
    await setup(ayahPlan);
    await declareMemorizedPages(store.db, { pages: [3], cycleDays: 1, now });
    expect(suspendedAt(pageCardId(3))).toBeNull();
    expect((await loadTodayWird(store.db, now))!).toMatchObject({ todo: [], total: 0 });
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

  /** Every card row and the number of queued uploads. */
  const cardsAndQueue = () => ({
    cards: store.sql.prepare("SELECT * FROM study_cards ORDER BY id").all(),
    queued: (store.sql.prepare("SELECT COUNT(*) AS n FROM sync_queue").get() as { n: number }).n,
  });

  async function expectReconcileChangesNothing(at: Date) {
    expect(await unitReconcileNeeded(store.db)).toBe(false);
    const before = cardsAndQueue();
    await store.db.withTransactionAsync((tx) => reconcileUnitAfterSync(tx, at));
    expect(cardsAndQueue()).toEqual(before);
  }

  it("changes nothing on a reconcile after a switch, a switch back, and a switch back to a page no longer all reviewed", async () => {
    await setup(pagePlan);
    await setup(ayahPlan, minutes(1));
    // The ayah cards come back with the resume mark; the page cards step aside without it.
    for (const id of ["1:1", "1:2", "1:3"]) {
      expect(cardRow(id)).toMatchObject({ suspended_at: null, buried_until: UNIT_SWITCH_RESUMED_BURIED_UNTIL });
    }
    expect(cardRow(pageCardId(1))).toMatchObject({ suspended_at: UNIT_SWITCH_SUSPENDED_AT, buried_until: null });
    await expectReconcileChangesNothing(minutes(2));

    await setup(pagePlan, minutes(3));
    expect(cardRow(pageCardId(1))).toMatchObject({ suspended_at: null, buried_until: UNIT_SWITCH_RESUMED_BURIED_UNTIL });
    for (const id of ["1:1", "1:2", "1:3"]) {
      expect(cardRow(id)).toMatchObject({ suspended_at: UNIT_SWITCH_SUSPENDED_AT, buried_until: null });
    }
    await expectReconcileChangesNothing(minutes(4));

    // In ayah review 1:3 starts over, so page 1 no longer has every ayah reviewed and page review keeps
    // its ayah cards active. They drop the resume mark, so no reconcile sets them aside.
    await setup(ayahPlan, minutes(5));
    await resetStudyCardProgress(store.db, RETENTION, "1:3");
    await setup(pagePlan, minutes(6));
    for (const id of ["1:1", "1:2", "1:3"]) expect(cardRow(id)).toMatchObject({ suspended_at: null, buried_until: null });
    await expectReconcileChangesNothing(minutes(7));
  });

  it("sets aside, after an account restore, the ayah cards a losing switch to ayah review brought back", async () => {
    await setup(pagePlan);
    // The restored rows hold another device's switch to ayah review, which the page plan beat. The
    // server can return the marks in another format.
    store.sql.prepare("UPDATE study_cards SET suspended_at = NULL, buried_until = ? WHERE id = '1:1'").run(UNIT_SWITCH_RESUMED_BURIED_UNTIL);
    store.sql.prepare("UPDATE study_cards SET suspended_at = NULL, buried_until = '1970-01-01T00:00:00+00:00' WHERE id = '1:2'").run();
    store.sql.prepare("UPDATE study_cards SET suspended_at = '1970-01-01T00:00:00+00:00' WHERE id = ?").run(pageCardId(1));
    expect(await unitReconcileNeeded(store.db)).toBe(true);

    await store.db.withTransactionAsync((tx) => markUnitAppliedFromPlan(tx, minutes(1)));
    for (const id of ["1:1", "1:2"]) {
      expect(cardRow(id)).toMatchObject({ suspended_at: UNIT_SWITCH_SUSPENDED_AT, buried_until: null });
      expect(lastQueued("study_cards", id)).toMatchObject({ suspended_at: UNIT_SWITCH_SUSPENDED_AT, buried_until: null });
    }
    expect(cardRow(pageCardId(1))).toMatchObject({ suspended_at: null, buried_until: UNIT_SWITCH_RESUMED_BURIED_UNTIL });
    // Page 2's ayah cards, which page review keeps active, carry no mark and stay.
    for (const id of ["2:1", "2:2", "2:3"]) expect(suspendedAt(id)).toBeNull();
    expect(await unitReconcileNeeded(store.db)).toBe(false);
  });

  describe("after another device's switch that a later plan edit beat", () => {
    const devices: OutboxDatabase[] = [];
    const FAR = "2100-01-01T00:00:00.000Z";

    afterEach(async () => {
      for (const device of devices.splice(0)) await device.close();
    });

    const rowsOf = (device: OutboxDatabase, table: string) =>
      device.sql.prepare(`SELECT * FROM ${table}`).all() as Record<string, SQLInputValue>[];

    function putRow(device: OutboxDatabase, table: string, row: Record<string, SQLInputValue>) {
      const columns = Object.keys(row);
      device.sql
        .prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
        .run(...Object.values(row));
    }

    /** Device B, holding device A's (this store's) cards, plan and applied unit, as after a sync both ways. */
    async function secondDevice(): Promise<OutboxDatabase> {
      const device = await openOutboxDatabase();
      devices.push(device);
      for (const table of ["quran_text", "study_cards", "user_settings"]) {
        for (const row of rowsOf(store, table)) putRow(device, table, row);
      }
      return device;
    }

    /**
     * `to` pulls the cards `from` wrote later. A card's status columns, buried_until with suspended_at,
     * come with updated_at from the later write (upsertStudyCard in lib/database/sync.ts). No card is
     * reviewed here, so the schedules agree and the later row comes whole.
     */
    function pullCards(to: OutboxDatabase, from: OutboxDatabase) {
      for (const row of rowsOf(from, "study_cards")) {
        const local = to.sql.prepare("SELECT updated_at FROM study_cards WHERE id = ?").get(row.id) as
          | { updated_at: string }
          | undefined;
        if (!local || Date.parse(local.updated_at) < Date.parse(String(row.updated_at))) putRow(to, "study_cards", row);
      }
    }

    /** The end of a pull, as lib/database/sync runs it: the reconcile only when it has something to do. */
    async function reconcileAsSync(device: OutboxDatabase, at: Date) {
      if (await unitReconcileNeeded(device.db)) {
        await device.db.withTransactionAsync((tx) => reconcileUnitAfterSync(tx, at));
      }
    }

    const row = (device: OutboxDatabase, id: string) =>
      device.sql.prepare("SELECT * FROM study_cards WHERE id = ?").get(id) as unknown as StudyCardRow;
    /** The ayah flashcard queue, which counts a card as buried while buried_until is later than now. */
    const ayahQueue = async (device: OutboxDatabase) =>
      (await getDueCardsForReview(device.db, RETENTION, { dueUntil: FAR, limit: 100 })).map((card) => card.id).sort();
    const activePageCards = (device: OutboxDatabase) =>
      device.sql
        .prepare("SELECT id FROM study_cards WHERE deck_id = ? AND suspended_at IS NULL AND deleted_at IS NULL ORDER BY id")
        .all(HIFZ_PAGES_DECK_ID)
        .map((card) => card.id);

    it("leaves only page review active on both devices when a page plan edit beats a switch to ayah review", async () => {
      await setup(pagePlan);
      const deviceA = store;
      const deviceB = await secondDevice();
      // B switches to ayah review: its ayah cards come back with the resume mark and its page cards step aside.
      await applyHifzSetup(deviceB.db, { plan: ayahPlan, memorizedSurahs: [1, 2], memorizedJuz: [], now: minutes(1) });
      expect(row(deviceB, "1:1")).toMatchObject({ suspended_at: null, buried_until: UNIT_SWITCH_RESUMED_BURIED_UNTIL });
      // On A the person resumes 1:2 by hand, which leaves no mark, then edits the page plan, which wins.
      await setStudyCardSuspended(deviceA.db, RETENTION, "1:2", false);
      expect(row(deviceA, "1:2")).toMatchObject({ suspended_at: null, buried_until: null });
      const edited = { ...pagePlan, dailyBudgetMin: 45 };
      await setup(edited, minutes(3));

      pullCards(deviceA, deviceB);
      expect(await unitReconcileNeeded(deviceA.db)).toBe(true);
      await reconcileAsSync(deviceA, minutes(4));
      // Page tasks are in the wird, and of page 1 the ayah queue holds only the ayah resumed by hand.
      expect(await ayahQueue(deviceA)).toEqual(["1:2", "2:1", "2:2", "2:3"]);
      expect((await loadTodayWird(deviceA.db, minutes(4)))!.total).toBeGreaterThan(0);
      expect(activePageCards(deviceA)).toEqual([pageCardId(1), pageCardId(2)]);
      for (const id of ["1:1", "1:3"]) {
        expect(row(deviceA, id)).toMatchObject({ suspended_at: UNIT_SWITCH_SUSPENDED_AT, buried_until: null });
        expect(lastQueued("study_cards", id)).toMatchObject({ suspended_at: UNIT_SWITCH_SUSPENDED_AT, buried_until: null });
      }
      expect(row(deviceA, "1:4").suspended_at).toBe(USER_SUSPENDED_AT);
      expect(await unitReconcileNeeded(deviceA.db)).toBe(false);

      // B pulls A's plan and cards. Its switch to page review sets aside every live ayah card of a page
      // made from ayah cards, so it cannot keep 1:2: it does not know a resume by hand from a card
      // active in ayah review.
      await writeHifzPlan(deviceB.db, edited);
      pullCards(deviceB, deviceA);
      await reconcileAsSync(deviceB, minutes(5));
      const queueB = await ayahQueue(deviceB);
      for (const id of ["1:1", "1:3"]) expect(queueB).not.toContain(id);
      expect((await loadTodayWird(deviceB.db, minutes(5)))!.total).toBeGreaterThan(0);
      expect(activePageCards(deviceB)).toEqual([pageCardId(1), pageCardId(2)]);
      expect(await unitReconcileNeeded(deviceB.db)).toBe(false);
    });

    it("leaves only ayah review active on both devices when an ayah plan edit beats a switch to page review", async () => {
      await setup(pagePlan);
      await setup(ayahPlan, minutes(1));
      const deviceA = store;
      const deviceB = await secondDevice();
      // B switches to page review: its page cards come back with the resume mark and page 1's ayah cards step aside.
      await applyHifzSetup(deviceB.db, { plan: pagePlan, memorizedSurahs: [1, 2], memorizedJuz: [], now: minutes(2) });
      expect(row(deviceB, pageCardId(1))).toMatchObject({ suspended_at: null, buried_until: UNIT_SWITCH_RESUMED_BURIED_UNTIL });
      // On A the person resumes page 2 by hand, then edits the ayah plan, which wins.
      await setStudyCardSuspended(deviceA.db, HIFZ_PAGES_DECK_ID, pageCardId(2), false);
      const edited = { ...ayahPlan, dailyBudgetMin: 45 };
      await setup(edited, minutes(3));

      pullCards(deviceA, deviceB);
      expect(await unitReconcileNeeded(deviceA.db)).toBe(true);
      await reconcileAsSync(deviceA, minutes(4));
      expect(activePageCards(deviceA)).toEqual([pageCardId(2)]);
      expect(row(deviceA, pageCardId(1))).toMatchObject({ suspended_at: UNIT_SWITCH_SUSPENDED_AT, buried_until: null });
      expect(lastQueued("study_cards", pageCardId(1))).toMatchObject({ suspended_at: UNIT_SWITCH_SUSPENDED_AT });
      expect(await ayahQueue(deviceA)).toEqual(expect.arrayContaining(["1:1", "1:2", "1:3"]));
      expect(await unitReconcileNeeded(deviceA.db)).toBe(false);

      // B pulls A's plan and cards; its switch to ayah review sets every live page card aside.
      await writeHifzPlan(deviceB.db, edited);
      pullCards(deviceB, deviceA);
      await reconcileAsSync(deviceB, minutes(5));
      expect(activePageCards(deviceB)).toEqual([]);
      expect(await ayahQueue(deviceB)).toEqual(expect.arrayContaining(["1:1", "1:2", "1:3"]));
      expect(await unitReconcileNeeded(deviceB.db)).toBe(false);
    });
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
