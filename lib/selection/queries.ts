import type { SQLiteDatabase } from "expo-sqlite";
import type { BookmarkEntry, HighlightEntry } from "./types";
import { enqueueSync } from "@/lib/database/sync-queue";
import { enqueueQfSync } from "@/lib/quran-foundation/user-sync";

type BookmarkRow = {
  surah: number;
  ayah: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  qf_bookmark_id: string | null;
  qf_synced_at: string | null;
  qf_sync_error: string | null;
  qf_is_in_default_collection: number | null;
  qf_collections_count: number | null;
};

export async function fetchAllBookmarks(db: SQLiteDatabase): Promise<BookmarkEntry[]> {
  return db.getAllAsync<BookmarkEntry>(
    `SELECT surah, ayah, created_at as createdAt
     FROM bookmarks
     WHERE deleted_at IS NULL
     ORDER BY updated_at DESC`
  );
}

export async function addBookmark(db: SQLiteDatabase, surah: number, ayah: number): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO bookmarks (surah, ayah, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(surah, ayah) DO UPDATE SET
       updated_at = excluded.updated_at,
       deleted_at = NULL,
       qf_sync_error = NULL`,
    [surah, ayah, now, now]
  );
  const row = await getBookmarkRow(db, surah, ayah);
  enqueueSync(db, "bookmarks", "UPDATE", `${surah}:${ayah}`, row ? bookmarkToSyncData(row) : {
    surah, ayah, created_at: now, updated_at: now, deleted_at: null,
  }).catch(console.warn);
  enqueueQfSync(db, "bookmark", "UPSERT", `${surah}:${ayah}`, { surah, ayah }).catch(console.warn);
}

export async function removeBookmark(db: SQLiteDatabase, surah: number, ayah: number): Promise<void> {
  const existing = await getBookmarkRow(db, surah, ayah);
  if (!existing) return;
  const now = new Date().toISOString();
  await db.runAsync(
    "UPDATE bookmarks SET updated_at = ?, deleted_at = ?, qf_sync_error = NULL WHERE surah = ? AND ayah = ?",
    [now, now, surah, ayah]
  );
  const row = await getBookmarkRow(db, surah, ayah);
  enqueueSync(db, "bookmarks", "UPDATE", `${surah}:${ayah}`, row ? bookmarkToSyncData(row) : {
    surah, ayah, created_at: existing.created_at, updated_at: now, deleted_at: now,
  }).catch(console.warn);
  enqueueQfSync(db, "bookmark", "DELETE", `${surah}:${ayah}`, {
    surah,
    ayah,
    qfBookmarkId: existing.qf_bookmark_id,
    qfIsInDefaultCollection: Boolean(existing.qf_is_in_default_collection),
    qfCollectionsCount: existing.qf_collections_count ?? 0,
  }).catch(console.warn);
}

export async function fetchAllHighlights(db: SQLiteDatabase): Promise<HighlightEntry[]> {
  return db.getAllAsync<HighlightEntry>(
    "SELECT id, surah, ayah, word_start as wordStart, word_end as wordEnd, color FROM highlights"
  );
}

export async function addHighlight(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
  color: string,
  wordStart?: number,
  wordEnd?: number,
): Promise<number> {
  const now = new Date().toISOString();
  const result = await db.runAsync(
    "INSERT INTO highlights (surah, ayah, word_start, word_end, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [surah, ayah, wordStart ?? null, wordEnd ?? null, color, now]
  );
  enqueueSync(db, "highlights", "INSERT", String(result.lastInsertRowId), {
    id: result.lastInsertRowId, surah, ayah,
    word_start: wordStart ?? null, word_end: wordEnd ?? null,
    color, created_at: now,
  }).catch(console.warn);
  return result.lastInsertRowId;
}

export async function removeHighlight(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync("DELETE FROM highlights WHERE id = ?", [id]);
  enqueueSync(db, "highlights", "DELETE", String(id), { id }).catch(console.warn);
}

export async function removeHighlightsForAyah(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
): Promise<void> {
  await db.runAsync("DELETE FROM highlights WHERE surah = ? AND ayah = ?", [surah, ayah]);
}

export async function fetchUthmaniRange(
  db: SQLiteDatabase,
  surah: number,
  ayahStart: number,
  ayahEnd: number,
): Promise<string> {
  const rows = await db.getAllAsync<{ text_uthmani: string }>(
    "SELECT text_uthmani FROM quran_text WHERE surah = ? AND ayah >= ? AND ayah <= ? ORDER BY ayah",
    [surah, ayahStart, ayahEnd]
  );
  return rows.map((r) => r.text_uthmani).join(" ");
}

export async function fetchSurahName(
  db: SQLiteDatabase,
  surah: number,
): Promise<string> {
  const row = await db.getFirstAsync<{ name_arabic: string }>(
    "SELECT name_arabic FROM surahs WHERE number = ?",
    [surah]
  );
  return row?.name_arabic ?? "";
}

async function getBookmarkRow(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): Promise<BookmarkRow | null> {
  return db.getFirstAsync<BookmarkRow>(
    "SELECT * FROM bookmarks WHERE surah = ? AND ayah = ?",
    [surah, ayah]
  );
}

function bookmarkToSyncData(row: BookmarkRow): Record<string, unknown> {
  return {
    surah: row.surah,
    ayah: row.ayah,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    qf_bookmark_id: row.qf_bookmark_id,
    qf_synced_at: row.qf_synced_at,
    qf_sync_error: row.qf_sync_error,
    qf_is_in_default_collection: Boolean(row.qf_is_in_default_collection),
    qf_collections_count: row.qf_collections_count ?? 0,
  };
}
