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
