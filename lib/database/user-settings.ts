import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { enqueueSync } from "@/lib/database/sync-queue";

const SYNCABLE_SETTING_PREFIXES = ["deck_", "review_settings_", "smart_deck_filter_", "card_answer_"];
const SYNCABLE_SETTING_KEYS = new Set(["daily_review_limit", "last_mushaf_position"]);

export type UserSettingRow = {
  key: string;
  value: string;
  updated_at: string | null;
  deleted_at?: string | null;
};

export function isSyncableUserSetting(key: string): boolean {
  return SYNCABLE_SETTING_KEYS.has(key) || SYNCABLE_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function userSettingToSyncData(row: UserSettingRow): Record<string, string | null> {
  return {
    key: row.key,
    value: row.value,
    updated_at: row.updated_at ?? new Date().toISOString(),
    deleted_at: row.deleted_at ?? null,
  };
}

/**
 * Write one setting with the given executor. A syncable key also queues its upload, so pass a
 * transaction when the two writes must commit together.
 */
export async function putUserSetting(db: DatabaseExecutor, key: string, value: string): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, ?, ?, NULL)",
    [key, value, updatedAt],
  );
  if (!isSyncableUserSetting(key)) return;
  await enqueueSync(db, "user_settings", "UPDATE", key, {
    key,
    value,
    updated_at: updatedAt,
    deleted_at: null,
  });
}

/** Delete one setting with the given executor, queueing a syncable key's tombstone. */
export async function removeUserSetting(db: DatabaseExecutor, key: string): Promise<void> {
  const deletedAt = new Date().toISOString();
  await db.runAsync("DELETE FROM user_settings WHERE key = ?", [key]);
  if (!isSyncableUserSetting(key)) return;
  await enqueueSync(db, "user_settings", "DELETE", key, {
    key,
    value: "",
    updated_at: deletedAt,
    deleted_at: deletedAt,
  });
}

/** Save a setting. A syncable key and its queued upload commit together or not at all. */
export async function writeUserSetting(db: AppDatabase, key: string, value: string): Promise<void> {
  if (!isSyncableUserSetting(key)) return putUserSetting(db, key, value);
  await db.withTransactionAsync((tx) => putUserSetting(tx, key, value));
}

/** Delete a setting. A syncable key and its queued tombstone commit together or not at all. */
export async function deleteUserSetting(db: AppDatabase, key: string): Promise<void> {
  if (!isSyncableUserSetting(key)) return removeUserSetting(db, key);
  await db.withTransactionAsync((tx) => removeUserSetting(tx, key));
}
