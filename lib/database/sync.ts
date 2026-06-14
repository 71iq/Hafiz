import type { SQLiteDatabase } from "expo-sqlite";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/lib/auth/store";
import {
  getPendingSyncEntries,
  markSynced,
  markFailed,
  cleanSyncedEntries,
  enqueueSync,
  type SyncQueueEntry,
} from "./sync-queue";
import { backfillAchievements, insertRemoteAchievementUnlock } from "@/lib/achievements/queries";
import { isSyncableUserSetting, userSettingToSyncData } from "@/lib/database/user-settings";

export type SyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

const INITIAL_BACKFILL_VERSION = "20260525_sync_v1";
const USER_SETTINGS_BACKFILL_VERSION = "20260528_user_settings_v1";
const ACCOUNT_RESTORE_VERSION = "20260614_account_restore_v1";
const REMOTE_RESTORE_TABLES = [
  "user_settings",
  "user_word_meanings",
  "study_cards",
  "study_log",
  "bookmarks",
  "highlights",
  "private_notes",
  "reflection_journey_entries",
  "achievement_unlocks",
] as const;

type RemoteRestoreTable = typeof REMOTE_RESTORE_TABLES[number];
type RemoteAccountRows = Record<RemoteRestoreTable, any[]>;
type AccountRestoreResult = {
  pulled: number;
  accountRestored: boolean;
  localDataReplaced: boolean;
};

function highlightSyncId(row: {
  surah: number;
  ayah: number;
  word_start?: number | null;
  word_end?: number | null;
  color: string;
}): string {
  return `highlight:${row.surah}:${row.ayah}:${row.word_start ?? "ayah"}:${row.word_end ?? "ayah"}:${row.color}`;
}

/**
 * Process the local sync queue — push pending changes to Supabase.
 * Returns the number of entries successfully synced.
 */
async function pushSyncQueue(db: SQLiteDatabase): Promise<number> {
  if (!isSupabaseConfigured()) return 0;

  const user = useAuthStore.getState().user;
  if (!user) return 0;

  await enqueueInitialLocalDataForSync(db, user.id);
  await enqueueSyncableUserSettingsForSync(db, user.id);

  const entries = await getPendingSyncEntries(db, 10000);
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
async function pullRemoteChanges(db: SQLiteDatabase): Promise<number> {
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
    // Pull syncable deck/review settings before cards so decks exist when rows arrive.
    totalPulled += await pullTable(db, "user_settings", user.id, lastPullAt, upsertUserSetting);

    // Pull user-supplied word meanings before cards so vocabulary previews resolve.
    try {
      totalPulled += await pullTable(db, "user_word_meanings", user.id, lastPullAt, upsertUserWordMeaning);
    } catch (err: any) {
      console.warn("[Sync] Pull user_word_meanings skipped:", err.message);
    }

    // Pull study_cards
    totalPulled += await pullTable(db, "study_cards", user.id, lastPullAt, upsertStudyCard);

    // Pull study_log
    totalPulled += await pullTable(db, "study_log", user.id, lastPullAt, upsertStudyLog);

    // Pull bookmarks
    totalPulled += await pullTable(db, "bookmarks", user.id, lastPullAt, upsertBookmark);

    // Pull highlights
    totalPulled += await pullTable(db, "highlights", user.id, lastPullAt, upsertHighlight);

    // Pull private notes
    totalPulled += await pullTable(db, "private_notes", user.id, lastPullAt, upsertPrivateNote);

    // Pull Reflection Journey entries
    totalPulled += await pullTable(db, "reflection_journey_entries", user.id, lastPullAt, upsertReflectionJourneyEntry);

    // Pull public badge unlocks. Pulled badges are already seen locally.
    totalPulled += await pullTable(db, "achievement_unlocks", user.id, lastPullAt, upsertAchievementUnlock);

    await backfillAchievements(db, { notify: false });

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
 * Full sync: restore account state before any upload, then run normal queue sync.
 */
export async function fullSync(db: SQLiteDatabase): Promise<{ pushed: number; pulled: number; accountRestored: boolean; localDataReplaced: boolean }> {
  const restored = await restoreAccountDataIfNeeded(db);
  const pushed = await pushSyncQueue(db);
  const pulled = await pullRemoteChanges(db);
  return {
    pushed,
    pulled: restored.pulled + pulled,
    accountRestored: restored.accountRestored,
    localDataReplaced: restored.localDataReplaced,
  };
}

// ─── Internal helpers ──────────────────────────────────────────

function accountRestoreKey(userId: string): string {
  return `sync_account_restore_${userId}_${ACCOUNT_RESTORE_VERSION}`;
}

function isSyncInternalSetting(key: string): boolean {
  return key === "last_pull_at" ||
    key.startsWith("sync_initial_backfill_") ||
    key.startsWith("sync_user_settings_backfill_") ||
    key.startsWith("sync_account_restore_");
}

export async function hasCompletedAccountRestore(db: SQLiteDatabase, userId: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [accountRestoreKey(userId)]
  );
  return row?.value === "true";
}

async function markAccountRestoreComplete(db: SQLiteDatabase, userId: string, restoredFromRemote: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [accountRestoreKey(userId), now]
  );
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES ('last_pull_at', ?, ?, NULL)",
    [now, now]
  );
  if (!restoredFromRemote) return;
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [`sync_initial_backfill_${userId}_${INITIAL_BACKFILL_VERSION}`, now]
  );
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [userSettingsBackfillKey(userId), now]
  );
}

async function restoreAccountDataIfNeeded(db: SQLiteDatabase): Promise<AccountRestoreResult> {
  if (!isSupabaseConfigured()) return { pulled: 0, accountRestored: false, localDataReplaced: false };

  const user = useAuthStore.getState().user;
  if (!user) return { pulled: 0, accountRestored: false, localDataReplaced: false };

  if (await hasCompletedAccountRestore(db, user.id)) {
    return { pulled: 0, accountRestored: false, localDataReplaced: false };
  }

  const remoteRows = await fetchRemoteAccountRows(user.id);
  const remoteRowCount = REMOTE_RESTORE_TABLES.reduce((sum, tableName) => sum + remoteRows[tableName].length, 0);
  if (remoteRowCount === 0) {
    await markAccountRestoreComplete(db, user.id, false);
    return { pulled: 0, accountRestored: false, localDataReplaced: false };
  }

  const hadLocalData = await hasLocalSyncableData(db);
  await db.withTransactionAsync(async () => {
    await clearLocalSyncableData(db);
    await applyRemoteAccountRows(db, remoteRows);
    await markAccountRestoreComplete(db, user.id, true);
  });

  return {
    pulled: remoteRowCount,
    accountRestored: true,
    localDataReplaced: hadLocalData,
  };
}

async function fetchRemoteAccountRows(userId: string): Promise<RemoteAccountRows> {
  const rows = Object.fromEntries(REMOTE_RESTORE_TABLES.map((tableName) => [tableName, []])) as unknown as RemoteAccountRows;
  for (const tableName of REMOTE_RESTORE_TABLES) {
    try {
      rows[tableName] = await fetchRemoteRows(tableName, userId);
    } catch (err: any) {
      if (tableName === "user_word_meanings") {
        console.warn("[Sync] Restore user_word_meanings skipped:", err.message);
        continue;
      }
      throw err;
    }
  }
  return rows;
}

async function fetchRemoteRows(tableName: string, userId: string, since?: string): Promise<any[]> {
  const timeCol = "synced_at";
  const batchSize = 500;
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from(tableName)
      .select("*")
      .eq("user_id", userId);

    if (since) query = query.gt(timeCol, since);

    const { data, error } = await query
      .order(timeCol, { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < batchSize) break;
    offset += data.length;
  }

  return rows;
}

async function hasLocalSyncableData(db: SQLiteDatabase): Promise<boolean> {
  const [
    settings,
    cards,
    logs,
    bookmarks,
    highlights,
    notes,
    journeyEntries,
    achievements,
    wordMeanings,
  ] = await Promise.all([
    db.getAllAsync<{ key: string }>("SELECT key FROM user_settings"),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_cards"),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_log"),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM bookmarks"),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM highlights"),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM private_notes"),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM reflection_journey_entries"),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM achievement_unlocks"),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM user_word_meanings"),
  ]);

  return settings.some((row) => isSyncableUserSetting(row.key)) ||
    [cards, logs, bookmarks, highlights, notes, journeyEntries, achievements, wordMeanings]
      .some((row) => (row?.count ?? 0) > 0);
}

async function clearLocalSyncableData(db: SQLiteDatabase): Promise<void> {
  await db.runAsync("DELETE FROM study_cards");
  await db.runAsync("DELETE FROM study_log");
  await db.runAsync("DELETE FROM bookmarks");
  await db.runAsync("DELETE FROM highlights");
  await db.runAsync("DELETE FROM private_notes");
  await db.runAsync("DELETE FROM reflection_journey_entries");
  await db.runAsync("DELETE FROM achievement_unlocks");
  await db.runAsync("DELETE FROM user_word_meanings");
  await db.runAsync("DELETE FROM sync_queue");
  await db.runAsync("DELETE FROM qf_sync_queue");

  const settings = await db.getAllAsync<{ key: string }>("SELECT key FROM user_settings");
  for (const row of settings) {
    if (isSyncableUserSetting(row.key) || isSyncInternalSetting(row.key)) {
      await db.runAsync("DELETE FROM user_settings WHERE key = ?", [row.key]);
    }
  }
}

async function applyRemoteAccountRows(db: SQLiteDatabase, rows: RemoteAccountRows): Promise<void> {
  for (const row of rows.user_settings) await upsertUserSetting(db, row);
  for (const row of rows.user_word_meanings) await upsertUserWordMeaning(db, row);
  for (const row of rows.study_cards) await upsertStudyCard(db, row);
  for (const row of rows.study_log) await upsertStudyLog(db, row);
  for (const row of rows.bookmarks) await upsertBookmark(db, row);
  for (const row of rows.highlights) await upsertHighlight(db, row);
  for (const row of rows.private_notes) await upsertPrivateNote(db, row);
  for (const row of rows.reflection_journey_entries) await upsertReflectionJourneyEntry(db, row);
  for (const row of rows.achievement_unlocks) await upsertAchievementUnlock(db, row);
}

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
      await pushDelete(tableName, entry.row_id, userId, data);
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
  const syncedAt = new Date().toISOString();
  const row = normalizeRemoteRow(tableName, { ...data, user_id: userId, synced_at: syncedAt });

  // Determine conflict columns based on table
  let onConflict: string;
  switch (tableName) {
    case "user_settings":
      onConflict = "user_id,key";
      break;
    case "user_word_meanings":
      onConflict = "user_id,surah,ayah,word_pos";
      break;
    case "study_cards":
      onConflict = "user_id,id";
      break;
    case "study_log":
      await pushStudyLog(row, userId);
      return;
    case "highlights":
      onConflict = row.sync_id ? "user_id,sync_id" : "user_id,id";
      break;
    case "bookmarks":
      onConflict = "user_id,surah,ayah";
      break;
    case "private_notes":
      onConflict = "user_id,id";
      break;
    case "reflection_journey_entries":
      onConflict = "user_id,level_id";
      break;
    case "achievement_unlocks":
      onConflict = "user_id,achievement_id";
      break;
    default:
      onConflict = "user_id,id";
  }

  if (await remoteIsNewer(tableName, row, userId)) return;

  const { error } = await supabase
    .from(tableName)
    .upsert(row, { onConflict });

  if (error) throw error;
}

async function pushStudyLog(row: Record<string, any>, userId: string): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from("study_log")
    .select("id")
    .eq("user_id", userId)
    .eq("card_id", row.card_id)
    .eq("reviewed_at", row.reviewed_at)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return;

  const { error: logError } = await supabase
    .from("study_log")
    .insert(row);
  if (logError && !logError.message.includes("duplicate")) throw logError;
}

function normalizeRemoteRow(tableName: string, row: Record<string, any>): Record<string, any> {
  if (tableName === "highlights" && !row.sync_id && row.surah && row.ayah && row.color) {
    row.sync_id = highlightSyncId(row as any);
  }
  if (tableName === "highlights" && row.sync_id) {
    delete row.id;
  }

  if (tableName === "study_cards" || tableName === "highlights" || tableName === "user_settings" || tableName === "user_word_meanings") {
    row.deleted_at = row.deleted_at ?? null;
  }

  return row;
}

function rowTimestamp(row: Record<string, any>, tableName: string): string | null {
  if (tableName === "achievement_unlocks") return row.unlocked_at ?? row.synced_at ?? null;
  return row.updated_at ?? row.created_at ?? row.synced_at ?? null;
}

async function remoteIsNewer(
  tableName: string,
  row: Record<string, any>,
  userId: string
): Promise<boolean> {
  const localTimestamp = rowTimestamp(row, tableName);
  if (!localTimestamp || tableName === "study_log") return false;

  const timestampColumns = tableName === "achievement_unlocks"
    ? "unlocked_at, synced_at"
    : "updated_at, created_at, synced_at";
  let query = supabase
    .from(tableName)
    .select(timestampColumns)
    .eq("user_id", userId)
    .limit(1);

  switch (tableName) {
    case "user_settings":
      query = query.eq("key", row.key);
      break;
    case "user_word_meanings":
      query = query.eq("surah", row.surah).eq("ayah", row.ayah).eq("word_pos", row.word_pos);
      break;
    case "study_cards":
      query = query.eq("id", row.id);
      break;
    case "bookmarks":
      query = query.eq("surah", row.surah).eq("ayah", row.ayah);
      break;
    case "highlights":
      query = row.sync_id ? query.eq("sync_id", row.sync_id) : query.eq("id", row.id);
      break;
    case "private_notes":
      query = query.eq("id", row.id);
      break;
    case "reflection_journey_entries":
      query = query.eq("level_id", row.level_id);
      break;
    case "achievement_unlocks":
      query = query.eq("achievement_id", row.achievement_id);
      break;
    default:
      if (!row.id) return false;
      query = query.eq("id", row.id);
  }

  const { data, error } = await query;
  if (error) throw error;
  const remote = Array.isArray(data) ? data[0] : null;
  const remoteTimestamp = remote ? rowTimestamp(remote as Record<string, any>, tableName) : null;
  return Boolean(remoteTimestamp && remoteTimestamp > localTimestamp);
}

async function pushDelete(
  tableName: string,
  rowId: string,
  userId: string,
  data: Record<string, any> = {}
): Promise<void> {
  const deletedAt = data.deleted_at ?? new Date().toISOString();
  if (tableName === "user_settings") {
    await pushUpsert(tableName, {
      key: data.key ?? rowId,
      value: data.value ?? "",
      updated_at: data.updated_at ?? deletedAt,
      deleted_at: deletedAt,
    }, userId);
    return;
  }
  if (tableName === "user_word_meanings" && data.surah && data.ayah && data.word_pos) {
    await pushUpsert(tableName, {
      ...data,
      updated_at: data.updated_at ?? deletedAt,
      deleted_at: deletedAt,
    }, userId);
    return;
  }
  if (tableName === "study_cards" && data.deck_id) {
    await pushUpsert(tableName, {
      ...data,
      updated_at: data.updated_at ?? deletedAt,
      deleted_at: deletedAt,
    }, userId);
    return;
  }
  if (tableName === "highlights" && (data.sync_id || data.surah)) {
    await pushUpsert(tableName, {
      ...data,
      sync_id: data.sync_id ?? highlightSyncId(data as any),
      updated_at: data.updated_at ?? deletedAt,
      deleted_at: deletedAt,
    }, userId);
    return;
  }

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
      query = rowId.startsWith("highlight:")
        ? query.eq("sync_id", rowId)
        : query.eq("id", parseInt(rowId, 10));
      break;
    case "user_settings":
      query = query.eq("key", rowId);
      break;
    case "user_word_meanings": {
      const [surah, ayah, wordPos] = rowId.split(":").map(Number);
      query = query.eq("surah", surah).eq("ayah", ayah).eq("word_pos", wordPos);
      break;
    }
    case "private_notes":
      query = query.eq("id", rowId);
      break;
    case "reflection_journey_entries":
      query = query.eq("level_id", rowId);
      break;
    case "achievement_unlocks":
      query = query.eq("achievement_id", rowId);
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
  const timeCol = "synced_at";
  const batchSize = 500;
  let offset = 0;
  let total = 0;

  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .eq("user_id", userId)
      .gt(timeCol, since)
      .order(timeCol, { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    await db.withTransactionAsync(async () => {
      for (const row of data) {
        await upsertFn(db, row);
      }
    });

    total += data.length;
    if (data.length < batchSize) break;
    offset += data.length;
  }

  return total;
}

async function upsertUserSetting(db: SQLiteDatabase, row: any): Promise<void> {
  if (!isSyncableUserSetting(row.key)) return;
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;
  const local = await db.getFirstAsync<{ updated_at: string | null }>(
    "SELECT updated_at FROM user_settings WHERE key = ?",
    [row.key]
  );
  if (local?.updated_at && remoteUpdatedAt && local.updated_at >= remoteUpdatedAt) return;

  if (row.deleted_at) {
    await db.runAsync("DELETE FROM user_settings WHERE key = ?", [row.key]);
    return;
  }

  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, ?, ?, NULL)",
    [row.key, row.value, remoteUpdatedAt ?? new Date().toISOString()]
  );
}

async function upsertUserWordMeaning(db: SQLiteDatabase, row: any): Promise<void> {
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;
  const local = await db.getFirstAsync<{ updated_at: string | null }>(
    "SELECT updated_at FROM user_word_meanings WHERE surah = ? AND ayah = ? AND word_pos = ?",
    [row.surah, row.ayah, row.word_pos]
  );
  if (local?.updated_at && remoteUpdatedAt && local.updated_at >= remoteUpdatedAt) return;

  if (row.deleted_at) {
    await db.runAsync(
      "DELETE FROM user_word_meanings WHERE surah = ? AND ayah = ? AND word_pos = ?",
      [row.surah, row.ayah, row.word_pos]
    );
    return;
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO user_word_meanings
     (surah, ayah, word_pos, word, meaning, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.surah,
      row.ayah,
      row.word_pos,
      row.word ?? null,
      row.meaning,
      row.created_at ?? remoteUpdatedAt ?? new Date().toISOString(),
      remoteUpdatedAt ?? new Date().toISOString(),
    ]
  );
}

async function upsertStudyCard(db: SQLiteDatabase, row: any): Promise<void> {
  // Last-write-wins: only update if remote is newer
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;
  const local = await db.getFirstAsync<{ updated_at: string }>(
    "SELECT updated_at FROM study_cards WHERE id = ?",
    [row.id]
  );

  if (local && remoteUpdatedAt && local.updated_at >= remoteUpdatedAt) return; // Local is newer

  if (row.deleted_at) {
    await db.runAsync(
      `INSERT INTO study_cards
       (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days,
        learning_steps, reps, lapses, state, last_review, suspended_at, buried_until,
        marked_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        deck_id = excluded.deck_id,
        due = excluded.due,
        stability = excluded.stability,
        difficulty = excluded.difficulty,
        elapsed_days = excluded.elapsed_days,
        scheduled_days = excluded.scheduled_days,
        learning_steps = excluded.learning_steps,
        reps = excluded.reps,
        lapses = excluded.lapses,
        state = excluded.state,
        last_review = excluded.last_review,
        suspended_at = excluded.suspended_at,
        buried_until = excluded.buried_until,
        marked_at = excluded.marked_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at`,
      [
        row.id, row.deck_id ?? "deleted", row.due ?? remoteUpdatedAt, row.stability ?? 0, row.difficulty ?? 0,
        row.elapsed_days ?? 0, row.scheduled_days ?? 0, row.learning_steps ?? 0,
        row.reps ?? 0, row.lapses ?? 0, row.state ?? 0, row.last_review ?? null,
        row.suspended_at ?? null, row.buried_until ?? null, row.marked_at ?? null,
        row.created_at ?? remoteUpdatedAt, remoteUpdatedAt, row.deleted_at,
      ]
    );
    return;
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO study_cards
     (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days,
      learning_steps, reps, lapses, state, last_review, suspended_at, buried_until,
      marked_at, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      row.id, row.deck_id, row.due, row.stability, row.difficulty,
      row.elapsed_days, row.scheduled_days, row.learning_steps,
      row.reps, row.lapses, row.state, row.last_review,
      row.suspended_at ?? null, row.buried_until ?? null, row.marked_at ?? null,
      row.created_at, remoteUpdatedAt,
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
  const remoteUpdatedAt = row.updated_at ?? row.created_at;
  const local = await db.getFirstAsync<{ updated_at: string }>(
    "SELECT updated_at FROM bookmarks WHERE surah = ? AND ayah = ?",
    [row.surah, row.ayah]
  );
  if (local && local.updated_at >= remoteUpdatedAt) return;

  await db.runAsync(
    `INSERT OR REPLACE INTO bookmarks
      (surah, ayah, created_at, updated_at, deleted_at, qf_bookmark_id, qf_synced_at,
       qf_sync_error, qf_is_in_default_collection, qf_collections_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.surah,
      row.ayah,
      row.created_at,
      remoteUpdatedAt,
      row.deleted_at ?? null,
      row.qf_bookmark_id ?? null,
      row.qf_synced_at ?? null,
      row.qf_sync_error ?? null,
      row.qf_is_in_default_collection ? 1 : 0,
      row.qf_collections_count ?? 0,
    ]
  );
}

async function upsertHighlight(db: SQLiteDatabase, row: any): Promise<void> {
  const syncId = row.sync_id ?? highlightSyncId(row);
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;
  const existing = await db.getFirstAsync<{ id: number; updated_at: string | null }>(
    `SELECT id, updated_at FROM highlights
     WHERE sync_id = ?
        OR (surah = ? AND ayah = ? AND color = ? AND word_start IS ? AND word_end IS ?)
     LIMIT 1`,
    [syncId, row.surah, row.ayah, row.color, row.word_start, row.word_end]
  );
  if (existing?.updated_at && remoteUpdatedAt && existing.updated_at >= remoteUpdatedAt) return;

  if (row.deleted_at) {
    await db.runAsync(
      `DELETE FROM highlights
       WHERE sync_id = ?
          OR (surah = ? AND ayah = ? AND color = ? AND word_start IS ? AND word_end IS ?)`,
      [syncId, row.surah, row.ayah, row.color, row.word_start, row.word_end]
    );
    return;
  }

  if (existing) {
    await db.runAsync(
      `UPDATE highlights
       SET sync_id = ?, surah = ?, ayah = ?, word_start = ?, word_end = ?, color = ?,
           created_at = ?, updated_at = ?, deleted_at = NULL
       WHERE id = ?`,
      [
        syncId,
        row.surah,
        row.ayah,
        row.word_start,
        row.word_end,
        row.color,
        row.created_at,
        remoteUpdatedAt,
        existing.id,
      ]
    );
  } else {
    await db.runAsync(
      `INSERT INTO highlights
        (sync_id, surah, ayah, word_start, word_end, color, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [syncId, row.surah, row.ayah, row.word_start, row.word_end, row.color, row.created_at, remoteUpdatedAt]
    );
  }
}

async function upsertPrivateNote(db: SQLiteDatabase, row: any): Promise<void> {
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;
  const local = await db.getFirstAsync<{ updated_at: string }>(
    "SELECT updated_at FROM private_notes WHERE id = ?",
    [row.id]
  );
  if (local && remoteUpdatedAt && local.updated_at >= remoteUpdatedAt) return;
  const qfRangesJson =
    typeof row.qf_ranges_json === "string"
      ? row.qf_ranges_json
      : row.qf_ranges_json
        ? JSON.stringify(row.qf_ranges_json)
        : null;

  await db.runAsync(
    `INSERT OR REPLACE INTO private_notes
      (id, surah, ayah_start, ayah_end, content, created_at, updated_at, deleted_at,
       qf_note_id, qf_synced_at, qf_sync_error, qf_ranges_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.surah,
      row.ayah_start,
      row.ayah_end,
      row.content,
      row.created_at,
      remoteUpdatedAt,
      row.deleted_at,
      row.qf_note_id ?? null,
      row.qf_synced_at ?? null,
      row.qf_sync_error ?? null,
      qfRangesJson,
    ]
  );
}

async function upsertReflectionJourneyEntry(db: SQLiteDatabase, row: any): Promise<void> {
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;
  const local = await db.getFirstAsync<{ updated_at: string }>(
    "SELECT updated_at FROM reflection_journey_entries WHERE level_id = ?",
    [row.level_id]
  );
  if (local && remoteUpdatedAt && local.updated_at >= remoteUpdatedAt) return;

  await db.runAsync(
    `INSERT OR REPLACE INTO reflection_journey_entries
      (level_id, status, response_text, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      row.level_id,
      row.status,
      row.response_text,
      row.created_at,
      remoteUpdatedAt,
      row.completed_at,
    ]
  );
}

async function upsertAchievementUnlock(db: SQLiteDatabase, row: any): Promise<void> {
  await insertRemoteAchievementUnlock(db, {
    achievement_id: row.achievement_id,
    unlocked_at: row.unlocked_at,
    public_payload: row.public_payload,
  });
}

function safeJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function enqueueInitialLocalDataForSync(db: SQLiteDatabase, userId: string): Promise<void> {
  const backfillKey = `sync_initial_backfill_${userId}_${INITIAL_BACKFILL_VERSION}`;
  const settingsBackfillKey = userSettingsBackfillKey(userId);
  const done = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [backfillKey]
  );
  if (done?.value === "true") return;

  const [
    settings,
    cards,
    logs,
    bookmarks,
    highlights,
    privateNotes,
    journeyEntries,
    achievements,
    userWordMeanings,
  ] = await Promise.all([
    db.getAllAsync<{ key: string; value: string; updated_at: string | null; deleted_at: string | null }>(
      "SELECT key, value, updated_at, deleted_at FROM user_settings"
    ),
    db.getAllAsync<Record<string, any>>("SELECT * FROM study_cards"),
    db.getAllAsync<Record<string, any>>(
      `SELECT card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at
       FROM study_log`
    ),
    db.getAllAsync<Record<string, any>>("SELECT * FROM bookmarks"),
    db.getAllAsync<Record<string, any>>("SELECT * FROM highlights"),
    db.getAllAsync<Record<string, any>>("SELECT * FROM private_notes"),
    db.getAllAsync<Record<string, any>>("SELECT * FROM reflection_journey_entries"),
    db.getAllAsync<Record<string, any>>("SELECT achievement_id, unlocked_at, public_payload FROM achievement_unlocks"),
    db.getAllAsync<Record<string, any>>("SELECT surah, ayah, word_pos, word, meaning, created_at, updated_at FROM user_word_meanings"),
  ]);

  const enqueueBackfill = async (
    tableName: string,
    operation: "INSERT" | "UPDATE" | "DELETE",
    rowId: string,
    data: Record<string, any>
  ) => {
    await enqueueSync(db, tableName, operation, rowId, data).catch(console.warn);
  };

  for (const row of settings) {
    if (!isSyncableUserSetting(row.key)) continue;
    await enqueueBackfill("user_settings", "UPDATE", row.key, userSettingToSyncData(row));
  }
  for (const row of userWordMeanings) {
    await enqueueBackfill("user_word_meanings", "UPDATE", `${row.surah}:${row.ayah}:${row.word_pos}`, row);
  }
  for (const row of cards) {
    await enqueueBackfill("study_cards", "UPDATE", row.id, row);
  }
  for (const row of logs) {
    await enqueueBackfill("study_log", "INSERT", `${row.card_id}:${row.reviewed_at}`, row);
  }
  for (const row of bookmarks) {
    await enqueueBackfill("bookmarks", "UPDATE", `${row.surah}:${row.ayah}`, row);
  }
  for (const row of highlights) {
    const syncId = row.sync_id ?? highlightSyncId(row as any);
    await enqueueBackfill("highlights", "UPDATE", syncId, {
      ...row,
      sync_id: syncId,
      updated_at: row.updated_at ?? row.created_at,
      deleted_at: row.deleted_at ?? null,
    });
  }
  for (const row of privateNotes) {
    await enqueueBackfill("private_notes", "UPDATE", row.id, {
      ...row,
      qf_ranges_json: row.qf_ranges_json ? safeJson(row.qf_ranges_json) : null,
    });
  }
  for (const row of journeyEntries) {
    await enqueueBackfill("reflection_journey_entries", "UPDATE", row.level_id, row);
  }
  for (const row of achievements) {
    await enqueueBackfill("achievement_unlocks", "INSERT", row.achievement_id, {
      achievement_id: row.achievement_id,
      unlocked_at: row.unlocked_at,
      public_payload: safeJson(row.public_payload) ?? {},
    });
  }

  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [backfillKey, new Date().toISOString()]
  );
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [settingsBackfillKey, new Date().toISOString()]
  );
}

function userSettingsBackfillKey(userId: string): string {
  return `sync_user_settings_backfill_${userId}_${USER_SETTINGS_BACKFILL_VERSION}`;
}

async function enqueueSyncableUserSettingsForSync(db: SQLiteDatabase, userId: string): Promise<void> {
  const backfillKey = userSettingsBackfillKey(userId);
  const done = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [backfillKey]
  );
  if (done?.value === "true") return;

  const settings = await db.getAllAsync<{ key: string; value: string; updated_at: string | null; deleted_at: string | null }>(
    "SELECT key, value, updated_at, deleted_at FROM user_settings"
  );
  for (const row of settings) {
    if (!isSyncableUserSetting(row.key)) continue;
    await enqueueSync(db, "user_settings", "UPDATE", row.key, userSettingToSyncData(row)).catch(console.warn);
  }

  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [backfillKey, new Date().toISOString()]
  );
}
