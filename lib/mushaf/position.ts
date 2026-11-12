import type { DatabaseExecutor } from "@/lib/database/types";

type JuzRow = {
  juz: number;
  surah: number;
  ayah_start: number;
  ayah_end: number;
};

type HizbRow = {
  hizb: number;
  surah_start: number;
  ayah_start: number;
  surah_end: number;
  ayah_end: number;
};

type SurahMeta = {
  number: number;
  name_arabic: string;
  name_english: string;
};

type PageRow = {
  page: number;
  surah_start: number;
  ayah_start: number;
  surah_end: number;
  ayah_end: number;
};

/** Snapshot loaded once and cached so the indicator does not re-query SQLite per scroll tick. */
export type MushafIndex = {
  juzRows: JuzRow[];
  hizbRows: HizbRow[];
  surahByNumber: Map<number, SurahMeta>;
  pageByNumber: Map<number, PageRow>;
};

let cachedIndex: MushafIndex | null = null;

export async function loadMushafIndex(db: DatabaseExecutor): Promise<MushafIndex> {
  if (cachedIndex) return cachedIndex;
  const [juzRows, hizbRows, surahs, pages] = await Promise.all([
    db.getAllAsync<JuzRow>(
      "SELECT juz, surah, ayah_start, ayah_end FROM juz_map ORDER BY juz, surah, ayah_start"
    ),
    db.getAllAsync<HizbRow>(
      "SELECT hizb, surah_start, ayah_start, surah_end, ayah_end FROM hizb_map ORDER BY hizb"
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

  cachedIndex = { juzRows, hizbRows, surahByNumber, pageByNumber };
  return cachedIndex;
}

/** Return the first inclusive match in the supplied order. Callers own fallback policy. */
export function findJuzRangeForAyah(ranges: readonly JuzRow[], surah: number, ayah: number): JuzRow | undefined {
  return ranges.find((range) => range.surah === surah && ayah >= range.ayah_start && ayah <= range.ayah_end);
}

export function findJuzForAyah(index: MushafIndex, surah: number, ayah: number): number {
  // juzRows are ordered by juz then surah/ayah_start. A juz is the row where
  // surah matches and ayah is in [start, end].
  const range = findJuzRangeForAyah(index.juzRows, surah, ayah);
  if (range) return range.juz;
  // Fallback: pick the latest juz whose first row precedes (surah, ayah).
  let best = 1;
  for (const r of index.juzRows) {
    if (r.surah < surah || (r.surah === surah && r.ayah_start <= ayah)) {
      best = r.juz;
    }
  }
  return best;
}

export function findHizbForAyah(index: MushafIndex, surah: number, ayah: number): number {
  for (const r of index.hizbRows) {
    const isAfterStart =
      surah > r.surah_start || (surah === r.surah_start && ayah >= r.ayah_start);
    const isBeforeEnd =
      surah < r.surah_end || (surah === r.surah_end && ayah <= r.ayah_end);
    if (isAfterStart && isBeforeEnd) return r.hizb;
  }
  let best = 1;
  for (const r of index.hizbRows) {
    if (surah > r.surah_start || (surah === r.surah_start && ayah >= r.ayah_start)) {
      best = r.hizb;
    }
  }
  return best;
}

export function topmostAyahForPage(index: MushafIndex, page: number): { surah: number; ayah: number } | null {
  const row = index.pageByNumber.get(page);
  if (!row) return null;
  return { surah: row.surah_start, ayah: row.ayah_start };
}

/** The page an ayah sits on (the first one, when an ayah spans two pages), or null. */
export function pageForAyah(index: MushafIndex, surah: number, ayah: number): number | null {
  const target = surah * 1000 + ayah;
  for (const row of index.pageByNumber.values()) {
    const start = row.surah_start * 1000 + row.ayah_start;
    const end = row.surah_end * 1000 + row.ayah_end;
    if (target >= start && target <= end) return row.page;
  }
  return null;
}
