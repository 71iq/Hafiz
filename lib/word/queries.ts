import type { SQLiteDatabase } from "expo-sqlite";
import { normalizeArabicWord } from "@/lib/arabic";
import { enqueueSync } from "@/lib/database/sync-queue";

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
  db: SQLiteDatabase,
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
  db: SQLiteDatabase,
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
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
): Promise<TajweedRow[]> {
  return db.getAllAsync<TajweedRow>(
    "SELECT rule, start_offset, end_offset FROM tajweed_rules WHERE surah = ? AND ayah = ? ORDER BY start_offset",
    [surah, ayah],
  );
}

export async function fetchWordRoot(
  db: SQLiteDatabase,
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
  db: SQLiteDatabase,
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

export async function fetchRootOccurrences(
  db: SQLiteDatabase,
  root: string,
): Promise<RootOccurrence[]> {
  return db.getAllAsync<RootOccurrence>(
    "SELECT surah, ayah, word_pos, word_text FROM word_roots WHERE root = ? ORDER BY surah, ayah, word_pos",
    [root],
  );
}

export async function fetchTextUthmani(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ text_uthmani: string }>(
    "SELECT text_uthmani FROM quran_text WHERE surah = ? AND ayah = ?",
    [surah, ayah],
  );
  return row?.text_uthmani ?? null;
}

export async function fetchAyahTafseer(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ text: string }>(
    "SELECT text FROM tafseer WHERE surah = ? AND ayah = ?",
    [surah, ayah],
  );
  return row?.text ?? null;
}

// ─── New tab queries ──────────────────────────────────────────

export type WordMeaningArRow = {
  surah: number;
  ayah: number;
  word_pos: number;
  word: string | null;
  meaning: string | null;
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

export async function fetchWordMeaningsArForAyah(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
): Promise<WordMeaningArRow[]> {
  return db.getAllAsync<WordMeaningArRow>(
    `WITH meaning_keys AS (
       SELECT surah, ayah, word_pos FROM word_meanings_ar WHERE surah = ? AND ayah = ?
       UNION
       SELECT surah, ayah, word_pos FROM user_word_meanings WHERE surah = ? AND ayah = ?
     )
     SELECT
       k.surah,
       k.ayah,
       k.word_pos,
       COALESCE(NULLIF(base.word, ''), custom.word) AS word,
       CASE
         WHEN base.meaning IS NOT NULL AND TRIM(base.meaning) != '' THEN base.meaning
         ELSE custom.meaning
       END AS meaning
     FROM meaning_keys k
     LEFT JOIN word_meanings_ar base
       ON base.surah = k.surah AND base.ayah = k.ayah AND base.word_pos = k.word_pos
     LEFT JOIN user_word_meanings custom
       ON custom.surah = k.surah AND custom.ayah = k.ayah AND custom.word_pos = k.word_pos
     ORDER BY k.word_pos`,
    [surah, ayah, surah, ayah],
  );
}

export async function upsertUserWordMeaning(
  db: SQLiteDatabase,
  params: {
    surah: number;
    ayah: number;
    wordPos: number;
    word: string | null;
    meaning: string;
  }
): Promise<void> {
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
    enqueueSync(db, "user_word_meanings", "UPDATE", `${params.surah}:${params.ayah}:${params.wordPos}`, row).catch(console.warn);
  }
}

export async function fetchWordMeaningAr(
  db: SQLiteDatabase,
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
       END AS meaning
     FROM (SELECT ? AS surah, ? AS ayah, ? AS word_pos) key
     LEFT JOIN word_meanings_ar base
       ON base.surah = key.surah AND base.ayah = key.ayah AND base.word_pos = key.word_pos
     LEFT JOIN user_word_meanings custom
       ON custom.surah = key.surah AND custom.ayah = key.ayah AND custom.word_pos = key.word_pos`,
    [surah, ayah, wordPos],
  );
}

export async function fetchWordIrabDaasForAyah(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
): Promise<WordIrabDaasRow[]> {
  return db.getAllAsync<WordIrabDaasRow>(
    "SELECT surah, ayah, word_pos, word, irab FROM word_irab_daas WHERE surah = ? AND ayah = ? ORDER BY word_pos",
    [surah, ayah],
  );
}

export async function fetchTajweedRuleAr(
  db: SQLiteDatabase,
  ruleKey: string,
): Promise<TajweedRuleArRow | null> {
  return db.getFirstAsync<TajweedRuleArRow>(
    "SELECT rule_key, name_ar, short_ar, description_ar FROM tajweed_rules_ar WHERE rule_key = ?",
    [ruleKey],
  );
}

export async function fetchTajweedRuleEn(
  db: SQLiteDatabase,
  ruleKey: string,
): Promise<TajweedRuleEnRow | null> {
  return db.getFirstAsync<TajweedRuleEnRow>(
    "SELECT rule_key, name, name_ar, short, description FROM tajweed_rules_en WHERE rule_key = ?",
    [ruleKey],
  );
}

export async function fetchQiraat(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
): Promise<QiraatRow | null> {
  return db.getFirstAsync<QiraatRow>(
    "SELECT text, ayah_group FROM qiraat_encyclopedia WHERE surah = ? AND ayah = ?",
    [surah, ayah],
  );
}

/**
 * Find the best matching entry in a per-ayah list for a tapped word.
 * The Da'as and quran-words datasets group words differently from the Mushaf
 * (e.g., "بِسْمِ اللهِ" as one entry vs two Mushaf tokens). Strategy:
 *   1. Exact word_pos match.
 *   2. Normalized-text match (drop diacritics/spaces) — prefer containment.
 *   3. Fuzzy: first entry whose normalized word contains the tapped word.
 * Returns the index into `list`, or -1 if nothing matched.
 */
export function findBestWordMatch<T extends { word_pos: number; word: string | null }>(
  list: T[],
  targetPos: number,
  targetText: string,
): number {
  if (list.length === 0) return -1;
  const exactIdx = list.findIndex((r) => r.word_pos === targetPos);
  if (exactIdx !== -1) {
    // If the exact-position row's word matches the tapped text (loosely),
    // keep it. Otherwise fall through to text-based matching.
    const row = list[exactIdx];
    if (row.word) {
      const a = normalizeArabicWord(row.word);
      const b = normalizeArabicWord(targetText);
      if (a && b && (a === b || a.includes(b) || b.includes(a))) return exactIdx;
    } else {
      return exactIdx;
    }
  }
  const target = normalizeArabicWord(targetText);
  if (!target) return exactIdx; // fall back to whatever we had
  // Prefer exact normalized equality first
  const eqIdx = list.findIndex((r) => r.word && normalizeArabicWord(r.word) === target);
  if (eqIdx !== -1) return eqIdx;
  // Then containment either direction
  const containsIdx = list.findIndex((r) => {
    if (!r.word) return false;
    const w = normalizeArabicWord(r.word);
    return w.includes(target) || target.includes(w);
  });
  if (containsIdx !== -1) return containsIdx;
  return exactIdx;
}
