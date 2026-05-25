import type { SQLiteDatabase } from "expo-sqlite";
import { enqueueSync } from "@/lib/database/sync-queue";

const SYNCABLE_SETTING_PREFIXES = ["deck_", "review_settings_", "smart_deck_filter_"];
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

export async function writeUserSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, ?, ?, NULL)",
    [key, value, updatedAt]
  );

  if (isSyncableUserSetting(key)) {
    enqueueSync(db, "user_settings", "UPDATE", key, {
      key,
      value,
      updated_at: updatedAt,
      deleted_at: null,
    }).catch(console.warn);
  }
}

export async function deleteUserSetting(db: SQLiteDatabase, key: string): Promise<void> {
  const deletedAt = new Date().toISOString();
  await db.runAsync("DELETE FROM user_settings WHERE key = ?", [key]);

  if (isSyncableUserSetting(key)) {
    enqueueSync(db, "user_settings", "DELETE", key, {
      key,
      value: "",
      updated_at: deletedAt,
      deleted_at: deletedAt,
    }).catch(console.warn);
  }
}
