import type { SQLiteDatabase } from "expo-sqlite";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/lib/auth/store";
import {
  getPendingSyncEntries,
  markSynced,
  markFailed,
  cleanSyncedEntries,
  type SyncQueueEntry,
} from "./sync-queue";

export type SyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

/**
 * Process the local sync queue — push pending changes to Supabase.
 * Returns the number of entries successfully synced.
 */
export async function pushSyncQueue(db: SQLiteDatabase): Promise<number> {
  if (!isSupabaseConfigured()) return 0;

  const user = useAuthStore.getState().user;
  if (!user) return 0;

  const entries = await getPendingSyncEntries(db, 100);
  if (entries.length === 0) return 0;

  // Group entries by table for batch operations
  const groups = groupByTable(entries);
  const syncedIds: number[] = [];
  const failedIds: number[] = [];

  for (const [tableName, tableEntries] of Object.entries(groups)) {
    try {
      await pushTableEntries(tableName, tableEntries, user.id);
      syncedIds.push(...tableEntries.map((e) => e.id));
    } catch (err: any) {
      console.warn(`[Sync] Failed to push ${tableName}:`, err.message);
      failedIds.push(...tableEntries.map((e) => e.id));
    }
  }

  // Mark results
  if (syncedIds.length > 0) await markSynced(db, syncedIds);
  if (failedIds.length > 0) await markFailed(db, failedIds);

  // Clean up old synced entries periodically
  await cleanSyncedEntries(db);

  return syncedIds.length;
}

/**
 * Pull remote changes from Supabase to local SQLite.
 * For multi-device support: fetches data updated after last sync.
 */
export async function pullRemoteChanges(db: SQLiteDatabase): Promise<number> {
  if (!isSupabaseConfigured()) return 0;

  const user = useAuthStore.getState().user;
  if (!user) return 0;

  // Get last sync timestamp
  const lastSyncRow = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = 'last_pull_at'"
  );
  const lastPullAt = lastSyncRow?.value ?? "1970-01-01T00:00:00Z";

  let totalPulled = 0;

  try {
    // Pull study_cards
    totalPulled += await pullTable(db, "study_cards", user.id, lastPullAt, upsertStudyCard);

    // Pull study_log
    totalPulled += await pullTable(db, "study_log", user.id, lastPullAt, upsertStudyLog);

    // Pull bookmarks
    totalPulled += await pullTable(db, "bookmarks", user.id, lastPullAt, upsertBookmark);

    // Pull highlights
    totalPulled += await pullTable(db, "highlights", user.id, lastPullAt, upsertHighlight);

    // Update last pull timestamp
    await db.runAsync(
      "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('last_pull_at', ?)",
      [new Date().toISOString()]
    );
  } catch (err: any) {
    console.warn("[Sync] Pull failed:", err.message);
  }

  return totalPulled;
}

/**
 * Full sync: push local changes, then pull remote changes.
 */
export async function fullSync(db: SQLiteDatabase): Promise<{ pushed: number; pulled: number }> {
  const pushed = await pushSyncQueue(db);
  const pulled = await pullRemoteChanges(db);
  return { pushed, pulled };
}

// ─── Internal helpers ──────────────────────────────────────────

function groupByTable(entries: SyncQueueEntry[]): Record<string, SyncQueueEntry[]> {
  const groups: Record<string, SyncQueueEntry[]> = {};
  for (const entry of entries) {
    if (!groups[entry.table_name]) groups[entry.table_name] = [];
    groups[entry.table_name].push(entry);
  }
  return groups;
}

async function pushTableEntries(
  tableName: string,
  entries: SyncQueueEntry[],
  userId: string
): Promise<void> {
  for (const entry of entries) {
    const data = JSON.parse(entry.data);
    const operation = entry.operation;

    if (operation === "DELETE") {
      await pushDelete(tableName, entry.row_id, userId);
    } else {
      // INSERT or UPDATE → upsert
      await pushUpsert(tableName, data, userId);
    }
  }
}

async function pushUpsert(
  tableName: string,
  data: Record<string, any>,
  userId: string
): Promise<void> {
  const row = { ...data, user_id: userId };

  // Determine conflict columns based on table
  let onConflict: string;
  switch (tableName) {
    case "study_cards":
      onConflict = "user_id,id";
      break;
    case "study_log":
      // study_log uses auto-increment id; upsert by user_id + local id
      // For study_log, always insert (append-only)
      const { error: logError } = await supabase
        .from(tableName)
        .insert(row);
      if (logError && !logError.message.includes("duplicate")) throw logError;
      return;
    case "bookmarks":
      onConflict = "user_id,surah,ayah";
      break;
    case "highlights":
      onConflict = "user_id,id";
      break;
    default:
      onConflict = "user_id,id";
  }

  const { error } = await supabase
    .from(tableName)
    .upsert(row, { onConflict });

  if (error) throw error;
}

async function pushDelete(
  tableName: string,
  rowId: string,
  userId: string
): Promise<void> {
  // rowId format depends on table:
  // study_cards: "surah:ayah"
  // bookmarks: "surah:ayah"
  // highlights: numeric id
  let query = supabase.from(tableName).delete().eq("user_id", userId);

  switch (tableName) {
    case "study_cards":
      query = query.eq("id", rowId);
      break;
    case "bookmarks": {
      const [surah, ayah] = rowId.split(":").map(Number);
      query = query.eq("surah", surah).eq("ayah", ayah);
      break;
    }
    case "highlights":
      query = query.eq("id", parseInt(rowId, 10));
      break;
    default:
      query = query.eq("id", rowId);
  }

  const { error } = await query;
  if (error) throw error;
}

// ─── Pull helpers (remote → local SQLite) ──────────────────────

async function pullTable(
  db: SQLiteDatabase,
  tableName: string,
  userId: string,
  since: string,
  upsertFn: (db: SQLiteDatabase, row: any) => Promise<void>
): Promise<number> {
  // For tables with updated_at, filter by it. Otherwise use created_at.
  const timeCol = tableName === "study_cards" ? "updated_at" : "created_at";

  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("user_id", userId)
    .gt(timeCol, since)
    .order(timeCol, { ascending: true })
    .limit(500);

  if (error) throw error;
  if (!data || data.length === 0) return 0;

  await db.withTransactionAsync(async () => {
    for (const row of data) {
      await upsertFn(db, row);
    }
  });

  return data.length;
}

async function upsertStudyCard(db: SQLiteDatabase, row: any): Promise<void> {
  // Last-write-wins: only update if remote is newer
  const local = await db.getFirstAsync<{ updated_at: string }>(
    "SELECT updated_at FROM study_cards WHERE id = ?",
    [row.id]
  );

  if (local && local.updated_at >= row.updated_at) return; // Local is newer

  await db.runAsync(
    `INSERT OR REPLACE INTO study_cards
     (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days,
      learning_steps, reps, lapses, state, last_review, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.deck_id, row.due, row.stability, row.difficulty,
      row.elapsed_days, row.scheduled_days, row.learning_steps,
      row.reps, row.lapses, row.state, row.last_review,
      row.created_at, row.updated_at,
    ]
  );
}

async function upsertStudyLog(db: SQLiteDatabase, row: any): Promise<void> {
  // Study log is append-only: check if we already have this exact entry
  const existing = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM study_log WHERE card_id = ? AND reviewed_at = ?",
    [row.card_id, row.reviewed_at]
  );
  if (existing) return;

  await db.runAsync(
    `INSERT INTO study_log
     (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
    [
      row.card_id, row.rating, row.state, row.due, row.stability,
      row.difficulty, row.elapsed_days, row.scheduled_days, row.reviewed_at,
    ]
  );
}

async function upsertBookmark(db: SQLiteDatabase, row: any): Promise<void> {
  await db.runAsync(
    "INSERT OR IGNORE INTO bookmarks (surah, ayah, created_at) VALUES (?, ?, ?)",
    [row.surah, row.ayah, row.created_at]
  );
}

async function upsertHighlight(db: SQLiteDatabase, row: any): Promise<void> {
  // Check if we already have this highlight
  const existing = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM highlights WHERE surah = ? AND ayah = ? AND color = ? AND word_start IS ? AND word_end IS ?",
    [row.surah, row.ayah, row.color, row.word_start, row.word_end]
  );
  if (existing) return;

  await db.runAsync(
    "INSERT INTO highlights (surah, ayah, word_start, word_end, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [row.surah, row.ayah, row.word_start, row.word_end, row.color, row.created_at]
  );
}
