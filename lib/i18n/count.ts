import { toArabicNumber } from "@/lib/arabic";

type Language = "en" | "ar";

type ArabicForms = Readonly<{ one: string; two: string; few: string; many: string }>;

/**
 * Arabic counted nouns: 1 and 2 have their own words, 3 to 10 take the plural, 11 to 99 the singular
 * accusative, and hundreds follow the last two digits (١٠٠ يوم, ١٠٣ أيام, ١١٢ يومًا).
 */
function arabicCount(n: number, forms: ArabicForms): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const lastTwo = n % 100;
  const number = toArabicNumber(n);
  if (lastTwo >= 3 && lastTwo <= 10) return `${number} ${forms.few}`;
  if (lastTwo >= 11 && lastTwo <= 99) return `${number} ${forms.many}`;
  return `${number} ${forms.one.split(" ")[0]}`;
}

const DAYS: ArabicForms = { one: "يوم واحد", two: "يومان", few: "أيام", many: "يومًا" };
const MINUTES: ArabicForms = { one: "دقيقة واحدة", two: "دقيقتان", few: "دقائق", many: "دقيقة" };
const PAGES: ArabicForms = { one: "صفحة واحدة", two: "صفحتان", few: "صفحات", many: "صفحة" };

export function formatDays(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, DAYS);
  return n === 1 ? "1 day" : `${n.toLocaleString("en")} days`;
}

export function formatMinutes(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, MINUTES);
  return n === 1 ? "1 minute" : `${n.toLocaleString("en")} minutes`;
}

/** Whole pages, or a half and quarter page in words. */
export function formatPages(n: number, language: Language): string {
  if (n === 0.5) return language === "ar" ? "نصف صفحة" : "½ page";
  if (n === 0.25) return language === "ar" ? "ربع صفحة" : "¼ page";
  if (!Number.isInteger(n)) {
    const value = Math.round(n * 10) / 10;
    return language === "ar" ? `${toArabicNumber(value)} صفحة` : `${value} pages`;
  }
  if (language === "ar") return arabicCount(n, PAGES);
  return n === 1 ? "1 page" : `${n.toLocaleString("en")} pages`;
}

/** A plain number in the interface's digits. */
export function formatNumber(n: number, language: Language): string {
  return language === "ar" ? toArabicNumber(n) : n.toLocaleString("en");
}

/** Minutes for a compact chip: "5 min" or "٥ د". */
export function formatMinutesShort(n: number, language: Language): string {
  return language === "ar" ? `${toArabicNumber(n)} د` : `${n} min`;
}

const LINES: ArabicForms = { one: "سطر واحد", two: "سطران", few: "أسطر", many: "سطرًا" };

export function formatLines(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, LINES);
  return n === 1 ? "1 line" : `${n.toLocaleString("en")} lines`;
}

const OCCURRENCES: ArabicForms = { one: "موضع واحد", two: "موضعان", few: "مواضع", many: "موضعًا" };

/** Places a root occurs in the Quran: "موضعان", "١٢ موضعًا" or "3 occurrences". */
export function formatOccurrences(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, OCCURRENCES);
  return n === 1 ? "1 occurrence" : `${n.toLocaleString("en")} occurrences`;
}

const SURAHS: ArabicForms = { one: "سورة واحدة", two: "سورتان", few: "سور", many: "سورة" };
const AYAHS: ArabicForms = { one: "آية واحدة", two: "آيتان", few: "آيات", many: "آية" };
const CARDS: ArabicForms = { one: "بطاقة واحدة", two: "بطاقتان", few: "بطاقات", many: "بطاقة" };

export function formatSurahs(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, SURAHS);
  return n === 1 ? "1 surah" : `${n.toLocaleString("en")} surahs`;
}

export function formatAyahs(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, AYAHS);
  return n === 1 ? "1 ayah" : `${n.toLocaleString("en")} ayahs`;
}

export function formatCards(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, CARDS);
  return n === 1 ? "1 card" : `${n.toLocaleString("en")} cards`;
}

const REVIEWS: ArabicForms = { one: "مراجعة واحدة", two: "مراجعتان", few: "مراجعات", many: "مراجعة" };

/** Reviews on a day or in total, including zero: "0 reviews", "1 review", "٠ مراجعة", "مراجعتان". */
export function formatReviews(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, REVIEWS);
  return n === 1 ? "1 review" : `${n.toLocaleString("en")} reviews`;
}

const RESULTS: ArabicForms = { one: "نتيجة واحدة", two: "نتيجتان", few: "نتائج", many: "نتيجة" };
const FORMS: ArabicForms = { one: "صيغة واحدة", two: "صيغتان", few: "صيغ", many: "صيغة" };

/** Search results: "1 result", "نتيجتان", "١٢ نتيجة". */
export function formatResults(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, RESULTS);
  return n === 1 ? "1 result" : `${n.toLocaleString("en")} results`;
}

/** Word forms found for a root: "3 forms", "٣ صيغ". */
export function formatForms(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, FORMS);
  return n === 1 ? "1 form" : `${n.toLocaleString("en")} forms`;
}

/** Places a root search found: "42 places", "٤٢ موضعًا". */
export function formatPlaces(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, OCCURRENCES);
  return n === 1 ? "1 place" : `${n.toLocaleString("en")} places`;
}

const JUZ: ArabicForms = { one: "جزء واحد", two: "جزآن", few: "أجزاء", many: "جزءًا" };

/** Whole juz: "1 juz", "3 juz", "جزآن", "٣ أجزاء". */
export function formatJuz(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, JUZ);
  return `${n.toLocaleString("en")} juz`;
}

const POINTS: ArabicForms = { one: "نقطة واحدة", two: "نقطتان", few: "نقاط", many: "نقطة" };

/** Board points: "1 point", "12 points", "نقطتان", "١٢ نقطة". */
export function formatPoints(n: number, language: Language): string {
  if (language === "ar") return arabicCount(n, POINTS);
  return n === 1 ? "1 point" : `${n.toLocaleString("en")} points`;
}
