import type { SQLiteDatabase } from "expo-sqlite";
import { createEmptyCard } from "@/lib/fsrs/scheduler";

export type VocabCard = {
  id: number;
  surah: number;
  ayah: number;
  word_pos: number;
  word: string | null;
  meaning_ar: string | null;
  meaning_en: string | null;
  created_at: string;
  due: string | null;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
};

export async function addVocabCard(
  db: SQLiteDatabase,
  params: {
    surah: number;
    ayah: number;
    wordPos: number;
    word: string | null;
    meaningAr: string | null;
    meaningEn: string | null;
  }
): Promise<{ created: boolean }> {
  const empty = createEmptyCard();
  const due = empty.due.toISOString();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO vocab_cards
      (surah, ayah, word_pos, word, meaning_ar, meaning_en, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.surah,
      params.ayah,
      params.wordPos,
      params.word,
      params.meaningAr,
      params.meaningEn,
      due,
      empty.stability,
      empty.difficulty,
      empty.elapsed_days,
      empty.scheduled_days,
      empty.reps,
      empty.lapses,
      empty.state,
    ]
  );
  return { created: (result.changes ?? 0) > 0 };
}

export async function isVocabCardSaved(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
  wordPos: number
): Promise<boolean> {
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM vocab_cards WHERE surah = ? AND ayah = ? AND word_pos = ?",
    [surah, ayah, wordPos]
  );
  return (row?.c ?? 0) > 0;
}

export async function getVocabStats(
  db: SQLiteDatabase
): Promise<{ total: number; due: number }> {
  const total = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM vocab_cards"
  );
  const nowIso = new Date().toISOString();
  const due = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM vocab_cards WHERE due IS NOT NULL AND due <= ?",
    [nowIso]
  );
  return { total: total?.c ?? 0, due: due?.c ?? 0 };
}

export async function listVocabCards(
  db: SQLiteDatabase
): Promise<VocabCard[]> {
  return db.getAllAsync<VocabCard>(
    `SELECT
       v.id,
       v.surah,
       v.ayah,
       v.word_pos,
       COALESCE(NULLIF(v.word, ''), custom.word) AS word,
       COALESCE(NULLIF(v.meaning_ar, ''), custom.meaning) AS meaning_ar,
       v.meaning_en,
       v.created_at,
       v.due,
       v.stability,
       v.difficulty,
       v.elapsed_days,
       v.scheduled_days,
       v.reps,
       v.lapses,
       v.state,
       v.last_review
     FROM vocab_cards v
     LEFT JOIN user_word_meanings custom
       ON custom.surah = v.surah AND custom.ayah = v.ayah AND custom.word_pos = v.word_pos
     ORDER BY datetime(v.due) ASC, v.id ASC`
  );
}

export async function deleteVocabCard(
  db: SQLiteDatabase,
  id: number
): Promise<void> {
  await db.runAsync("DELETE FROM vocab_cards WHERE id = ?", [id]);
}
