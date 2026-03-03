const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Convert a number to Eastern Arabic-Indic numerals (٠١٢…٩) */
export function toArabicNumber(num: number): string {
  return String(num).replace(/\d/g, (d) => ARABIC_DIGITS[parseInt(d, 10)]);
}

