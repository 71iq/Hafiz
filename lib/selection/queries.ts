import type { SQLiteDatabase } from "expo-sqlite";
import type { BookmarkEntry, HighlightEntry } from "./types";
import { enqueueSync } from "@/lib/database/sync-queue";

export async function fetchAllBookmarks(db: SQLiteDatabase): Promise<BookmarkEntry[]> {
  return db.getAllAsync<BookmarkEntry>(
    "SELECT surah, ayah, created_at as createdAt FROM bookmarks ORDER BY created_at DESC"
  );
}

export async function addBookmark(db: SQLiteDatabase, surah: number, ayah: number): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    "INSERT OR IGNORE INTO bookmarks (surah, ayah, created_at) VALUES (?, ?, ?)",
    [surah, ayah, now]
  );
  enqueueSync(db, "bookmarks", "INSERT", `${surah}:${ayah}`, {
    surah, ayah, created_at: now,
  }).catch(console.warn);
}

export async function removeBookmark(db: SQLiteDatabase, surah: number, ayah: number): Promise<void> {
  await db.runAsync("DELETE FROM bookmarks WHERE surah = ? AND ayah = ?", [surah, ayah]);
  enqueueSync(db, "bookmarks", "DELETE", `${surah}:${ayah}`, {
    surah, ayah,
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
