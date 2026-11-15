import { toArabicNumber } from "@/lib/arabic";

type Language = "en" | "ar";

function oneDecimal(value: number): number {
  return value >= 10 ? Math.floor(value) : Math.floor(value * 10) / 10;
}

/**
 * Like and comment counts in the interface's digits, compact from a thousand: 999, 1.2K, 12K, 1.2M
 * in English and ٩٩٩، ١٫٢ ألف، ١٫٢ مليون in Arabic. Values round down so a count never overstates.
 */
export function formatCompactCount(n: number, language: Language): string {
  const value = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  const scaled =
    value >= 1_000_000
      ? { amount: oneDecimal(value / 1_000_000), en: "M", ar: "مليون" }
      : value >= 1_000
        ? { amount: oneDecimal(value / 1_000), en: "K", ar: "ألف" }
        : null;
  if (!scaled) return language === "ar" ? toArabicNumber(value) : String(value);
  if (language === "ar") return `${toArabicNumber(scaled.amount).replace(".", "٫")} ${scaled.ar}`;
  return `${scaled.amount}${scaled.en}`;
}

/** Wraps a canonical numeric reference ("2:255") so it stays left to right inside Arabic text. */
export function isolateReference(reference: string): string {
  return `⁦${reference}⁩`;
}

/** A surah:ayah or surah:start-end reference in the interface's digits, kept left to right. */
export function formatAyahReference(surah: number, ayahStart: number, ayahEnd: number, language: Language): string {
  const digits = (n: number) => (language === "ar" ? toArabicNumber(n) : String(n));
  const ayahs = ayahStart === ayahEnd ? digits(ayahStart) : `${digits(ayahStart)}-${digits(ayahEnd)}`;
  return isolateReference(`${digits(surah)}:${ayahs}`);
}
