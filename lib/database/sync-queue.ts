import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Enqueue a sync operation. Called after every write to a syncable table
 * (study_cards, study_log, bookmarks, highlights).
 */
export async function enqueueSync(
  db: SQLiteDatabase,
  tableName: string,
  operation: "INSERT" | "UPDATE" | "DELETE",
  rowId: string,
  data: Record<string, any>
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue (table_name, operation, row_id, data, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [tableName, operation, rowId, JSON.stringify(data), new Date().toISOString()]
  );
}

/** Get count of pending sync entries */
export async function getPendingSyncCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'"
  );
  return row?.count ?? 0;
}

/** Get pending sync entries (oldest first) */
export async function getPendingSyncEntries(
  db: SQLiteDatabase,
  limit: number = 50
): Promise<SyncQueueEntry[]> {
  return db.getAllAsync<SyncQueueEntry>(
    "SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY id ASC LIMIT ?",
    [limit]
  );
}

/** Mark entries as synced */
export async function markSynced(
  db: SQLiteDatabase,
  ids: number[]
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await db.runAsync(
    `UPDATE sync_queue SET status = 'synced', synced_at = ? WHERE id IN (${placeholders})`,
    [new Date().toISOString(), ...ids]
  );
}

/** Mark entries as failed */
export async function markFailed(
  db: SQLiteDatabase,
  ids: number[]
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await db.runAsync(
    `UPDATE sync_queue SET status = 'failed' WHERE id IN (${placeholders})`,
    ids
  );
}

/** Clean up old synced entries (keep last 7 days) */
export async function cleanSyncedEntries(db: SQLiteDatabase): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  await db.runAsync(
    "DELETE FROM sync_queue WHERE status = 'synced' AND synced_at < ?",
    [cutoff.toISOString()]
  );
}

export type SyncQueueEntry = {
  id: number;
  table_name: string;
  operation: string;
  row_id: string;
  data: string;
  status: string;
  created_at: string;
  synced_at: string | null;
};
