const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640]/g;
const NON_ARABIC_RE = /[^\u0600-\u06FF]/g;

/** Convert a number to Eastern Arabic-Indic numerals (٠١٢…٩) */
export function toArabicNumber(num: number): string {
  return String(num).replace(/\d/g, (d) => ARABIC_DIGITS[parseInt(d, 10)]);
}

export function normalizeArabicWord(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(ARABIC_DIACRITICS_RE, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(NON_ARABIC_RE, "")
    .trim();
}

export function normalizeArabicCore(text: string | null | undefined): string {
  let normalized = normalizeArabicWord(text);
  while (normalized.length > 3 && /^[وفبكس]/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  while (normalized.length > 3 && normalized.startsWith("لل")) {
    normalized = normalized.slice(1);
  }
  if (normalized.length > 3 && normalized.startsWith("ال")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}
