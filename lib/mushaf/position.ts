import type { SQLiteDatabase } from "expo-sqlite";

export type JuzRow = {
  juz: number;
  surah: number;
  ayah_start: number;
  ayah_end: number;
};

export type SurahMeta = {
  number: number;
  name_arabic: string;
  name_english: string;
};

export type PageRow = {
  page: number;
  surah_start: number;
  ayah_start: number;
  surah_end: number;
  ayah_end: number;
};

/** Snapshot loaded once and cached so the indicator does not re-query SQLite per scroll tick. */
export type MushafIndex = {
  juzRows: JuzRow[];
  surahByNumber: Map<number, SurahMeta>;
  pageByNumber: Map<number, PageRow>;
};

let cachedIndex: MushafIndex | null = null;

export async function loadMushafIndex(db: SQLiteDatabase): Promise<MushafIndex> {
  if (cachedIndex) return cachedIndex;
  const [juzRows, surahs, pages] = await Promise.all([
    db.getAllAsync<JuzRow>(
      "SELECT juz, surah, ayah_start, ayah_end FROM juz_map ORDER BY juz, surah, ayah_start"
    ),
    db.getAllAsync<SurahMeta>(
      "SELECT number, name_arabic, name_english FROM surahs ORDER BY number"
    ),
    db.getAllAsync<PageRow>(
      "SELECT page, surah_start, ayah_start, surah_end, ayah_end FROM page_map ORDER BY page"
    ),
  ]);

  const surahByNumber = new Map<number, SurahMeta>();
  for (const s of surahs) surahByNumber.set(s.number, s);

  const pageByNumber = new Map<number, PageRow>();
  for (const p of pages) pageByNumber.set(p.page, p);

  cachedIndex = { juzRows, surahByNumber, pageByNumber };
  return cachedIndex;
}

export function findJuzForAyah(index: MushafIndex, surah: number, ayah: number): number {
  // juzRows are ordered by juz then surah/ayah_start. A juz is the row where
  // surah matches and ayah is in [start, end].
  for (const r of index.juzRows) {
    if (r.surah === surah && ayah >= r.ayah_start && ayah <= r.ayah_end) return r.juz;
  }
  // Fallback: pick the latest juz whose first row precedes (surah, ayah).
  let best = 1;
  for (const r of index.juzRows) {
    if (r.surah < surah || (r.surah === surah && r.ayah_start <= ayah)) {
      best = r.juz;
    }
  }
  return best;
}

export function topmostSurahForPage(index: MushafIndex, page: number): number | null {
  const row = index.pageByNumber.get(page);
  return row?.surah_start ?? null;
}

export function topmostAyahForPage(index: MushafIndex, page: number): { surah: number; ayah: number } | null {
  const row = index.pageByNumber.get(page);
  if (!row) return null;
  return { surah: row.surah_start, ayah: row.ayah_start };
}
