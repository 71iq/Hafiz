import { DatabaseSync } from "node:sqlite";
import type { AppDatabase, TransactionDatabase } from "@/lib/database/types";
import { enqueueSync } from "@/lib/database/sync-queue";
import {
  getDueCardsForReview,
  getSmartDeckCandidateCardIds,
  materializeSmartDeckCards,
  SMART_DECK_IDS,
} from "@/lib/fsrs/smart-decks";
import type { StudyCardRow } from "@/lib/fsrs/types";

jest.mock("@/lib/database/sync-queue", () => ({ enqueueSync: jest.fn(async () => undefined) }));

const NOW = "2026-11-02T12:00:00.000Z";
const OLD = "2026-10-01T12:00:00.000Z";
const FUTURE = "2026-11-03T12:00:00.000Z";

describe("smart-deck and review queue SQLite contracts", () => {
  let sql: DatabaseSync;
  let db: AppDatabase;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
    jest.mocked(enqueueSync).mockClear();
    sql = new DatabaseSync(":memory:");
    sql.exec(`
      CREATE TABLE user_settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE qiraat_encyclopedia (surah INTEGER NOT NULL, ayah INTEGER NOT NULL, text TEXT, ayah_group TEXT, PRIMARY KEY(surah, ayah));
    CREATE TABLE study_cards (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      due TEXT NOT NULL,
      stability REAL NOT NULL,
      difficulty REAL NOT NULL,
      elapsed_days INTEGER NOT NULL,
      scheduled_days INTEGER NOT NULL,
      learning_steps INTEGER NOT NULL,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      state INTEGER NOT NULL DEFAULT 0,
      last_review TEXT,
      suspended_at TEXT,
      buried_until TEXT,
      marked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    `);
    // Only this test boundary adapts Expo's wider native API to real in-memory SQLite.
    const adapter = {
      getAllAsync: jest.fn(async (query: string, params: (string | number | null)[] = []) =>
        sql.prepare(query).all(...params),
      ),
      getFirstAsync: jest.fn(
        async (query: string, params: (string | number | null)[] = []) => sql.prepare(query).get(...params) ?? null,
      ),
      runAsync: jest.fn(async (query: string, params: (string | number | null)[] = []) =>
        sql.prepare(query).run(...params),
      ),
      withTransactionAsync: async (operation: (transaction: TransactionDatabase) => Promise<void>) => {
        sql.exec("BEGIN");
        try {
          await operation(db as unknown as TransactionDatabase);
          sql.exec("COMMIT");
        } catch (error) {
          sql.exec("ROLLBACK");
          throw error;
        }
      },
    };
    db = adapter as unknown as AppDatabase;
  });

  afterEach(() => {
    sql.close();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function card(id: string, overrides: Partial<StudyCardRow> = {}): StudyCardRow {
    return {
      id,
      deck_id: "custom",
      due: OLD,
      stability: 5,
      difficulty: 4,
      elapsed_days: 1,
      scheduled_days: 1,
      learning_steps: 0,
      reps: 1,
      lapses: 0,
      state: 2,
      last_review: OLD,
      suspended_at: null,
      buried_until: null,
      marked_at: null,
      created_at: OLD,
      updated_at: OLD,
      deleted_at: null,
      ...overrides,
    };
  }

  function insert(row: StudyCardRow) {
    const entries = Object.entries(row);
    sql
      .prepare(
        `INSERT INTO study_cards (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`,
      )
      .run(...entries.map(([, value]) => value));
  }

  function candidate(ayah: number, text: string | null = "Synthetic reading", surah = 1) {
    sql.prepare("INSERT INTO qiraat_encyclopedia (surah, ayah, text) VALUES (?, ?, ?)").run(surah, ayah, text);
  }

  function ids(rows: StudyCardRow[]) {
    return rows.map((row) => row.id);
  }

  it("applies due, active, burial and deck eligibility using bound SQL values", async () => {
    insert(card("eligible"));
    insert(card("deleted", { deleted_at: NOW }));
    insert(card("suspended", { suspended_at: OLD }));
    insert(card("buried", { buried_until: FUTURE }));
    insert(card("unburied-now", { buried_until: NOW }));
    insert(card("due-now", { due: NOW }));
    insert(card("future", { due: FUTURE }));
    insert(card("other-deck", { deck_id: "other" }));
    expect(ids(await getDueCardsForReview(db, "custom", { reviewSortOrder: "due" }))).toEqual([
      "eligible",
      "unburied-now",
      "due-now",
    ]);
    expect(ids(await getDueCardsForReview(db, "custom", { dueUntil: FUTURE, reviewSortOrder: "due" }))).toEqual([
      "eligible",
      "unburied-now",
      "due-now",
      "future",
    ]);
    expect(await getDueCardsForReview(db, "custom' OR 1=1 --")).toEqual([]);
  });

  it.each([
    ["reviewsFirst", ["review-early", "review-late", "new-old"]],
    ["newFirst", ["new-old", "review-early", "review-late"]],
    ["mixed", ["review-early", "new-old", "review-late"]],
  ] as const)("keeps %s ordering with independent new-card and total limits", async (order, expected) => {
    insert(card("review-late", { due: NOW }));
    insert(card("new-new", { state: 0, created_at: NOW }));
    insert(card("review-early"));
    insert(card("new-old", { state: 0 }));
    expect(
      ids(
        await getDueCardsForReview(db, "custom", {
          limit: 3,
          newCardsLimit: 1,
          newReviewOrder: order,
          reviewSortOrder: "due",
          newCardSortOrder: "created",
        }),
      ),
    ).toEqual(expected);
    expect(ids(await getDueCardsForReview(db, "custom", { newCardsLimit: 0, reviewSortOrder: "due" }))).toEqual([
      "review-early",
      "review-late",
    ]);
    expect(await getDueCardsForReview(db, "custom", 1)).toHaveLength(1);
  });

  it.each([
    ["oldest", ["fallback", "older", "newer"]],
    ["newest", ["newer", "older", "fallback"]],
  ] as const)("sorts %s reviews with created_at fallback", async (order, expected) => {
    insert(card("newer", { last_review: NOW }));
    insert(card("older", { last_review: "2026-10-15T12:00:00.000Z" }));
    insert(card("fallback", { last_review: null }));
    expect(ids(await getDueCardsForReview(db, "custom", { reviewSortOrder: order }))).toEqual(expected);
  });

  it("returns empty custom and smart decks without creating cards", async () => {
    expect(await getDueCardsForReview(db, "empty")).toEqual([]);
    expect(await getDueCardsForReview(db, SMART_DECK_IDS.qiraat)).toEqual([]);
    expect(await materializeSmartDeckCards(db, SMART_DECK_IDS.qiraat)).toBe(0);
    expect(enqueueSync).not.toHaveBeenCalled();
  });

  it("uses actual smart membership and configured ranges, excluding blank source rows", async () => {
    candidate(3);
    candidate(1);
    candidate(2, "   ");
    candidate(4, null);
    candidate(1, "Synthetic other", 2);
    expect(await getSmartDeckCandidateCardIds(db, SMART_DECK_IDS.qiraat)).toEqual([
      "qiraat:1:1",
      "qiraat:1:3",
      "qiraat:2:1",
    ]);
    sql
      .prepare("INSERT INTO user_settings VALUES (?, ?)")
      .run(
        "smart_deck_filter_default-qiraat",
        JSON.stringify({ type: "surah", surahs: [1], ranges: [{ surah: 1, ayahStart: 2, ayahEnd: 3 }] }),
      );
    for (const id of ["qiraat:1:1", "qiraat:1:2", "qiraat:1:3", "qiraat:2:1", "qiraat:9:9"])
      insert(card(id, { deck_id: SMART_DECK_IDS.qiraat }));
    expect(ids(await getDueCardsForReview(db, SMART_DECK_IDS.qiraat))).toEqual(["qiraat:1:3"]);
  });

  it("materializes only the new-card capacity and preserves active rows and timestamps on repeat", async () => {
    for (const n of [1, 2, 3, 4]) candidate(n);
    insert(card("qiraat:1:1", { deck_id: SMART_DECK_IDS.qiraat }));
    insert(card("qiraat:1:2", { deck_id: SMART_DECK_IDS.qiraat, state: 0 }));
    expect(await materializeSmartDeckCards(db, SMART_DECK_IDS.qiraat, 2, 2)).toBe(0);
    expect(await materializeSmartDeckCards(db, SMART_DECK_IDS.qiraat, 3, 2)).toBe(1);
    const before = sql.prepare("SELECT * FROM study_cards ORDER BY id").all();
    expect(before).toHaveLength(3);
    expect(sql.prepare("SELECT created_at, updated_at FROM study_cards WHERE id = ?").get("qiraat:1:3")).toEqual({
      created_at: NOW,
      updated_at: NOW,
    });
    jest.setSystemTime(new Date("2026-11-02T13:00:00.000Z"));
    expect(await materializeSmartDeckCards(db, SMART_DECK_IDS.qiraat, 3, 2)).toBe(0);
    expect(sql.prepare("SELECT * FROM study_cards ORDER BY id").all()).toEqual(before);
    expect(enqueueSync).toHaveBeenCalledTimes(1);
    expect(jest.mocked(enqueueSync).mock.calls[0].slice(1, 4)).toEqual(["study_cards", "INSERT", "qiraat:1:3"]);
  });

  it("revives a deleted candidate once without overwriting a live future card", async () => {
    candidate(1);
    candidate(2);
    insert(card("qiraat:1:1", { deck_id: SMART_DECK_IDS.qiraat, deleted_at: OLD }));
    const future = card("qiraat:1:2", { deck_id: SMART_DECK_IDS.qiraat, due: FUTURE });
    insert(future);
    expect(await materializeSmartDeckCards(db, SMART_DECK_IDS.qiraat, 1, 1)).toBe(1);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM study_cards").get()).toEqual({ n: 2 });
    expect(sql.prepare("SELECT * FROM study_cards WHERE id = ?").get(future.id)).toEqual(future);
    expect(
      sql.prepare("SELECT deleted_at, created_at, updated_at FROM study_cards WHERE id = ?").get("qiraat:1:1"),
    ).toEqual({ deleted_at: null, created_at: NOW, updated_at: NOW });
    expect(await materializeSmartDeckCards(db, SMART_DECK_IDS.qiraat, 1, 1)).toBe(0);
    expect(enqueueSync).toHaveBeenCalledTimes(1);
  });

  it("handles selection and insert batches without duplicate ids", async () => {
    for (let n = 1; n <= 1201; n++) candidate(n);
    expect(await materializeSmartDeckCards(db, SMART_DECK_IDS.qiraat, 1201, 1201)).toBe(1201);
    const rows = await getDueCardsForReview(db, SMART_DECK_IDS.qiraat, { newCardsLimit: 1201 });
    expect(rows).toHaveLength(1201);
    expect(new Set(ids(rows)).size).toBe(1201);
    expect(await materializeSmartDeckCards(db, SMART_DECK_IDS.qiraat, 1201, 1201)).toBe(0);
    expect(enqueueSync).toHaveBeenCalledTimes(1201);
  });
  it("uses configured random ordering as a permutation under controlled entropy", async () => {
    const entropy = jest.spyOn(Math, "random").mockReturnValue(0);
    for (const id of ["a", "b", "c"]) insert(card(id));
    insert(card("new-a", { state: 0 }));
    insert(card("new-b", { state: 0 }));
    const options = {
      reviewSortOrder: "random",
      newCardSortOrder: "random",
      newReviewOrder: "mixed",
      newCardsLimit: 2,
    } as const;
    const rows = await getDueCardsForReview(db, "custom", options);
    expect(ids(rows)).toEqual(["b", "new-b", "c", "new-a", "a"]);
    expect(entropy).toHaveBeenCalledTimes(3);
    expect(new Set(ids(rows)).size).toBe(5);
  });
  it("rolls back an earlier insert batch and emits no sync events when a later batch fails", async () => {
    for (let n = 1; n <= 501; n++) candidate(n);
    sql.exec(`CREATE TRIGGER reject_last BEFORE INSERT ON study_cards
      WHEN NEW.id = 'qiraat:1:501'
      BEGIN SELECT RAISE(ABORT, 'synthetic rejected insert'); END;`);
    await expect(materializeSmartDeckCards(db, SMART_DECK_IDS.qiraat, 501, 501)).rejects.toThrow(
      "synthetic rejected insert",
    );
    expect(sql.prepare("SELECT COUNT(*) AS n FROM study_cards").get()).toEqual({ n: 0 });
    expect(enqueueSync).not.toHaveBeenCalled();
  });
});
