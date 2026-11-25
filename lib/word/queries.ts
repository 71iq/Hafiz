import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import type { WordRef } from "./context";
import { enqueueSync } from "@/lib/database/sync-queue";
import { ayahGlyphs, mushafWordOfGlyph, unicodeWordOfGlyph, uthmaniWordCount } from "@/lib/mushaf/glyph-words";

export type WordTranslationRow = {
  word_arabic: string | null;
  translation_en: string;
  transliteration: string | null;
};

export type WordIrabRow = {
  arabic_word: string | null;
  morphological_tag: string | null;
  syntactic_function: string | null;
  root: string | null;
  lemma: string | null;
  pattern: string | null;
};

export type TajweedRow = {
  rule: string;
  start_offset: number;
  end_offset: number;
};

export type WordRootRow = {
  root: string | null;
  lemma: string | null;
};

export type RootOccurrence = {
  surah: number;
  ayah: number;
  word_pos: number;
  word_text: string;
};

export async function fetchWordTranslation(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
  wordPos: number,
): Promise<WordTranslationRow | null> {
  return db.getFirstAsync<WordTranslationRow>(
    "SELECT word_arabic, translation_en, transliteration FROM word_translations WHERE surah = ? AND ayah = ? AND word_pos = ?",
    [surah, ayah, wordPos],
  );
}

export async function fetchWordIrab(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
  wordPos: number,
): Promise<WordIrabRow | null> {
  return db.getFirstAsync<WordIrabRow>(
    "SELECT arabic_word, morphological_tag, syntactic_function, root, lemma, pattern FROM word_irab WHERE surah = ? AND ayah = ? AND word_pos = ?",
    [surah, ayah, wordPos],
  );
}

export async function fetchWordTajweed(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
): Promise<TajweedRow[]> {
  return db.getAllAsync<TajweedRow>(
    "SELECT rule, start_offset, end_offset FROM tajweed_rules WHERE surah = ? AND ayah = ? ORDER BY start_offset",
    [surah, ayah],
  );
}

export async function fetchWordRoot(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
  wordPos: number,
): Promise<WordRootRow | null> {
  return db.getFirstAsync<WordRootRow>(
    "SELECT root, lemma FROM word_roots WHERE surah = ? AND ayah = ? AND word_pos = ?",
    [surah, ayah, wordPos],
  );
}

export async function fetchWordText(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
  wordPos: number,
): Promise<string | null> {
  const irabRow = await db.getFirstAsync<{ arabic_word: string | null }>(
    "SELECT arabic_word FROM word_irab WHERE surah = ? AND ayah = ? AND word_pos = ?",
    [surah, ayah, wordPos],
  );
  if (irabRow?.arabic_word?.trim()) return irabRow.arabic_word;

  const row = await db.getFirstAsync<{ word_text: string | null }>(
    "SELECT word_text FROM word_roots WHERE surah = ? AND ayah = ? AND word_pos = ?",
    [surah, ayah, wordPos],
  );
  if (row?.word_text?.trim()) return row.word_text;

  const translationRow = await db.getFirstAsync<{ word_arabic: string | null }>(
    "SELECT word_arabic FROM word_translations WHERE surah = ? AND ayah = ? AND word_pos = ?",
    [surah, ayah, wordPos],
  );
  if (translationRow?.word_arabic?.trim()) return translationRow.word_arabic;

  const ayahRow = await db.getFirstAsync<{ text_uthmani: string | null }>(
    "SELECT text_uthmani FROM quran_text WHERE surah = ? AND ayah = ?",
    [surah, ayah],
  );
  if (!ayahRow?.text_uthmani) return null;
  const words = ayahRow.text_uthmani.trim().split(/\s+/);
  // quran_text includes the opening basmallah prefix, but QCF2 wordPos does not.
  if (ayah === 1 && surah !== 1 && surah !== 9 && words.length > 4) {
    return words.slice(4)[wordPos - 1] ?? null;
  }
  return words[wordPos - 1] ?? null;
}

/** A word the reader names by glyph, in the two numberings the word sheet's tabs read. */
export type ReaderWordPositions = Readonly<{
  /** The word-table position, for `word_*` tables and meaning card ids. */
  table: number;
  /** The Unicode word of `text_uthmani` split on spaces, for the Tajweed tab's offsets. */
  unicode: number;
}>;

/**
 * The positions of a word the reader names by glyph (SPEC 3.10). The reader numbers every page-font
 * glyph, so in the 196 ayat with a mark glyph (the hizb-quarter ۞, or the pause mark in 36:52) its
 * number is one past the word tables' from the mark on, and the word sheet would read and save the
 * next word. A tap on the mark itself names the word it opens. In 8:6 and 37:130 the word tables
 * count two glyphs as one word while `text_uthmani` keeps two, so the two numberings differ there.
 * Unknown layouts keep the reader's number for both.
 */
export async function fetchReaderWordPositions(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
  readerWordPos: number,
): Promise<ReaderWordPositions> {
  const row = await db.getFirstAsync<{ text_qcf2: string | null; text_uthmani: string | null }>(
    "SELECT text_qcf2, text_uthmani FROM quran_text WHERE surah = ? AND ayah = ?",
    [surah, ayah],
  );
  const reader = { table: readerWordPos, unicode: readerWordPos };
  if (!row?.text_qcf2 || !row.text_uthmani) return reader;
  const layout = ayahGlyphs(surah, ayah, row.text_qcf2, uthmaniWordCount(row.text_uthmani));
  if (!layout) return reader;
  return {
    table: mushafWordOfGlyph(layout, readerWordPos - 1) ?? readerWordPos,
    unicode: unicodeWordOfGlyph(layout, readerWordPos - 1) ?? readerWordPos,
  };
}

/** The word-table position of a word the reader names by glyph; see fetchReaderWordPositions. */
export async function fetchTableWordPos(db: DatabaseExecutor, surah: number, ayah: number, readerWordPos: number): Promise<number> {
  return (await fetchReaderWordPositions(db, surah, ayah, readerWordPos)).table;
}

export async function fetchWordQcf2Glyph(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
  wordPos: number,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ text_qcf2: string | null }>(
    "SELECT text_qcf2 FROM quran_text WHERE surah = ? AND ayah = ?",
    [surah, ayah],
  );
  const tokens = row?.text_qcf2?.split(/\s+/).filter(Boolean) ?? [];
  return tokens[wordPos - 1] ?? null;
}

// The reader gives one position to each space-separated QCF2 token before the ayah marker.
function glyphWordCount(text: string): number {
  return text.split(" ").filter(Boolean).length - 1;
}

export async function fetchWordNeighbors(
  db: DatabaseExecutor,
  word: WordRef,
): Promise<{ previous: WordRef | null; next: WordRef | null }> {
  const { surah, ayah, wordPos } = word;
  const current = await db.getFirstAsync<{ text_qcf2: string; v2Page: number }>(
    "SELECT text_qcf2, v2_page AS v2Page FROM quran_text WHERE surah = ? AND ayah = ?",
    [surah, ayah],
  );
  const lastWordPos = current ? glyphWordCount(current.text_qcf2) : 0;
  if (!current || wordPos < 1 || wordPos > lastWordPos) return { previous: null, next: null };

  const currentRef = { ...word, v2Page: current.v2Page };
  const [previousAyah, next] = await Promise.all([
    wordPos === 1
      ? db.getFirstAsync<Omit<WordRef, "wordPos"> & { text_qcf2: string }>(
          `SELECT surah, ayah, v2_page AS v2Page, text_qcf2 FROM quran_text
           WHERE (surah, ayah) < (?, ?) AND instr(trim(text_qcf2), ' ') > 0
           ORDER BY surah DESC, ayah DESC LIMIT 1`,
          [surah, ayah],
        )
      : null,
    wordPos === lastWordPos
      ? db.getFirstAsync<WordRef>(
          `SELECT surah, ayah, v2_page AS v2Page, 1 AS wordPos FROM quran_text
           WHERE (surah, ayah) > (?, ?) AND instr(trim(text_qcf2), ' ') > 0
           ORDER BY surah, ayah LIMIT 1`,
          [surah, ayah],
        )
      : { ...currentRef, wordPos: wordPos + 1 },
  ]);

  let previous = wordPos > 1 ? { ...currentRef, wordPos: wordPos - 1 } : null;
  if (previousAyah) {
    const { text_qcf2, ...ref } = previousAyah;
    previous = { ...ref, wordPos: glyphWordCount(text_qcf2) };
  }
  return { previous, next };
}

/** One page of a root's occurrences in mushaf order. Common roots have thousands of rows. */
export async function fetchRootOccurrences(
  db: DatabaseExecutor,
  root: string,
  limit: number,
  offset = 0,
): Promise<RootOccurrence[]> {
  return db.getAllAsync<RootOccurrence>(
    "SELECT surah, ayah, word_pos, word_text FROM word_roots WHERE root = ? ORDER BY surah, ayah, word_pos LIMIT ? OFFSET ?",
    [root, limit, offset],
  );
}

export async function countRootOccurrences(db: DatabaseExecutor, root: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM word_roots WHERE root = ?", [root]);
  return row?.n ?? 0;
}

export async function fetchTextUthmani(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ text_uthmani: string }>(
    "SELECT text_uthmani FROM quran_text WHERE surah = ? AND ayah = ?",
    [surah, ayah],
  );
  return row?.text_uthmani ?? null;
}

// ─── New tab queries ──────────────────────────────────────────

export type WordMeaningArRow = {
  surah: number;
  ayah: number;
  word_pos: number;
  word: string | null;
  meaning: string | null;
  /** Where the shown meaning comes from. A bundled meaning takes precedence over a custom one. */
  source: "bundled" | "custom" | null;
  /** The custom row's creation time, only when the custom meaning is the one shown. */
  custom_created_at: string | null;
};

export type WordIrabDaasRow = {
  surah: number;
  ayah: number;
  word_pos: number;
  word: string | null;
  irab: string | null;
};

export type TajweedRuleArRow = {
  rule_key: string;
  name_ar: string | null;
  short_ar: string | null;
  description_ar: string | null;
};

export type TajweedRuleEnRow = {
  rule_key: string;
  name: string | null;
  name_ar: string | null;
  short: string | null;
  description: string | null;
};

export type QiraatRow = {
  text: string | null;
  ayah_group: string | null;
};

type UserWordMeaningInput = {
  surah: number;
  ayah: number;
  wordPos: number;
  word: string | null;
  meaning: string;
};

/**
 * Save a custom word meaning. The row and its upload queue entry commit together or not at all. An
 * edit keeps the row's original created_at.
 */
export async function upsertUserWordMeaning(database: AppDatabase, params: UserWordMeaningInput): Promise<void> {
  await database.withTransactionAsync((db) => upsertUserWordMeaningRow(db, params));
}

async function upsertUserWordMeaningRow(db: DatabaseExecutor, params: UserWordMeaningInput): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO user_word_meanings
       (surah, ayah, word_pos, word, meaning, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(surah, ayah, word_pos) DO UPDATE SET
       word = COALESCE(excluded.word, user_word_meanings.word),
       meaning = excluded.meaning,
       updated_at = excluded.updated_at`,
    [params.surah, params.ayah, params.wordPos, params.word, params.meaning, now, now],
  );
  const row = await db.getFirstAsync<Record<string, any>>(
    "SELECT surah, ayah, word_pos, word, meaning, created_at, updated_at FROM user_word_meanings WHERE surah = ? AND ayah = ? AND word_pos = ?",
    [params.surah, params.ayah, params.wordPos],
  );
  if (row) {
    await enqueueSync(db, "user_word_meanings", "UPDATE", `${params.surah}:${params.ayah}:${params.wordPos}`, row);
  }
}

export type CustomWordMeaningKey = Readonly<{
  surah: number;
  ayah: number;
  wordPos: number;
  /** The meaning and creation time the person saw when they chose Delete. */
  meaning: string;
  createdAt: string;
}>;

/**
 * Delete one custom meaning by its canonical key. In one transaction the local row goes and a
 * user_word_meanings DELETE is queued with updated_at and deleted_at both equal to one fresh deletion
 * time (also the queue time), so the existing tombstone reaches devices holding the unchanged row
 * while a genuinely newer edit elsewhere still wins. Returns "changed", writing nothing, when the
 * row is gone or no longer the one the person saw.
 */
export async function deleteUserWordMeaning(
  database: AppDatabase,
  key: CustomWordMeaningKey,
): Promise<"deleted" | "changed"> {
  let outcome = "changed" as "deleted" | "changed";
  await database.withTransactionAsync(async (db) => {
    const row = await db.getFirstAsync<{ word: string | null; meaning: string; created_at: string }>(
      "SELECT word, meaning, created_at FROM user_word_meanings WHERE surah = ? AND ayah = ? AND word_pos = ?",
      [key.surah, key.ayah, key.wordPos],
    );
    if (!row || row.meaning !== key.meaning || row.created_at !== key.createdAt) return;
    const deletedAt = new Date().toISOString();
    await db.runAsync("DELETE FROM user_word_meanings WHERE surah = ? AND ayah = ? AND word_pos = ?", [
      key.surah,
      key.ayah,
      key.wordPos,
    ]);
    await enqueueSync(
      db,
      "user_word_meanings",
      "DELETE",
      `${key.surah}:${key.ayah}:${key.wordPos}`,
      {
        surah: key.surah,
        ayah: key.ayah,
        word_pos: key.wordPos,
        word: row.word,
        meaning: row.meaning,
        created_at: row.created_at,
        updated_at: deletedAt,
        deleted_at: deletedAt,
      },
      deletedAt,
    );
    outcome = "deleted";
  });
  return outcome;
}

export async function fetchWordMeaningAr(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
  wordPos: number,
): Promise<WordMeaningArRow | null> {
  return db.getFirstAsync<WordMeaningArRow>(
    `SELECT
       key.surah,
       key.ayah,
       key.word_pos,
       COALESCE(NULLIF(base.word, ''), custom.word) AS word,
       CASE
         WHEN base.meaning IS NOT NULL AND TRIM(base.meaning) != '' THEN base.meaning
         ELSE custom.meaning
       END AS meaning,
       CASE
         WHEN base.meaning IS NOT NULL AND TRIM(base.meaning) != '' THEN 'bundled'
         WHEN custom.meaning IS NOT NULL THEN 'custom'
         ELSE NULL
       END AS source,
       CASE
         WHEN base.meaning IS NOT NULL AND TRIM(base.meaning) != '' THEN NULL
         ELSE custom.created_at
       END AS custom_created_at
     FROM (SELECT ? AS surah, ? AS ayah, ? AS word_pos) key
     LEFT JOIN word_meanings_ar base
       ON base.surah = key.surah AND base.ayah = key.ayah AND base.word_pos = key.word_pos
     LEFT JOIN user_word_meanings custom
       ON custom.surah = key.surah AND custom.ayah = key.ayah AND custom.word_pos = key.word_pos`,
    [surah, ayah, wordPos],
  );
}

export async function fetchWordIrabDaasForAyah(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
): Promise<WordIrabDaasRow[]> {
  return db.getAllAsync<WordIrabDaasRow>(
    "SELECT surah, ayah, word_pos, word, irab FROM word_irab_daas WHERE surah = ? AND ayah = ? ORDER BY word_pos",
    [surah, ayah],
  );
}

export async function fetchTajweedRuleAr(
  db: DatabaseExecutor,
  ruleKey: string,
): Promise<TajweedRuleArRow | null> {
  return db.getFirstAsync<TajweedRuleArRow>(
    "SELECT rule_key, name_ar, short_ar, description_ar FROM tajweed_rules_ar WHERE rule_key = ?",
    [ruleKey],
  );
}

export async function fetchTajweedRuleEn(
  db: DatabaseExecutor,
  ruleKey: string,
): Promise<TajweedRuleEnRow | null> {
  return db.getFirstAsync<TajweedRuleEnRow>(
    "SELECT rule_key, name, name_ar, short, description FROM tajweed_rules_en WHERE rule_key = ?",
    [ruleKey],
  );
}

export async function fetchQiraat(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
): Promise<QiraatRow | null> {
  return db.getFirstAsync<QiraatRow>(
    "SELECT text, ayah_group FROM qiraat_encyclopedia WHERE surah = ? AND ayah = ?",
    [surah, ayah],
  );
}
