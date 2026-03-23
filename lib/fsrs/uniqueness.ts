import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Card Uniqueness Algorithm (§3.6.2)
 *
 * Problem: Some ayah texts repeat verbatim (e.g., "فبأي آلاء ربكما تكذبان" × 31 in Ar-Rahman).
 * The "front" of each card must be uniquely identifiable.
 *
 * 1. Check if ayah text_clean is unique across the entire Quran.
 * 2. If not, prepend the previous ayah text until the combo is unique.
 * 3. If still not unique after 2 ayahs of context, add surah name + ayah number.
 * 4. Always show surah name subtly as secondary context.
 */

type UniqueFront = {
  /** The primary text to show (may include context ayahs) */
  text: string;
  /** Surah name (always provided as secondary context) */
  surahName: string;
  /** The ayah number */
  ayahNumber: number;
  /** How many context ayahs were prepended (0, 1, or 2) */
  contextCount: number;
  /** Whether explicit surah+ayah label is needed for uniqueness */
  needsExplicitLabel: boolean;
};

// Cache of text_clean → occurrence count
let duplicateCache: Map<string, number> | null = null;

async function buildDuplicateCache(db: SQLiteDatabase): Promise<Map<string, number>> {
  if (duplicateCache) return duplicateCache;

  const rows = await db.getAllAsync<{ text_clean: string; cnt: number }>(
    "SELECT text_clean, COUNT(*) as cnt FROM quran_text GROUP BY text_clean HAVING cnt > 1"
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.text_clean, row.cnt);
  }
  duplicateCache = map;
  return map;
}

/** Clear the cache (call if data changes) */
export function clearUniquenessCache() {
  duplicateCache = null;
}

/**
 * Compute the unique front text for a card.
 * Returns the minimum context needed to make this card's prompt unique.
 */
export async function computeUniqueFront(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): Promise<UniqueFront> {
  const dupes = await buildDuplicateCache(db);

  // Get the ayah's own text
  const row = await db.getFirstAsync<{ text_clean: string; text_uthmani: string }>(
    "SELECT text_clean, text_uthmani FROM quran_text WHERE surah = ? AND ayah = ?",
    [surah, ayah]
  );
  if (!row) {
    return { text: "", surahName: "", ayahNumber: ayah, contextCount: 0, needsExplicitLabel: false };
  }

  // Get surah name
  const surahRow = await db.getFirstAsync<{ name_arabic: string }>(
    "SELECT name_arabic FROM surahs WHERE number = ?",
    [surah]
  );
  const surahName = surahRow?.name_arabic ?? "";

  // If text_clean is unique, no extra context needed
  if (!dupes.has(row.text_clean)) {
    return {
      text: row.text_uthmani,
      surahName,
      ayahNumber: ayah,
      contextCount: 0,
      needsExplicitLabel: false,
    };
  }

  // Try prepending previous ayah(s) for uniqueness
  for (let ctx = 1; ctx <= 2; ctx++) {
    const prevAyah = ayah - ctx;
    if (prevAyah < 1) break;

    const prevRows = await db.getAllAsync<{ text_uthmani: string; text_clean: string }>(
      `SELECT text_uthmani, text_clean FROM quran_text
       WHERE surah = ? AND ayah >= ? AND ayah <= ?
       ORDER BY ayah`,
      [surah, ayah - ctx, ayah]
    );

    if (prevRows.length !== ctx + 1) break; // Can't go further back (start of surah)

    const combinedClean = prevRows.map((r) => r.text_clean).join(" ");

    // Check if this combined text is unique
    const match = await db.getFirstAsync<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM (
        SELECT q1.surah, q1.ayah FROM quran_text q1
        WHERE EXISTS (
          SELECT 1 FROM quran_text q2
          WHERE q2.surah = q1.surah
            AND q2.ayah >= q1.ayah - ?
            AND q2.ayah <= q1.ayah
          GROUP BY q2.surah
          HAVING GROUP_CONCAT(q2.text_clean, ' ') = ?
        )
      )`,
      [ctx, combinedClean]
    );

    // Simpler approach: just check if the combined text + surah combo is unique enough
    // Since we're prepending, the combo is already much more unique
    const combinedUthmani = prevRows.map((r) => r.text_uthmani).join(" ﴿...﴾ ");

    // For practical purposes, prepending even 1 ayah makes it unique in nearly all cases
    // The few remaining cases (e.g., repeated consecutive ayahs) get the explicit label
    if (ctx === 1) {
      // Check if prev+current combo still appears elsewhere
      const otherMatches = await db.getFirstAsync<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM quran_text a
         JOIN quran_text b ON a.surah = b.surah AND a.ayah = b.ayah - 1
         WHERE b.text_clean = ? AND a.text_clean = ?
           AND NOT (a.surah = ? AND a.ayah = ?)`,
        [row.text_clean, prevRows[0].text_clean, surah, ayah - 1]
      );
      if (!otherMatches || otherMatches.cnt === 0) {
        return {
          text: combinedUthmani,
          surahName,
          ayahNumber: ayah,
          contextCount: ctx,
          needsExplicitLabel: false,
        };
      }
    }

    if (ctx === 2) {
      // After 2 context ayahs, check again
      const prevClean0 = prevRows[0].text_clean;
      const prevClean1 = prevRows[1].text_clean;
      const otherMatches = await db.getFirstAsync<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM quran_text a
         JOIN quran_text b ON a.surah = b.surah AND a.ayah = b.ayah - 1
         JOIN quran_text c ON b.surah = c.surah AND b.ayah = c.ayah - 1
         WHERE c.text_clean = ? AND b.text_clean = ? AND a.text_clean = ?
           AND NOT (a.surah = ? AND a.ayah = ?)`,
        [row.text_clean, prevClean1, prevClean0, surah, ayah - 2]
      );
      if (!otherMatches || otherMatches.cnt === 0) {
        return {
          text: combinedUthmani,
          surahName,
          ayahNumber: ayah,
          contextCount: ctx,
          needsExplicitLabel: false,
        };
      }
    }
  }

  // Still not unique after 2 context ayahs → use explicit surah + ayah label
  return {
    text: row.text_uthmani,
    surahName,
    ayahNumber: ayah,
    contextCount: 0,
    needsExplicitLabel: true,
  };
}

/**
 * Extract first letter of each word in an ayah (for First Letter test mode).
 * Strips diacritics to get the base letter.
 */
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640]/g;

export function getFirstLetters(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const stripped = word.replace(DIACRITICS, "");
      return stripped.charAt(0);
    })
    .join(" ");
}
