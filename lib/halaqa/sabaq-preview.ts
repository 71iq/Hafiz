import { toArabicNumber } from "@/lib/arabic";
import type { DatabaseExecutor } from "@/lib/database/types";
import { loadRecitationPage, type PageToken, type RecitationPage } from "@/lib/hifz/page-data";
import type { AssignedSabaq } from "@/lib/hifz/sabaq";

const OPENING_WORDS = 4;

type AyahRef = Readonly<{ surah: number; ayah: number }>;

export type SabaqRangeCover =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      kind: "ayat";
      first: AyahRef;
      last: AyahRef;
      firstLine: number;
      lastLine: number;
      startsMidAyah: boolean;
      endsMidAyah: boolean;
      opening: readonly PageToken[];
      openingContinues: boolean;
    }>;

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
      opening: string;
      openingContinues: boolean;
    }>;

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
  const wordsOf = new Map(
    textRows.map((row) => [`${row.surah}:${row.ayah}`, row.text_uthmani.split(" ").filter(Boolean)]),
  );
  const parts: string[] = [];
  let words = 0;
  for (const token of cover.opening) {
    const ayahWords = wordsOf.get(`${token.surah}:${token.ayah}`);
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
