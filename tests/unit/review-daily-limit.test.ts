import { DatabaseSync } from "node:sqlite";
import type { AppDatabase } from "@/lib/database/types";
import { getRemainingReviewLimit } from "@/lib/fsrs/queries";

const NOW = new Date(2026, 10, 2, 12, 0, 0);

describe("daily review limit", () => {
  let sql: DatabaseSync;
  let db: AppDatabase;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    sql = new DatabaseSync(":memory:");
    sql.exec(`
      CREATE TABLE study_cards (id TEXT PRIMARY KEY, deck_id TEXT NOT NULL, deleted_at TEXT);
      CREATE TABLE study_log (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL, reviewed_at TEXT NOT NULL);
    `);
    db = {
      getFirstAsync: async (query: string, params: (string | number | null)[] = []) =>
        sql.prepare(query).get(...params) ?? null,
    } as unknown as AppDatabase;
  });

  afterEach(() => {
    sql.close();
    jest.useRealTimers();
  });

  function review(cardId: string, deckId: string, minutesAgo: number) {
    sql.prepare("INSERT OR IGNORE INTO study_cards (id, deck_id) VALUES (?, ?)").run(cardId, deckId);
    const at = new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
    sql.prepare("INSERT INTO study_log (card_id, reviewed_at) VALUES (?, ?)").run(cardId, at);
  }

  it("counts a card once however many learning steps it took today", async () => {
    // A new card learned with Again, Good, Good writes three log rows but is one card of the day.
    review("a", "retention", 30);
    review("a", "retention", 29);
    review("a", "retention", 19);
    review("b", "retention", 10);

    await expect(getRemainingReviewLimit(db, "retention", 20)).resolves.toBe(18);
    await expect(getRemainingReviewLimit(db, undefined, 20)).resolves.toBe(18);
  });

  it("ignores reviews from earlier days and other decks", async () => {
    review("a", "retention", 60 * 24);
    review("b", "mutashabihat", 5);

    await expect(getRemainingReviewLimit(db, "retention", 20)).resolves.toBe(20);
  });
});
