import type { SQLiteDatabase } from "expo-sqlite";
import { MUTASHABIHAT_DECK_ID } from "@/lib/fsrs/queries";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";

export type ProfileSurahProgress = {
  surah: number;
  nameArabic: string;
  nameEnglish: string;
  totalCards: number;
  memorized: number;
};

export async function getLocalSurahProgress(db: SQLiteDatabase): Promise<ProfileSurahProgress[]> {
  const surahRows = await db.getAllAsync<{
    surah: number;
    total: number;
    memorized: number;
  }>(
    `WITH ayah_cards AS (
       SELECT
         CASE
           WHEN sc.deck_id = ? AND sc.id LIKE ? THEN SUBSTR(sc.id, LENGTH(?) + 2)
           ELSE sc.id
         END as ayah_key,
         sc.reps,
         sc.last_review
       FROM study_cards sc
       WHERE sc.id NOT LIKE 'word:%'
         AND sc.deck_id NOT IN (?, ?, ?)
     )
     SELECT
       CAST(SUBSTR(ayah_key, 1, INSTR(ayah_key, ':') - 1) AS INTEGER) as surah,
       COUNT(*) as total,
       SUM(CASE WHEN reps > 0 OR last_review IS NOT NULL THEN 1 ELSE 0 END) as memorized
     FROM ayah_cards
     WHERE INSTR(ayah_key, ':') > 1
     GROUP BY surah
     ORDER BY surah`,
    [
      MUTASHABIHAT_DECK_ID,
      `${MUTASHABIHAT_DECK_ID}:%`,
      MUTASHABIHAT_DECK_ID,
      SMART_DECK_IDS.mutashabihat,
      SMART_DECK_IDS.similarTails,
      SMART_DECK_IDS.qiraat,
      SMART_DECK_IDS.reasonsOfRevelation,
    ]
  );

  return attachSurahNames(db, surahRows.map((row) => ({
    surah: row.surah,
    totalCards: row.total,
    memorized: row.memorized,
  })));
}

export async function attachSurahNames(
  db: SQLiteDatabase,
  rows: Array<{ surah: number; totalCards: number; memorized: number }>
): Promise<ProfileSurahProgress[]> {
  if (rows.length === 0) return [];

  const surahNums = rows.map((row) => row.surah);
  const placeholders = surahNums.map(() => "?").join(",");
  const nameRows = await db.getAllAsync<{ number: number; name_arabic: string; name_english: string }>(
    `SELECT number, name_arabic, name_english FROM surahs WHERE number IN (${placeholders})`,
    surahNums
  );
  const nameMap = new Map(nameRows.map((row) => [row.number, row]));

  return rows.map((row) => ({
    surah: row.surah,
    nameArabic: nameMap.get(row.surah)?.name_arabic ?? `Surah ${row.surah}`,
    nameEnglish: nameMap.get(row.surah)?.name_english ?? "",
    totalCards: row.totalCards,
    memorized: row.memorized,
  }));
}
