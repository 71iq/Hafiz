import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import type { BookmarkEntry, HighlightEntry } from "./types";
import { enqueueSync } from "@/lib/database/sync-queue";
import { enqueueQfSync } from "@/lib/quran-foundation/user-sync";
import { formatQuranCopy, withAyahNumber, type CopyLanguage, type QuranCopyRange } from "./format";

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

export type UthmaniSelectionText = {
  text: string;
  firstSurah: number;
  firstAyah: number;
  ranges: QuranCopyRange[];
};

export async function fetchAllBookmarks(db: DatabaseExecutor): Promise<BookmarkEntry[]> {
  return db.getAllAsync<BookmarkEntry>(
    `SELECT surah, ayah, created_at as createdAt
     FROM bookmarks
     WHERE deleted_at IS NULL
     ORDER BY updated_at DESC`
  );
}

/** Bookmark an ayah. The local row and both upload queue entries commit together or not at all. */
export async function addBookmark(database: AppDatabase, surah: number, ayah: number): Promise<void> {
  await database.withTransactionAsync((db) => addBookmarkRows(db, surah, ayah));
}

async function addBookmarkRows(db: DatabaseExecutor, surah: number, ayah: number): Promise<void> {
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
  await enqueueSync(db, "bookmarks", "UPDATE", `${surah}:${ayah}`, row ? bookmarkToSyncData(row) : {
    surah, ayah, created_at: now, updated_at: now, deleted_at: null,
  });
  await enqueueQfSync(db, "bookmark", "UPSERT", `${surah}:${ayah}`, { surah, ayah });
}

/** Remove a bookmark. The tombstone and both upload queue entries commit together or not at all. */
export async function removeBookmark(database: AppDatabase, surah: number, ayah: number): Promise<void> {
  await database.withTransactionAsync((db) => removeBookmarkRows(db, surah, ayah));
}

async function removeBookmarkRows(db: DatabaseExecutor, surah: number, ayah: number): Promise<void> {
  const existing = await getBookmarkRow(db, surah, ayah);
  if (!existing) return;
  const now = new Date().toISOString();
  await db.runAsync(
    "UPDATE bookmarks SET updated_at = ?, deleted_at = ?, qf_sync_error = NULL WHERE surah = ? AND ayah = ?",
    [now, now, surah, ayah]
  );
  const row = await getBookmarkRow(db, surah, ayah);
  await enqueueSync(db, "bookmarks", "UPDATE", `${surah}:${ayah}`, row ? bookmarkToSyncData(row) : {
    surah, ayah, created_at: existing.created_at, updated_at: now, deleted_at: now,
  });
  await enqueueQfSync(db, "bookmark", "DELETE", `${surah}:${ayah}`, {
    surah,
    ayah,
    qfBookmarkId: existing.qf_bookmark_id,
    qfIsInDefaultCollection: Boolean(existing.qf_is_in_default_collection),
    qfCollectionsCount: existing.qf_collections_count ?? 0,
  });
}

export async function fetchAllHighlights(db: DatabaseExecutor): Promise<HighlightEntry[]> {
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

async function insertHighlightRow(
  db: DatabaseExecutor,
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
  await enqueueSync(db, "highlights", "INSERT", String(result.lastInsertRowId), {
    id: result.lastInsertRowId, sync_id: syncId, surah, ayah,
    word_start: wordStart ?? null, word_end: wordEnd ?? null,
    color, created_at: now, updated_at: now, deleted_at: null,
  });
  return result.lastInsertRowId;
}

/** Highlight every range of a text selection, or none of them. */
export async function addHighlightsForSelectionRefs(
  database: AppDatabase,
  refs: QuranSelectionWordRef[],
  color: string,
): Promise<number[]> {
  const ids: number[] = [];
  await database.withTransactionAsync(async (db) => {
    for (const range of selectionRefsToHighlightRanges(refs)) {
      ids.push(
        await insertHighlightRow(
          db,
          range.surah,
          range.ayah,
          color,
          range.wordStart ?? undefined,
          range.wordEnd ?? undefined,
        ),
      );
    }
  });
  return ids;
}

/**
 * Remove an ayah's whole-ayah highlight. Word-range highlights made from a text selection stay. The
 * physical delete and its queued deletions commit together.
 */
export async function removeHighlightsForAyah(database: AppDatabase, surah: number, ayah: number): Promise<void> {
  await database.withTransactionAsync((db) => deleteAyahLevelHighlightRows(db, surah, ayah));
}

/**
 * Replace an ayah's whole-ayah highlight with one in the new color, in a single transaction.
 * Word-range highlights on the same ayah are unrelated annotations and keep their rows.
 */
export async function replaceAyahHighlight(
  database: AppDatabase,
  surah: number,
  ayah: number,
  color: string,
): Promise<number> {
  let id = 0;
  await database.withTransactionAsync(async (db) => {
    await deleteAyahLevelHighlightRows(db, surah, ayah);
    id = await insertHighlightRow(db, surah, ayah, color);
  });
  return id;
}

/** Remove exactly these highlight rows (by local id), queueing a deletion for each. */
export async function removeHighlightsByIds(database: AppDatabase, ids: readonly number[]): Promise<void> {
  const unique = Array.from(new Set(ids.filter((id) => Number.isInteger(id))));
  if (unique.length === 0) return;
  await database.withTransactionAsync(async (db) => {
    const placeholders = unique.map(() => "?").join(",");
    const rows = await db.getAllAsync<HighlightRow>(
      `SELECT * FROM highlights WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      unique,
    );
    await deleteHighlightRows(db, rows);
  });
}

async function deleteAyahLevelHighlightRows(db: DatabaseExecutor, surah: number, ayah: number): Promise<void> {
  const rows = await db.getAllAsync<HighlightRow>(
    "SELECT * FROM highlights WHERE surah = ? AND ayah = ? AND word_start IS NULL AND word_end IS NULL AND deleted_at IS NULL",
    [surah, ayah]
  );
  await deleteHighlightRows(db, rows);
}

async function deleteHighlightRows(db: DatabaseExecutor, rows: readonly HighlightRow[]): Promise<void> {
  if (rows.length === 0) return;
  const deletedAt = new Date().toISOString();
  for (const row of rows) {
    await db.runAsync("DELETE FROM highlights WHERE id = ?", [row.id]);
    await enqueueSync(db, "highlights", "DELETE", row.sync_id ?? String(row.id), {
      ...highlightToSyncData(row),
      updated_at: deletedAt,
      deleted_at: deletedAt,
    });
  }
}

export async function fetchUthmaniRange(
  db: DatabaseExecutor,
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
  db: DatabaseExecutor,
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
  const selectedAyahs: { surah: number; ayah: number; surahNameArabic: string; surahNameEnglish: string }[] = [];

  for (const ayahRefs of grouped.values()) {
    const first = ayahRefs[0];
    const row = await db.getFirstAsync<{ text_uthmani: string; name_arabic: string; name_english: string | null }>(
      `SELECT qt.text_uthmani, s.name_arabic, s.name_english
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
    textParts.push(withAyahNumber(selectedWords.join(" "), first.ayah));
    selectedAyahs.push({
      surah: first.surah,
      ayah: first.ayah,
      surahNameArabic: row.name_arabic,
      surahNameEnglish: row.name_english ?? "",
    });
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
  db: DatabaseExecutor,
  surah: number,
): Promise<string> {
  return (await fetchSurahNames(db, surah)).arabic;
}

export async function fetchSurahNames(
  db: DatabaseExecutor,
  surah: number,
): Promise<{ arabic: string; english: string }> {
  const row = await db.getFirstAsync<{ name_arabic: string; name_english: string | null }>(
    "SELECT name_arabic, name_english FROM surahs WHERE number = ?",
    [surah]
  );
  return { arabic: row?.name_arabic ?? "", english: row?.name_english ?? "" };
}

/**
 * Copy/share text for whole ayahs through the shared format: Unicode `text_uthmani` with each
 * ayah's number, the reference in the UI language and the canonical link. Null when the text is
 * missing, so a caller never announces an empty copy as a success.
 */
export async function buildAyahCopyText(
  db: DatabaseExecutor,
  surah: number,
  ayahStart: number,
  ayahEnd: number,
  language: CopyLanguage,
): Promise<string | null> {
  const [rows, names] = await Promise.all([
    db.getAllAsync<{ ayah: number; text_uthmani: string }>(
      "SELECT ayah, text_uthmani FROM quran_text WHERE surah = ? AND ayah >= ? AND ayah <= ? ORDER BY ayah",
      [surah, ayahStart, ayahEnd]
    ),
    fetchSurahNames(db, surah),
  ]);
  const text = rows
    .map((row) => withAyahNumber(row.text_uthmani ?? "", row.ayah))
    .filter(Boolean)
    .join(" ");
  if (!text) return null;
  return formatQuranCopy({
    text,
    ranges: [{ surah, surahNameArabic: names.arabic, surahNameEnglish: names.english, ayahStart, ayahEnd }],
    language,
  });
}

/** Opening Unicode words of each ayah, keyed "surah:ayah", for bookmark rows. */
export async function fetchAyahOpenings(
  db: DatabaseExecutor,
  refs: readonly { surah: number; ayah: number }[],
  wordCount = 6,
): Promise<Map<string, string>> {
  const openings = new Map<string, string>();
  const keys = Array.from(new Set(refs.map((ref) => ref.surah * 1000 + ref.ayah)));
  for (let start = 0; start < keys.length; start += 400) {
    const chunk = keys.slice(start, start + 400);
    const rows = await db.getAllAsync<{ surah: number; ayah: number; text_uthmani: string }>(
      `SELECT surah, ayah, text_uthmani FROM quran_text WHERE (surah * 1000 + ayah) IN (${chunk.map(() => "?").join(",")})`,
      chunk
    );
    for (const row of rows) {
      const words = selectableUthmaniWords(row.text_uthmani ?? "", row.surah, row.ayah);
      const opening = words.slice(0, wordCount).join(" ");
      openings.set(`${row.surah}:${row.ayah}`, words.length > wordCount ? `${opening} …` : opening);
    }
  }
  return openings;
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
  ayahs: { surah: number; ayah: number; surahNameArabic: string; surahNameEnglish: string }[],
): QuranCopyRange[] {
  const ranges: QuranCopyRange[] = [];
  for (const item of ayahs) {
    const last = ranges[ranges.length - 1];
    if (last && last.surah === item.surah && last.ayahEnd + 1 === item.ayah) {
      last.ayahEnd = item.ayah;
    } else {
      ranges.push({
        surah: item.surah,
        surahNameArabic: item.surahNameArabic,
        surahNameEnglish: item.surahNameEnglish,
        ayahStart: item.ayah,
        ayahEnd: item.ayah,
      });
    }
  }
  return ranges;
}

async function getBookmarkRow(
  db: DatabaseExecutor,
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
