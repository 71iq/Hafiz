import type { SQLiteDatabase } from "expo-sqlite";

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
