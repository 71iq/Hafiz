import type { DatabaseExecutor } from "@/lib/database/types";


type UniqueFront = {
  text: string;
  surahName: string;
  ayahNumber: number;
  contextCount: number;
  needsExplicitLabel: boolean;
};

let duplicateCache: Map<string, number> | null = null;

async function buildDuplicateCache(db: DatabaseExecutor): Promise<Map<string, number>> {
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

export async function computeUniqueFront(
  db: DatabaseExecutor,
  surah: number,
  ayah: number
): Promise<UniqueFront> {
  const dupes = await buildDuplicateCache(db);

  const row = await db.getFirstAsync<{ text_clean: string; text_uthmani: string }>(
    "SELECT text_clean, text_uthmani FROM quran_text WHERE surah = ? AND ayah = ?",
    [surah, ayah]
  );
  if (!row) {
    return { text: "", surahName: "", ayahNumber: ayah, contextCount: 0, needsExplicitLabel: false };
  }

  const surahRow = await db.getFirstAsync<{ name_arabic: string }>(
    "SELECT name_arabic FROM surahs WHERE number = ?",
    [surah]
  );
  const surahName = surahRow?.name_arabic ?? "";

  if (!dupes.has(row.text_clean)) {
    return {
      text: row.text_uthmani,
      surahName,
      ayahNumber: ayah,
      contextCount: 0,
      needsExplicitLabel: false,
    };
  }

  for (let ctx = 1; ctx <= 2; ctx++) {
    const prevAyah = ayah - ctx;
    if (prevAyah < 1) break;

    const prevRows = await db.getAllAsync<{ text_uthmani: string; text_clean: string }>(
      `SELECT text_uthmani, text_clean FROM quran_text
       WHERE surah = ? AND ayah >= ? AND ayah <= ?
       ORDER BY ayah`,
      [surah, ayah - ctx, ayah]
    );

    if (prevRows.length !== ctx + 1) break;

    const combinedUthmani = prevRows.map((r) => r.text_uthmani).join(" ﴿...﴾ ");

    if (ctx === 1) {
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

  return {
    text: row.text_uthmani,
    surahName,
    ayahNumber: ayah,
    contextCount: 0,
    needsExplicitLabel: true,
  };
}
