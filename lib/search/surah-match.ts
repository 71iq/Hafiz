import { normalizeArabicCore, normalizeArabicWord } from "../arabic";

/**
 * Common Latin transliterations, indexed by surah number - 1. The local database stores the
 * English meaning ("The Cave") in surahs.name_english, but people usually type the transliterated
 * name ("Kahf", "Yaseen"), so surah filters match against both.
 */
const SURAH_TRANSLITERATIONS: readonly string[] = [
  "Al-Fatiha", "Al-Baqara", "Aal-Imran", "An-Nisaa", "Al-Maida", "Al-Anam", "Al-Araf", "Al-Anfal",
  "At-Tawba", "Yunus", "Hud", "Yusuf", "Ar-Rad", "Ibrahim", "Al-Hijr", "An-Nahl", "Al-Israa",
  "Al-Kahf", "Maryam", "Ta-Ha", "Al-Anbiya", "Al-Hajj", "Al-Muminun", "An-Nur", "Al-Furqan",
  "Ash-Shuara", "An-Naml", "Al-Qasas", "Al-Ankabut", "Ar-Rum", "Luqman", "As-Sajda", "Al-Ahzab",
  "Saba", "Fatir", "Yasin", "As-Saffat", "Sad", "Az-Zumar", "Ghafir", "Fussilat", "Ash-Shura",
  "Az-Zukhruf", "Ad-Dukhan", "Al-Jathiya", "Al-Ahqaf", "Muhammad", "Al-Fath", "Al-Hujurat", "Qaf",
  "Adh-Dhariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman", "Al-Waqia", "Al-Hadid",
  "Al-Mujadila", "Al-Hashr", "Al-Mumtahana", "As-Saff", "Al-Jumua", "Al-Munafiqun", "At-Taghabun",
  "At-Talaq", "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haqqa", "Al-Maarij", "Nuh", "Al-Jinn",
  "Al-Muzzammil", "Al-Muddaththir", "Al-Qiyama", "Al-Insan", "Al-Mursalat", "An-Naba", "An-Naziat",
  "Abasa", "At-Takwir", "Al-Infitar", "Al-Mutaffifin", "Al-Inshiqaq", "Al-Buruj", "At-Tariq",
  "Al-Ala", "Al-Ghashiya", "Al-Fajr", "Al-Balad", "Ash-Shams", "Al-Layl", "Ad-Duha", "Ash-Sharh",
  "At-Tin", "Al-Alaq", "Al-Qadr", "Al-Bayyina", "Az-Zalzala", "Al-Adiyat", "Al-Qaria",
  "At-Takathur", "Al-Asr", "Al-Humaza", "Al-Fil", "Quraysh", "Al-Maun", "Al-Kawthar",
  "Al-Kafirun", "An-Nasr", "Al-Masad", "Al-Ikhlas", "Al-Falaq", "An-Nas",
];

export function surahTransliteration(surahNumber: number): string | null {
  return SURAH_TRANSLITERATIONS[surahNumber - 1] ?? null;
}

/** Folds spelling variants so "Yaseen", "Ya-Sin" and "yasin" compare equal. */
function foldLatin(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(ee|ii)/g, "i")
    .replace(/(oo|uu|ou)/g, "u")
    .replace(/aa/g, "a")
    .replace(/aw/g, "au")
    .replace(/dh/g, "z")
    .replace(/([a-z])\1/g, "$1")
    .replace(/(.{4,})h$/, "$1");
}

/** Drops a leading Arabic article ("Al-", "An-", "Ash-"...) from a transliteration. */
function withoutArticle(name: string): string {
  return name.replace(/^(aal|a[lnrstdz]|ash|adh)[-\s]/i, "");
}

export type SurahSearchFields = {
  number: number;
  name_arabic: string;
  name_english: string;
};

/** Shared surah filter: number prefix, Arabic name, English meaning or transliteration. */
export function matchesSurahQuery(surah: SurahSearchFields, rawQuery: string): boolean {
  const query = rawQuery.trim();
  if (!query) return true;

  const digits = query.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (/^\d+$/.test(digits)) return String(surah.number).startsWith(digits);

  const arabicQuery = normalizeArabicWord(query);
  if (arabicQuery) {
    const name = normalizeArabicWord(surah.name_arabic);
    const core = normalizeArabicCore(query);
    return name.includes(arabicQuery) || (core.length > 0 && name.includes(core));
  }

  const latinQuery = foldLatin(withoutArticle(query));
  if (!latinQuery) return false;
  const transliteration = surahTransliteration(surah.number) ?? "";
  const candidates = [surah.name_english, transliteration, withoutArticle(transliteration)];
  return candidates.some((candidate) => candidate && foldLatin(candidate).includes(latinQuery));
}
