const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Convert a number to Eastern Arabic-Indic numerals (٠١٢…٩) */
export function toArabicNumber(num: number): string {
  return String(num).replace(/\d/g, (d) => ARABIC_DIGITS[parseInt(d, 10)]);
}

/**
 * Strip Uthmanic annotation marks that render as ugly glyphs in web browsers.
 * U+06DF (Small High Rounded Zero) appears as a large outlined circle.
 */
const UTHMANIC_STRIP_RE = /\u06DF/g;
export function cleanArabicText(text: string): string {
  return text.replace(UTHMANIC_STRIP_RE, "");
}
