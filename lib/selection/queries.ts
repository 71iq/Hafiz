import type { SQLiteDatabase } from "expo-sqlite";
import type { BookmarkEntry, HighlightEntry } from "./types";
import { enqueueSync } from "@/lib/database/sync-queue";
import { enqueueQfSync } from "@/lib/quran-foundation/user-sync";
import { toArabicNumber } from "@/lib/arabic";

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

type HighlightRow = {
  id: number;
  sync_id: string | null;
  surah: number;
  ayah: number;
  word_start: number | null;
  word_end: number | null;
  color: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
};

export type QuranSelectionWordRef = {
  surah: number;
  ayah: number;
  wordPos: number;
  literalText?: string;
  isMarker?: boolean;
};

export type UthmaniSelectionRange = {
  surah: number;
  surahName: string;
  ayahStart: number;
  ayahEnd: number;
};

export type UthmaniSelectionText = {
  text: string;
  firstSurah: number;
  firstAyah: number;
  ranges: UthmaniSelectionRange[];
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
    `SELECT id, surah, ayah, word_start as wordStart, word_end as wordEnd, color
     FROM highlights
     WHERE deleted_at IS NULL
     ORDER BY updated_at DESC, id DESC`
  );
}

function highlightSyncId(
  surah: number,
  ayah: number,
  wordStart: number | null | undefined,
  wordEnd: number | null | undefined,
  color: string
): string {
  return `highlight:${surah}:${ayah}:${wordStart ?? "ayah"}:${wordEnd ?? "ayah"}:${color}`;
}

function highlightToSyncData(row: HighlightRow): Record<string, any> {
  return {
    id: row.id,
    sync_id: row.sync_id ?? highlightSyncId(row.surah, row.ayah, row.word_start, row.word_end, row.color),
    surah: row.surah,
    ayah: row.ayah,
    word_start: row.word_start,
    word_end: row.word_end,
    color: row.color,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    deleted_at: row.deleted_at ?? null,
  };
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
  const syncId = highlightSyncId(surah, ayah, wordStart, wordEnd, color);
  const result = await db.runAsync(
    `INSERT INTO highlights (sync_id, surah, ayah, word_start, word_end, color, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [syncId, surah, ayah, wordStart ?? null, wordEnd ?? null, color, now, now]
  );
  enqueueSync(db, "highlights", "INSERT", String(result.lastInsertRowId), {
    id: result.lastInsertRowId, sync_id: syncId, surah, ayah,
    word_start: wordStart ?? null, word_end: wordEnd ?? null,
    color, created_at: now, updated_at: now, deleted_at: null,
  }).catch(console.warn);
  return result.lastInsertRowId;
}

export async function addHighlightsForSelectionRefs(
  db: SQLiteDatabase,
  refs: QuranSelectionWordRef[],
  color: string,
): Promise<number[]> {
  const ids: number[] = [];
  for (const range of selectionRefsToHighlightRanges(refs)) {
    ids.push(
      await addHighlight(
        db,
        range.surah,
        range.ayah,
        color,
        range.wordStart ?? undefined,
        range.wordEnd ?? undefined,
      ),
    );
  }
  return ids;
}

export async function removeHighlightsForAyah(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
): Promise<void> {
  const rows = await db.getAllAsync<HighlightRow>(
    "SELECT * FROM highlights WHERE surah = ? AND ayah = ? AND deleted_at IS NULL",
    [surah, ayah]
  );
  const deletedAt = new Date().toISOString();
  await db.runAsync("DELETE FROM highlights WHERE surah = ? AND ayah = ?", [surah, ayah]);
  for (const row of rows) {
    enqueueSync(db, "highlights", "DELETE", row.sync_id ?? String(row.id), {
      ...highlightToSyncData(row),
      updated_at: deletedAt,
      deleted_at: deletedAt,
    }).catch(console.warn);
  }
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

export async function fetchUthmaniWordsForSelection(
  db: SQLiteDatabase,
  refs: QuranSelectionWordRef[],
): Promise<UthmaniSelectionText | null> {
  const grouped = new Map<string, QuranSelectionWordRef[]>();
  const deduped = new Map<string, QuranSelectionWordRef>();
  for (const ref of refs) {
    deduped.set(`${ref.surah}:${ref.ayah}:${ref.wordPos}`, ref);
  }

  const orderedRefs = Array.from(deduped.values()).sort(compareSelectionRefs);
  for (const ref of orderedRefs) {
    const key = `${ref.surah}:${ref.ayah}`;
    grouped.set(key, [...(grouped.get(key) ?? []), ref]);
  }

  const textParts: string[] = [];
  const selectedAyahs: { surah: number; ayah: number; surahName: string }[] = [];

  for (const ayahRefs of grouped.values()) {
    const first = ayahRefs[0];
    const row = await db.getFirstAsync<{ text_uthmani: string; name_arabic: string }>(
      `SELECT qt.text_uthmani, s.name_arabic
       FROM quran_text qt
       JOIN surahs s ON s.number = qt.surah
       WHERE qt.surah = ? AND qt.ayah = ?`,
      [first.surah, first.ayah],
    );
    if (!row) continue;

    const words = selectableUthmaniWords(row.text_uthmani, first.surah, first.ayah);
    const wordRefs = ayahRefs.filter((ref) => !ref.isMarker);
    const markerOnly = wordRefs.length === 0 && ayahRefs.some((ref) => ref.isMarker);
    const selectedWords = markerOnly
      ? words
      : wordRefs
          .map((ref) => ref.literalText ?? words[ref.wordPos - 1])
          .filter((word): word is string => !!word);

    if (selectedWords.length === 0) continue;
    textParts.push(`${selectedWords.join(" ")} ${toArabicNumber(first.ayah)}`);
    selectedAyahs.push({ surah: first.surah, ayah: first.ayah, surahName: row.name_arabic });
  }

  if (textParts.length === 0 || selectedAyahs.length === 0) return null;

  return {
    text: textParts.join(" "),
    firstSurah: selectedAyahs[0].surah,
    firstAyah: selectedAyahs[0].ayah,
    ranges: compactSelectedAyahs(selectedAyahs),
  };
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

function selectableUthmaniWords(text: string, surah: number, ayah: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (ayah === 1 && surah !== 1 && surah !== 9 && words.length > 4) {
    return words.slice(4);
  }
  return words;
}

function compareSelectionRefs(a: QuranSelectionWordRef, b: QuranSelectionWordRef): number {
  return a.surah - b.surah || a.ayah - b.ayah || a.wordPos - b.wordPos;
}

function selectionRefsToHighlightRanges(
  refs: QuranSelectionWordRef[],
): Array<{ surah: number; ayah: number; wordStart: number | null; wordEnd: number | null }> {
  const deduped = new Map<string, QuranSelectionWordRef>();
  for (const ref of refs) {
    deduped.set(`${ref.surah}:${ref.ayah}:${ref.wordPos}:${ref.isMarker ? 1 : 0}`, ref);
  }

  const grouped = new Map<string, QuranSelectionWordRef[]>();
  for (const ref of Array.from(deduped.values()).sort(compareSelectionRefs)) {
    const key = `${ref.surah}:${ref.ayah}`;
    grouped.set(key, [...(grouped.get(key) ?? []), ref]);
  }

  const ranges: Array<{ surah: number; ayah: number; wordStart: number | null; wordEnd: number | null }> = [];
  for (const ayahRefs of grouped.values()) {
    const first = ayahRefs[0];
    const wordPositions = ayahRefs
      .filter((ref) => !ref.isMarker && ref.wordPos > 0)
      .map((ref) => ref.wordPos);
    if (wordPositions.length === 0) {
      ranges.push({ surah: first.surah, ayah: first.ayah, wordStart: null, wordEnd: null });
      continue;
    }
    ranges.push({
      surah: first.surah,
      ayah: first.ayah,
      wordStart: Math.min(...wordPositions),
      wordEnd: Math.max(...wordPositions),
    });
  }
  return ranges;
}

function compactSelectedAyahs(
  ayahs: { surah: number; ayah: number; surahName: string }[],
): UthmaniSelectionRange[] {
  const ranges: UthmaniSelectionRange[] = [];
  for (const item of ayahs) {
    const last = ranges[ranges.length - 1];
    if (last && last.surah === item.surah && last.ayahEnd + 1 === item.ayah) {
      last.ayahEnd = item.ayah;
    } else {
      ranges.push({
        surah: item.surah,
        surahName: item.surahName,
        ayahStart: item.ayah,
        ayahEnd: item.ayah,
      });
    }
  }
  return ranges;
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
