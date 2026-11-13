import type { DatabaseExecutor } from "@/lib/database/types";

/** One page-font glyph on a recitation page. A null wordPos is the ayah-end marker or an unaligned word. */
export type PageToken = Readonly<{
  glyph: string;
  surah: number;
  ayah: number;
  /** 1-based word position, or null for the ayah marker and for words that could not be aligned. */
  wordPos: number | null;
  isMarker: boolean;
  /** L1 cue: the word's first letter with its marks, or null when the word could not be aligned. */
  firstLetter: string | null;
}>;

export type PageLine = Readonly<{
  lineNumber: number;
  kind: "surah_name" | "basmallah" | "ayah";
  centered: boolean;
  surahNumber: number | null;
  tokens: readonly PageToken[];
}>;

export type RecitationPage = Readonly<{
  page: number;
  lines: readonly PageLine[];
  ayahs: readonly { surah: number; ayah: number }[];
}>;

/** Per page, the glyphs on each line (the reader's page-words data). */
export type PageWordsLines = Readonly<Record<string, string>>;

const ARABIC_MARK = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/;

/**
 * The first letter of an Uthmani word with the marks that sit on it, so L1 shows "ٱ" for "ٱللَّهِ"
 * and "إِ" for "إِنَّ". Rendered from the canonical text and never stored (ETH-12).
 */
export function firstLetterOf(word: string): string {
  const chars = Array.from(word);
  if (chars.length === 0) return "";
  let end = 1;
  while (end < chars.length && ARABIC_MARK.test(chars[end])) end += 1;
  return chars.slice(0, end).join("");
}

type AyahRow = { surah: number; ayah: number; text_qcf2: string; text_uthmani: string };
type LineRow = {
  line_number: number;
  line_type: string;
  is_centered: number;
  surah_number: number | null;
  first_word_id: number | null;
  last_word_id: number | null;
};

function pageTokens(ayahs: readonly AyahRow[]): PageToken[] {
  const tokens: PageToken[] = [];
  for (const row of ayahs) {
    const glyphs = row.text_qcf2.split(" ").filter(Boolean);
    const words = row.text_uthmani.split(" ").filter(Boolean);
    const aligned = words.length === glyphs.length - 1;
    glyphs.forEach((glyph, index) => {
      const isMarker = index === glyphs.length - 1;
      tokens.push({
        glyph,
        surah: row.surah,
        ayah: row.ayah,
        wordPos: isMarker || !aligned ? null : index + 1,
        isMarker,
        firstLetter: isMarker || !aligned ? null : firstLetterOf(words[index]),
      });
    });
  }
  return tokens;
}

function structural(row: LineRow): PageLine {
  return {
    lineNumber: row.line_number,
    kind: row.line_type === "surah_name" ? "surah_name" : "basmallah",
    centered: true,
    surahNumber: row.surah_number,
    tokens: [],
  };
}

/**
 * Build a recitation page with the same line breaks as the reader (MushafPage): the page-words
 * lines when their glyphs match the page's ayat exactly, otherwise each line's word-id range.
 * Each ayah's glyphs are its words then its end marker. When an ayah has more glyphs than Unicode
 * words (a few hundred ayat carry an extra mark glyph), its words keep no position or first letter
 * rather than a wrong one.
 */
export function buildRecitationPage(
  page: number,
  ayahs: readonly AyahRow[],
  lineRows: readonly LineRow[],
  pageWords: PageWordsLines | null,
): RecitationPage {
  const tokens = pageTokens(ayahs);
  const ayahList = ayahs.map((row) => ({ surah: row.surah, ayah: row.ayah }));
  const pageWordLines = pageWords
    ? Object.keys(pageWords)
        .map(Number)
        .filter((lineNumber) => Number.isInteger(lineNumber))
        .sort((a, b) => a - b)
    : [];
  const flattened = pageWordLines.flatMap((lineNumber) => (pageWords?.[String(lineNumber)] ?? "").split(" ").filter(Boolean));
  const usePageWords =
    flattened.length === tokens.length && flattened.every((glyph, index) => glyph === tokens[index].glyph);

  if (usePageWords) {
    const lines: PageLine[] = [];
    const lineNumbers = Array.from(new Set([...lineRows.map((row) => row.line_number), ...pageWordLines])).sort((a, b) => a - b);
    let cursor = 0;
    for (const lineNumber of lineNumbers) {
      for (const row of lineRows) {
        if (row.line_number === lineNumber && row.line_type !== "ayah") lines.push(structural(row));
      }
      const count = (pageWords?.[String(lineNumber)] ?? "").split(" ").filter(Boolean).length;
      if (count === 0) continue;
      const row = lineRows.find((candidate) => candidate.line_number === lineNumber && candidate.line_type === "ayah");
      lines.push({
        lineNumber,
        kind: "ayah",
        centered: row?.is_centered === 1,
        surahNumber: row?.surah_number ?? null,
        tokens: tokens.slice(cursor, cursor + count),
      });
      cursor += count;
    }
    return { page, lines, ayahs: ayahList };
  }

  const ayahLineRows = lineRows.filter((row) => row.line_type === "ayah" && typeof row.first_word_id === "number");
  const offset = ayahLineRows.length > 0 ? Math.min(...ayahLineRows.map((row) => row.first_word_id!)) - 1 : 0;
  const lastAyahLine = ayahLineRows.at(-1)?.line_number ?? null;
  const lines: PageLine[] = [];
  for (const row of lineRows) {
    if (row.line_type !== "ayah") {
      lines.push(structural(row));
      continue;
    }
    if (typeof row.first_word_id !== "number" || typeof row.last_word_id !== "number") continue;
    const start = Math.max(0, row.first_word_id - offset - 1);
    let end = Math.max(start, row.last_word_id - offset);
    if (row.line_number === lastAyahLine && end < tokens.length) end = tokens.length;
    lines.push({
      lineNumber: row.line_number,
      kind: "ayah",
      centered: row.is_centered === 1,
      surahNumber: row.surah_number,
      tokens: tokens.slice(start, end),
    });
  }
  return { page, lines, ayahs: ayahList };
}

export async function loadRecitationPage(
  db: DatabaseExecutor,
  page: number,
  pageWords: PageWordsLines | null,
): Promise<RecitationPage> {
  const [ayahs, lineRows] = await Promise.all([
    db.getAllAsync<AyahRow>(
      "SELECT surah, ayah, text_qcf2, text_uthmani FROM quran_text WHERE v2_page = ? ORDER BY surah, ayah",
      [page],
    ),
    db.getAllAsync<LineRow>(
      "SELECT line_number, line_type, is_centered, surah_number, first_word_id, last_word_id FROM page_lines WHERE page_number = ? ORDER BY line_number",
      [page],
    ),
  ]);
  return buildRecitationPage(page, ayahs, lineRows, pageWords);
}
