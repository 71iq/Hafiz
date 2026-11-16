import { formatAyahRef, toArabicNumber } from "@/lib/arabic";

export const CANONICAL_ORIGIN = "https://hafizquran.app";

export type CopyLanguage = "en" | "ar";

export type QuranCopyRange = {
  surah: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  ayahStart: number;
  ayahEnd: number;
};

export function canonicalAyahLink(surah: number, ayah: number): string {
  return `${CANONICAL_ORIGIN}/open?surah=${surah}&ayah=${ayah}`;
}

export function withAyahNumber(text: string, ayah: number): string {
  const trimmed = text.trim();
  return trimmed ? `${trimmed} ${toArabicNumber(ayah)}` : "";
}

export function formatQuranReference(range: QuranCopyRange, language: CopyLanguage): string {
  const arabic = language === "ar";
  const name = (arabic ? range.surahNameArabic : range.surahNameEnglish) || range.surahNameArabic || range.surahNameEnglish;
  const start = formatAyahRef(arabic, range.surah, range.ayahStart);
  const ref =
    range.ayahEnd !== range.ayahStart ? `${start}-${arabic ? toArabicNumber(range.ayahEnd) : range.ayahEnd}` : start;
  return name ? `${name} ${ref}` : ref;
}

export function formatQuranCopy({
  text,
  ranges,
  language,
}: {
  text: string;
  ranges: readonly QuranCopyRange[];
  language: CopyLanguage;
}): string {
  const first = ranges[0];
  const references = ranges.map((range) => formatQuranReference(range, language)).join(language === "ar" ? "، " : "; ");
  const lines = [`﴿${text.trim()}﴾`];
  if (references) lines.push(references);
  if (first) lines.push(canonicalAyahLink(first.surah, first.ayahStart));
  return lines.join("\n");
}
