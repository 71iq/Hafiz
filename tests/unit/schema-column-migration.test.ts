import { addColumnIfMissing, migrateUserSchema, readTableColumns } from "@/lib/database/schema";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

let store: OutboxDatabase | null = null;

afterEach(async () => {
  await store?.close();
  store = null;
});

const columnsOf = (table: string) =>
  store!.sql
    .prepare(`SELECT name FROM pragma_table_info('${table}')`)
    .all()
    .map((row) => String(row.name));

describe("user schema migration reads the schema once", () => {
  it("adds the columns a database from an older version lacks and backfills them", async () => {
    store = await openOutboxDatabase((sql) => {
      sql.exec(`
        CREATE TABLE study_cards (
          id TEXT PRIMARY KEY, deck_id TEXT NOT NULL, due TEXT NOT NULL, stability REAL NOT NULL,
          difficulty REAL NOT NULL, elapsed_days INTEGER NOT NULL, scheduled_days INTEGER NOT NULL,
          learning_steps INTEGER NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0,
          lapses INTEGER NOT NULL DEFAULT 0, state INTEGER NOT NULL DEFAULT 0, last_review TEXT
        );
        INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, last_review)
          VALUES ('2:255', 'synthetic', '2026-02-01T00:00:00.000Z', 1, 1, 0, 1, '2026-01-31T00:00:00.000Z');
        CREATE TABLE highlights (
          id INTEGER PRIMARY KEY AUTOINCREMENT, surah INTEGER NOT NULL, ayah INTEGER NOT NULL,
          word_start INTEGER, word_end INTEGER, color TEXT NOT NULL, created_at TEXT NOT NULL
        );
        INSERT INTO highlights (surah, ayah, color, created_at) VALUES (2, 255, 'gold', '2026-01-05T00:00:00.000Z');
      `);
    });

    expect(columnsOf("study_cards")).toEqual(
      expect.arrayContaining([
        "created_at",
        "updated_at",
        "suspended_at",
        "buried_until",
        "marked_at",
        "deleted_at",
        "tier",
        "tier_changed_at",
      ]),
    );
    expect(columnsOf("highlights")).toEqual(expect.arrayContaining(["sync_id", "updated_at", "deleted_at"]));
    // The added timestamp columns take the legacy date as their default, as they always have.
    expect(store.sql.prepare("SELECT created_at, updated_at, deleted_at FROM study_cards").get()).toEqual({
      created_at: "1970-01-01T00:00:00.000Z",
      updated_at: "1970-01-01T00:00:00.000Z",
      deleted_at: null,
    });
    expect(store.sql.prepare("SELECT sync_id, updated_at FROM highlights").get()).toEqual({
      sync_id: "highlight:2:255:ayah:ayah:gold",
      updated_at: "2026-01-05T00:00:00.000Z",
    });
  });

  it("sends no column probe and no ALTER when the schema is current", async () => {
    store = await openOutboxDatabase();
    store.statements.length = 0;

    await migrateUserSchema(store.db);

    expect(store.statements.filter((source) => /ALTER TABLE/i.test(source))).toEqual([]);
    expect(store.statements.filter((source) => /^SELECT \w+ FROM \w+ LIMIT 1$/.test(source.trim()))).toEqual([]);
    expect(store.statements.filter((source) => source.includes("pragma_table_info"))).toHaveLength(1);
    // The sixteen legacy indexes go in one statement batch, not sixteen.
    expect(store.statements.length).toBeLessThan(10);
  });

  it("reports a missing table as a missing column and leaves the snapshot unchanged when the add fails", async () => {
    store = await openOutboxDatabase();
    const columns = await readTableColumns(store.db);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await addColumnIfMissing(store.db, columns, "absent_table", "note", "note TEXT");
    await addColumnIfMissing(store.db, columns, "bookmarks", "audit_note", "audit_note TEXT");
    await addColumnIfMissing(store.db, columns, "bookmarks", "AUDIT_NOTE", "audit_note TEXT");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(columns.has("absent_table")).toBe(false);
    expect(columnsOf("bookmarks").filter((name) => name === "audit_note")).toHaveLength(1);
    warn.mockRestore();
  });
});
