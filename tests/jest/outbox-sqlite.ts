import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createConnectionOwner } from "@/lib/database/connection-owner";
import { createSchema, migrateUserSchema } from "@/lib/database/schema";
import type { AppDatabase } from "@/lib/database/types";

/**
 * Real app schema behind the production connection owner, backed by node:sqlite.
 * The owner serializes transactions like the app does, so a write made on the outer database
 * inside a transaction callback hangs instead of silently passing.
 */
export type OutboxDatabase = {
  db: AppDatabase;
  sql: DatabaseSync;
  /** Make the nth matching queue INSERT throw, counting from 1 after this call. */
  failQueueInsert(nth: number, table?: "sync_queue" | "qf_sync_queue"): void;
  queueInsertAttempts(): number;
  close(): Promise<void>;
};

function isSqlInputValue(value: unknown): value is SQLInputValue {
  return (
    value === null ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string" ||
    ArrayBuffer.isView(value)
  );
}

function bindValues(args: unknown[]): SQLInputValue[] {
  const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (!values.every(isSqlInputValue)) throw new Error("Invalid synthetic SQLite binding");
  return values;
}

export async function openOutboxDatabase(): Promise<OutboxDatabase> {
  const sql = new DatabaseSync(":memory:");
  let failure: { nth: number; table: string } | null = null;
  let attempts = 0;
  const owner = createConnectionOwner({
    execAsync: async (source) => {
      sql.exec(source);
    },
    prepareAsync: async (source) => {
      const statement = sql.prepare(source);
      return {
        executeAsync: async (...args: unknown[]) => {
          const values = bindValues(args);
          if (failure && new RegExp(`INSERT INTO ${failure.table}\\b`).test(source)) {
            attempts += 1;
            if (attempts === failure.nth) throw new Error(`Synthetic ${failure.table} write failure`);
          }
          const result = statement.columns().length ? null : statement.run(...values);
          return {
            changes: Number(result?.changes ?? 0),
            lastInsertRowId: Number(result?.lastInsertRowid ?? 0),
            getFirstAsync: async <T>() => (statement.get(...values) as T | undefined) ?? null,
            getAllAsync: async <T>() => statement.all(...values) as T[],
          };
        },
        finalizeAsync: async () => {},
      };
    },
    closeAsync: async () => sql.close(),
  });
  await createSchema(owner.database);
  await migrateUserSchema(owner.database);
  return {
    db: owner.database,
    sql,
    failQueueInsert(nth, table = "sync_queue") {
      failure = { nth, table };
      attempts = 0;
    },
    queueInsertAttempts: () => attempts,
    close: () => owner.close(),
  };
}
