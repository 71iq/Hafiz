import { toArabicNumber } from "@/lib/arabic";

type Language = "en" | "ar";

function oneDecimal(value: number): number {
  return value >= 10 ? Math.floor(value) : Math.floor(value * 10) / 10;
}

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

export function isolateReference(reference: string): string {
  return `⁦${reference}⁩`;
}

export function formatAyahReference(surah: number, ayahStart: number, ayahEnd: number, language: Language): string {
  const digits = (n: number) => (language === "ar" ? toArabicNumber(n) : String(n));
  const ayahs = ayahStart === ayahEnd ? digits(ayahStart) : `${digits(ayahStart)}-${digits(ayahEnd)}`;
  return isolateReference(`${digits(surah)}:${ayahs}`);
}
