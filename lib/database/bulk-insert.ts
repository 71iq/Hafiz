import type { SQLiteBindParams } from "expo-sqlite";
import type { TransactionDatabase } from "@/lib/database/types";

const MAX_BOUND_VALUES = 999;
const SINGLE_TUPLE = /^(\s*INSERT\b[\s\S]*?\bVALUES\s*)(\(\s*\?(?:\s*,\s*\?)*\s*\))\s*;?\s*$/i;

async function runEach(tx: TransactionDatabase, sql: string, rows: readonly SQLiteBindParams[]): Promise<void> {
  const stmt = await tx.prepareAsync(sql);
  try {
    for (const row of rows) {
      await stmt.executeAsync(row);
    }
  } finally {
    await stmt.finalizeAsync();
  }
}

export async function insertPreparedRows(
  tx: TransactionDatabase,
  sql: string,
  rows: readonly SQLiteBindParams[],
): Promise<void> {
  if (rows.length === 0) return;
  const match = SINGLE_TUPLE.exec(sql);
  const width = match ? match[2].split("?").length - 1 : 0;
  if (!match || !rows.every((row) => Array.isArray(row) && row.length === width)) {
    await runEach(tx, sql, rows);
    return;
  }

  const perStatement = Math.max(1, Math.floor(MAX_BOUND_VALUES / width));
  const statementFor = (count: number) => match[1] + Array(count).fill(match[2]).join(", ");
  const full = Math.floor(rows.length / perStatement);
  if (full > 0) {
    const stmt = await tx.prepareAsync(statementFor(perStatement));
    try {
      for (let chunk = 0; chunk < full; chunk++) {
        const start = chunk * perStatement;
        await stmt.executeAsync(rows.slice(start, start + perStatement).flat() as SQLiteBindParams);
      }
    } finally {
      await stmt.finalizeAsync();
    }
  }
  const rest = rows.slice(full * perStatement);
  if (rest.length > 0) {
    const stmt = await tx.prepareAsync(statementFor(rest.length));
    try {
      await stmt.executeAsync(rest.flat() as SQLiteBindParams);
    } finally {
      await stmt.finalizeAsync();
    }
  }
}
