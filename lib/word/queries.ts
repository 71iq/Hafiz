import type { SQLiteDatabase } from "expo-sqlite";

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
