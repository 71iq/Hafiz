import type { DatabaseExecutor } from "@/lib/database/types";
import { readMemorizedPageNumbers } from "@/lib/hifz/pages";
import { isValidSurah, SURAH_COUNT } from "@/lib/search/reference";
import { isFullHafiz } from "@/lib/study/daily-decks";

/** Surahs to use for related ayahs across this session. Each card also keeps its own surah. */
export async function readKnownSurahs(db: DatabaseExecutor): Promise<ReadonlySet<number> | null> {
  if (await isFullHafiz(db)) return new Set(Array.from({ length: SURAH_COUNT }, (_, index) => index + 1));

  const pages = [...(await readMemorizedPageNumbers(db))];
  const [pageSurahs, ayahCards] = await Promise.all([
    pages.length
      ? db.getAllAsync<{ surah: number }>(
          `SELECT DISTINCT surah FROM quran_text WHERE v2_page IN (${pages.map(() => "?").join(", ")})`,
          pages,
        )
      : [],
    // Numeric ayah ids also identify Retention cards saved before the built-in deck existed.
    db.getAllAsync<{ id: string }>("SELECT id FROM study_cards WHERE id >= '0' AND id < ':' AND deleted_at IS NULL"),
  ]);
  const known = new Set(pageSurahs.map((row) => row.surah));
  for (const { id } of ayahCards) {
    const match = /^(\d+):\d+$/.exec(id);
    if (match && isValidSurah(Number(match[1]))) known.add(Number(match[1]));
  }
  return known.size ? known : null;
}
