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

/** The first page of each juz (30 pages), from the existing juz and page mappings. */
export function juzStartPages(index: MushafIndex): Set<number> {
  const firstByJuz = new Map<number, { surah: number; ayah: number }>();
  for (const row of index.juzRows) {
    const current = firstByJuz.get(row.juz);
    if (!current || row.surah < current.surah || (row.surah === current.surah && row.ayah_start < current.ayah)) {
      firstByJuz.set(row.juz, { surah: row.surah, ayah: row.ayah_start });
    }
  }
  const pages = new Set<number>();
  for (const start of firstByJuz.values()) {
    const page = pageForAyah(index, start.surah, start.ayah);
    if (page !== null) pages.add(page);
  }
  return pages;
}

export type ReaderPositionLike = { mode: "page"; page: number } | { mode: "verse"; surah: number; ayah: number };

/**
 * Converts a saved position to another view: a saved page opens verse view at that page's first
 * ayah, and a saved ayah opens page view at its page. Null when the mapping has no answer.
 */
export function positionForMode(
  index: MushafIndex,
  position: ReaderPositionLike,
  mode: "page" | "verse",
): ReaderPositionLike | null {
  if (position.mode === mode) return position;
  if (position.mode === "page") {
    const top = topmostAyahForPage(index, position.page);
    return top ? { mode: "verse", surah: top.surah, ayah: top.ayah } : null;
  }
  const page = pageForAyah(index, position.surah, position.ayah);
  return page ? { mode: "page", page } : null;
}

type PageLineForEstimate = {
  line_number: number;
  line_type: string;
  first_word_id: number | null;
  last_word_id: number | null;
  surah_number: number | null;
};

/**
 * Estimates where an ayah starts on its page as a fraction of the page's lines (0 = top), from the
 * page's line layout. A surah's first ayah is placed at its surah header line, so the header shows
 * above it. Falls back to the share of glyphs before the ayah when the layout cannot place it.
 */
export function estimateAyahLineFraction(
  ayahs: readonly { surah: number; ayah: number; glyphCount: number }[],
  target: { surah: number; ayah: number },
  lineLayout?: readonly PageLineForEstimate[],
  globalWordOffset?: number,
): number | null {
  const targetIndex = ayahs.findIndex((ayah) => ayah.surah === target.surah && ayah.ayah === target.ayah);
  if (targetIndex < 0) return null;
  const before = ayahs.slice(0, targetIndex).reduce((sum, ayah) => sum + ayah.glyphCount, 0);
  const total = ayahs.reduce((sum, ayah) => sum + ayah.glyphCount, 0);
  if (lineLayout && lineLayout.length > 0) {
    const lineCount = Math.max(...lineLayout.map((line) => line.line_number));
    if (target.ayah === 1) {
      const header = lineLayout.find((line) => line.line_type === "surah_name" && line.surah_number === target.surah);
      if (header && lineCount > 0) return (header.line_number - 1) / lineCount;
    }
    if (typeof globalWordOffset === "number" && lineCount > 0) {
      const wordId = globalWordOffset + before + 1;
      const line = lineLayout.find(
        (row) =>
          row.line_type === "ayah" &&
          typeof row.first_word_id === "number" &&
          typeof row.last_word_id === "number" &&
          wordId >= row.first_word_id &&
          wordId <= row.last_word_id,
      );
      if (line) return (line.line_number - 1) / lineCount;
    }
  }
  return total > 0 ? before / total : null;
}
