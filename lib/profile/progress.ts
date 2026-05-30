import type { SQLiteDatabase } from "expo-sqlite";
import {
  getDueCount,
  getNewCount,
  getTotalCardCount,
  MEANINGS_DECK_ID,
  MUTASHABIHAT_DECK_ID,
} from "@/lib/fsrs/queries";
import { getSmartDeckStats, SMART_DECK_IDS, type SmartDeckId } from "@/lib/fsrs/smart-decks";

export type ProfileSurahProgress = {
  surah: number;
  nameArabic: string;
  nameEnglish: string;
  totalCards: number;
  memorized: number;
};

export type DefaultDeckProgressKey = "retention" | "mutashabihat" | "similarTails" | "qiraat" | "reasonsOfRevelation" | "vocabulary";

export type DefaultDeckProgressItem = {
  key: DefaultDeckProgressKey;
  deckId: string;
  isSmartDeck: boolean;
  total: number;
  newCount: number;
  startedCount: number;
  dueCount: number;
  color: string;
};

export async function getDefaultDeckProgress(db: SQLiteDatabase): Promise<DefaultDeckProgressItem[]> {
  const decks: Pick<DefaultDeckProgressItem, "key" | "deckId" | "isSmartDeck" | "color">[] = [
    { key: "retention", deckId: SMART_DECK_IDS.retention, isSmartDeck: true, color: "#14b8a6" },
    { key: "mutashabihat", deckId: SMART_DECK_IDS.mutashabihat, isSmartDeck: true, color: "#0d9488" },
    { key: "similarTails", deckId: SMART_DECK_IDS.similarTails, isSmartDeck: true, color: "#ca8a04" },
    { key: "qiraat", deckId: SMART_DECK_IDS.qiraat, isSmartDeck: true, color: "#2563eb" },
    { key: "reasonsOfRevelation", deckId: SMART_DECK_IDS.reasonsOfRevelation, isSmartDeck: true, color: "#d97706" },
    { key: "vocabulary", deckId: MEANINGS_DECK_ID, isSmartDeck: false, color: "#be123c" },
  ];

  return Promise.all(decks.map(async (deck) => {
    try {
      if (deck.isSmartDeck) {
        const stats = await getSmartDeckStats(db, deck.deckId as SmartDeckId);
        const newCount = Math.max(0, Math.min(stats.total, stats.newCount));
        return {
          ...deck,
          total: stats.total,
          newCount,
          startedCount: Math.max(0, stats.total - newCount),
          dueCount: Math.max(0, Math.min(stats.total, stats.due)),
        };
      }

      const [total, rawNewCount, rawDueCount] = await Promise.all([
        getTotalCardCount(db, deck.deckId),
        getNewCount(db, deck.deckId),
        getDueCount(db, deck.deckId),
      ]);
      const newCount = Math.max(0, Math.min(total, rawNewCount));
      return {
        ...deck,
        total,
        newCount,
        startedCount: Math.max(0, total - newCount),
        dueCount: Math.max(0, Math.min(total, rawDueCount)),
      };
    } catch (error) {
      console.warn(`[Progress] Failed to load default deck progress for ${deck.deckId}:`, error);
      return {
        ...deck,
        total: 0,
        newCount: 0,
        startedCount: 0,
        dueCount: 0,
      };
    }
  }));
}

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
       WHERE sc.deleted_at IS NULL
         AND sc.id NOT LIKE 'word:%'
         AND sc.deck_id NOT IN (?, ?, ?, ?)
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

export function summarizeSurahProgress(rows: ProfileSurahProgress[]): { totalCards: number; memorized: number; retentionPct: number } {
  const totalCards = rows.reduce((sum, row) => sum + row.totalCards, 0);
  const memorized = rows.reduce((sum, row) => sum + row.memorized, 0);
  return {
    totalCards,
    memorized,
    retentionPct: totalCards > 0 ? Math.round((memorized / totalCards) * 100) : 0,
  };
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
