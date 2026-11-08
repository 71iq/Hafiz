import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SQLiteBindParams } from "expo-sqlite";
import type { TransactionDatabase } from "@/lib/database/types";
import { insertPreparedRows } from "@/lib/database/bulk-insert";

let sql: DatabaseSync;
let executeCalls = 0;

function transaction(): TransactionDatabase {
  return {
    prepareAsync: async (source: string) => {
      const statement = sql.prepare(source);
      return {
        executeAsync: async (...args: unknown[]) => {
          executeCalls++;
          const values = (Array.isArray(args[0]) ? args[0] : args) as SQLInputValue[];
          const result = statement.run(...values);
          return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
        },
        finalizeAsync: async () => {},
      };
    },
  } as unknown as TransactionDatabase;
}

function tableRows(table: string) {
  return sql.prepare(`SELECT * FROM ${table} ORDER BY surah, ayah, word_pos`).all();
}

function rowsFor(count: number): SQLiteBindParams[] {
  return Array.from({ length: count }, (_, i) => [1 + (i % 7), 1 + Math.floor(i / 7), 1 + (i % 3), `w${i}`, `v${i}`]);
}

beforeEach(() => {
  sql = new DatabaseSync(":memory:");
  executeCalls = 0;
  for (const name of ["multi", "single"]) {
    sql.exec(`CREATE TABLE ${name} (surah INTEGER, ayah INTEGER, word_pos INTEGER, word TEXT, value TEXT,
      PRIMARY KEY (surah, ayah, word_pos))`);
  }
});

afterEach(() => sql.close());

async function insertOneByOne(table: string, verb: string, rows: SQLiteBindParams[]) {
  const statement = sql.prepare(`${verb} INTO ${table} (surah, ayah, word_pos, word, value) VALUES (?, ?, ?, ?, ?)`);
  for (const row of rows) statement.run(...(row as SQLInputValue[]));
}

describe("RF-195 bulk inserts", () => {
  it.each(["INSERT OR REPLACE", "INSERT OR IGNORE"])(
    "%s stores the same rows as one statement per row, including repeated keys",
    async (verb) => {
      // 1,000 rows over 7 x 143 x 3 keys repeat keys, so replace/ignore order matters.
      const rows = rowsFor(1000);
      await insertPreparedRows(
        transaction(),
        `${verb} INTO multi (surah, ayah, word_pos, word, value) VALUES (?, ?, ?, ?, ?)`,
        rows,
      );
      await insertOneByOne("single", verb, rows);

      expect(tableRows("multi")).toEqual(tableRows("single"));
    },
  );

  it("sends many rows per native call within SQLite's 999 bound-value limit", async () => {
    await insertPreparedRows(
      transaction(),
      "INSERT OR REPLACE INTO multi (surah, ayah, word_pos, word, value) VALUES (?, ?, ?, ?, ?)",
      rowsFor(1000),
    );

    // 199 rows of 5 values per statement: 5 full chunks and one of 5 rows.
    expect(executeCalls).toBe(6);
  });

  it("keeps one call per row for statements that are not a single VALUES tuple", async () => {
    await insertOneByOne("multi", "INSERT", rowsFor(3));
    await insertPreparedRows(
      transaction(),
      "UPDATE multi SET value = ? WHERE surah = ? AND ayah = ? AND word_pos = ?",
      [
        ["x", 1, 1, 1],
        ["y", 2, 1, 2],
      ],
    );

    expect(executeCalls).toBe(2);
    expect(sql.prepare("SELECT value FROM multi ORDER BY surah").all()).toEqual([
      { value: "x" },
      { value: "y" },
      { value: "v2" },
    ]);
  });

  it("does nothing for no rows", async () => {
    await insertPreparedRows(
      transaction(),
      "INSERT INTO multi (surah, ayah, word_pos, word, value) VALUES (?, ?, ?, ?, ?)",
      [],
    );
    expect(executeCalls).toBe(0);
  });
});
