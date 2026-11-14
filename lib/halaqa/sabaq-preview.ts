import { toArabicNumber } from "@/lib/arabic";
import type { DatabaseExecutor } from "@/lib/database/types";
import { loadRecitationPage, type PageToken, type RecitationPage } from "@/lib/hifz/page-data";
import type { AssignedSabaq } from "@/lib/hifz/sabaq";

/** How many Uthmani words of the range's first line the preview shows. */
const OPENING_WORDS = 4;

type AyahRef = Readonly<{ surah: number; ayah: number }>;

/**
 * What a teacher's page and line range holds on the page's layout: its ayah lines, as the learner's
 * lesson reads them (chunkTarget in lib/hifz/sabaq.ts takes only ayah lines with words, inside the
 * range), or none.
 */
export type SabaqRangeCover =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      kind: "ayat";
      first: AyahRef;
      last: AyahRef;
      /** The first and last ayah lines inside the range. */
      firstLine: number;
      lastLine: number;
      /** The first ayah line goes on with an ayah begun on an earlier line. */
      startsMidAyah: boolean;
      /** The last ayah line stops before its last ayah ends. */
      endsMidAyah: boolean;
      /** The first line's opening tokens: up to OPENING_WORDS words and any ayah ends among them. */
      opening: readonly PageToken[];
      /** The first line goes on after `opening`. */
      openingContinues: boolean;
    }>;

/**
 * The ayat a range covers on a laid-out page. The opening stops before a word whose position in its
 * ayah is unknown (page-data leaves it null), so it never shows a wrong word.
 */
export function sabaqRangeCover(page: RecitationPage, range: AssignedSabaq): SabaqRangeCover {
  const lines = page.lines.filter((line) => line.kind === "ayah" && line.tokens.length > 0);
  const start = lines.findIndex((line) => line.lineNumber >= range.fromLine && line.lineNumber <= range.toLine);
  if (start < 0) return { kind: "empty" };
  const inside = lines.slice(start).filter((line) => line.lineNumber <= range.toLine);
  const firstLine = inside[0];
  const lastLine = inside[inside.length - 1];
  const before = start > 0 ? lines[start - 1].tokens.at(-1) : undefined;
  const firstToken = firstLine.tokens[0];
  const lastToken = lastLine.tokens[lastLine.tokens.length - 1];

  const opening: PageToken[] = [];
  let words = 0;
  for (const token of firstLine.tokens) {
    if (!token.isMarker && (words === OPENING_WORDS || token.wordPos === null)) break;
    opening.push(token);
    if (!token.isMarker) words += 1;
  }
  // An opening of only ayah ends says nothing.
  if (words === 0) opening.length = 0;

  return {
    kind: "ayat",
    first: { surah: firstToken.surah, ayah: firstToken.ayah },
    last: { surah: lastToken.surah, ayah: lastToken.ayah },
    firstLine: firstLine.lineNumber,
    lastLine: lastLine.lineNumber,
    startsMidAyah: before !== undefined && !before.isMarker,
    endsMidAyah: !lastToken.isMarker,
    opening,
    openingContinues: opening.length < firstLine.tokens.length,
  };
}

export type PreviewAyah = AyahRef & Readonly<{ surahNameArabic: string; surahNameEnglish: string }>;

/** A range's cover with its surah names and the opening as Uthmani text (never the page-font glyphs). */
export type SabaqRangePreview =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      kind: "ayat";
      first: PreviewAyah;
      last: PreviewAyah;
      firstLine: number;
      lastLine: number;
      startsMidAyah: boolean;
      endsMidAyah: boolean;
      /** The first line's opening words, an ayah's end shown as its number; empty when not known. */
      opening: string;
      openingContinues: boolean;
    }>;

/**
 * SOC-03: what a page and line range holds, for the teacher's next-sabaq form. It lays out the page
 * from the page layout table, without the page-word data, as the learner's lesson does when that data
 * is missing. It reads the local database only.
 */
export async function loadSabaqRangePreview(db: DatabaseExecutor, range: AssignedSabaq): Promise<SabaqRangePreview> {
  const cover = sabaqRangeCover(await loadRecitationPage(db, range.page, null), range);
  if (cover.kind === "empty") return cover;
  const ayahs = [...new Map(cover.opening.map((token) => [`${token.surah}:${token.ayah}`, token])).values()];
  const [surahRows, textRows] = await Promise.all([
    db.getAllAsync<{ number: number; name_arabic: string; name_english: string }>(
      "SELECT number, name_arabic, name_english FROM surahs WHERE number IN (?, ?)",
      [cover.first.surah, cover.last.surah],
    ),
    ayahs.length > 0
      ? db.getAllAsync<{ surah: number; ayah: number; text_uthmani: string }>(
          `SELECT surah, ayah, text_uthmani FROM quran_text WHERE ${ayahs.map(() => "(surah = ? AND ayah = ?)").join(" OR ")}`,
          ayahs.flatMap((token) => [token.surah, token.ayah]),
        )
      : Promise.resolve([]),
  ]);
  const named = (ref: AyahRef): PreviewAyah => {
    const row = surahRows.find((candidate) => candidate.number === ref.surah);
    return { ...ref, surahNameArabic: row?.name_arabic ?? "", surahNameEnglish: row?.name_english ?? "" };
  };
  // The same split page-data uses to give each word its position.
  const wordsOf = new Map(
    textRows.map((row) => [`${row.surah}:${row.ayah}`, row.text_uthmani.split(" ").filter(Boolean)]),
  );
  const parts: string[] = [];
  let words = 0;
  for (const token of cover.opening) {
    const ayahWords = wordsOf.get(`${token.surah}:${token.ayah}`);
    // An ayah end in brackets, as the similar-verse cards show it, so it never reads as a letter.
    const word = token.isMarker ? `(${toArabicNumber(token.ayah)})` : ayahWords?.[(token.wordPos ?? 0) - 1];
    if (word === undefined) break;
    parts.push(word);
    if (!token.isMarker) words += 1;
  }
  return {
    kind: "ayat",
    first: named(cover.first),
    last: named(cover.last),
    firstLine: cover.firstLine,
    lastLine: cover.lastLine,
    startsMidAyah: cover.startsMidAyah,
    endsMidAyah: cover.endsMidAyah,
    opening: words > 0 ? parts.join(" ") : "",
    openingContinues: cover.openingContinues || parts.length < cover.opening.length,
  };
}
