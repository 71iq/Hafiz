import { DatabaseSync } from "node:sqlite";
import type { AppDatabase, TransactionDatabase } from "@/lib/database/types";
import {
  getDeckTodayStats,
  loadReviewQueue,
  readDeckReviewSettings,
  REVIEW_DECK_IDS,
  writeDeckReviewSettings,
} from "@/lib/fsrs/queries";
import { getDueCardsForReview, SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { State } from "@/lib/fsrs/scheduler";
import type { StudyCardRow } from "@/lib/fsrs/types";

jest.mock("@/lib/database/sync-queue", () => ({ enqueueSync: jest.fn(async () => undefined) }));

const NOW = new Date(2026, 10, 2, 12, 0, 0);
const QIRAAT = SMART_DECK_IDS.qiraat;

function minutesFromNow(minutes: number): string {
  return new Date(NOW.getTime() + minutes * 60_000).toISOString();
}

describe("review queue shared by Home and sessions", () => {
  let sql: DatabaseSync;
  let db: AppDatabase;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    sql = new DatabaseSync(":memory:");
    sql.exec(`
      CREATE TABLE user_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, deleted_at TEXT);
      CREATE TABLE qiraat_encyclopedia (surah INTEGER NOT NULL, ayah INTEGER NOT NULL, text TEXT, ayah_group TEXT, PRIMARY KEY(surah, ayah));
      CREATE TABLE quran_text (surah INTEGER NOT NULL, ayah INTEGER NOT NULL, text_clean TEXT, text_qcf2 TEXT, PRIMARY KEY(surah, ayah));
      CREATE TABLE asbab_al_nuzul (surah INTEGER NOT NULL, ayah INTEGER NOT NULL, occasions_json TEXT);
      CREATE TABLE mutashabihat_groups (id TEXT PRIMARY KEY, sort_order INTEGER, cue TEXT, kind TEXT);
      CREATE TABLE mutashabihat_refs (group_id TEXT, sort_order INTEGER, surah INTEGER, ayah INTEGER, tail_5 TEXT);
      CREATE TABLE study_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT NOT NULL,
        rating INTEGER NOT NULL DEFAULT 3,
        state INTEGER NOT NULL DEFAULT 0,
        reviewed_at TEXT NOT NULL
      );
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
      getAllAsync: async (query: string, params: (string | number | null)[] = []) => sql.prepare(query).all(...params),
      getFirstAsync: async (query: string, params: (string | number | null)[] = []) =>
        sql.prepare(query).get(...params) ?? null,
      runAsync: async (query: string, params: (string | number | null)[] = []) => sql.prepare(query).run(...params),
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
  });

  function insert(id: string, deckId: string, overrides: Partial<StudyCardRow> = {}) {
    const row: StudyCardRow = {
      id,
      deck_id: deckId,
      due: minutesFromNow(-24 * 60),
      stability: 5,
      difficulty: 4,
      elapsed_days: 1,
      scheduled_days: 1,
      learning_steps: 0,
      reps: 1,
      lapses: 0,
      state: State.Review,
      last_review: minutesFromNow(-2 * 24 * 60),
      suspended_at: null,
      buried_until: null,
      marked_at: null,
      created_at: minutesFromNow(-30 * 24 * 60),
      updated_at: minutesFromNow(-2 * 24 * 60),
      ...overrides,
    };
    const entries = Object.entries(row);
    sql
      .prepare(`INSERT INTO study_cards (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
      .run(...entries.map(([, value]) => value));
  }

  function qiraatCandidate(surah: number, ayah: number) {
    sql.prepare("INSERT INTO qiraat_encyclopedia (surah, ayah, text) VALUES (?, ?, ?)").run(surah, ayah, "Synthetic reading");
  }

  function ids(rows: StudyCardRow[]) {
    return rows.map((row) => row.id).sort();
  }

  it("treats a card due within the learn-ahead window as due on Home and in the session, and one hours out as not due", async () => {
    for (const ayah of [1, 2, 3]) qiraatCandidate(1, ayah);
    insert("qiraat:1:1", QIRAAT);
    insert("qiraat:1:2", QIRAAT, { state: State.Learning, due: minutesFromNow(10) });
    insert("qiraat:1:3", QIRAAT, { state: State.Learning, due: minutesFromNow(6 * 60) });
    const settings = await readDeckReviewSettings(db, QIRAAT);

    const home = await getDeckTodayStats(db, QIRAAT, settings);
    const session = await getDueCardsForReview(db, QIRAAT, { limit: settings.dailyReviewLimit });

    expect(ids(session)).toEqual(["qiraat:1:1", "qiraat:1:2"]);
    expect(home.dueCount + home.newCount).toBe(session.length);
  });

  it("pairs every Review all card with its own deck's settings instead of legacy defaults", async () => {
    qiraatCandidate(1, 1);
    insert("qiraat:1:1", QIRAAT);
    insert("word:2:255:3", "meanings");
    await writeDeckReviewSettings(db, QIRAAT, { learningSteps: ["7m"], requestRetention: 0.85 });
    await writeDeckReviewSettings(db, "meanings", { learningSteps: ["2h"], requestRetention: 0.9 });

    const queue = await loadReviewQueue(db);

    const byId = Object.fromEntries(queue.map((item) => [item.card.id, item.settings]));
    expect(Object.keys(byId).sort()).toEqual(["qiraat:1:1", "word:2:255:3"]);
    expect(byId["qiraat:1:1"]).toMatchObject({ learningSteps: ["7m"], requestRetention: 0.85 });
    expect(byId["word:2:255:3"]).toMatchObject({ learningSteps: ["2h"], requestRetention: 0.9 });
  });

  it("offers in Review all exactly what the deck rows count, including new smart cards without a row", async () => {
    for (const ayah of [1, 2, 3]) qiraatCandidate(1, ayah);
    insert("word:2:255:3", "meanings");
    let offered = 0;
    for (const deckId of REVIEW_DECK_IDS) {
      const stats = await getDeckTodayStats(db, deckId, await readDeckReviewSettings(db, deckId));
      offered += stats.dueCount + stats.newCount;
    }

    const queue = await loadReviewQueue(db);

    expect(queue.map((item) => item.card.id).sort()).toEqual(["qiraat:1:1", "qiraat:1:2", "qiraat:1:3", "word:2:255:3"]);
    expect(queue).toHaveLength(offered);
  });
});
