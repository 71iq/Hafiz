export type TranslationLanguage = {
  code: string;
  nameEnglish: string;
  nameNative: string;
  /** The language's name in Arabic, for the Arabic interface. */
  nameArabic: string;
  /** Short translator or source name shown beside the language, e.g. "English - Bridges". */
  sourceLabel?: string;
  direction: "ltr" | "rtl";
  /** Whose translation this is, shown under the text when the bundled source names it. */
  attribution?: string;
};

export const DEFAULT_LANGUAGE = "en";
export const DEFAULT_TRANSLATION_LANGUAGE = "en-bridges";

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  {
    code: "en",
    nameEnglish: "English",
    nameNative: "English",
    nameArabic: "الإنجليزية",
    sourceLabel: "Saheeh International",
    direction: "ltr",
    attribution: "Saheeh International",
  },
  {
    code: "en-bridges",
    nameEnglish: "English (Bridges)",
    nameNative: "English (Bridges)",
    nameArabic: "الإنجليزية",
    sourceLabel: "Bridges",
    direction: "ltr",
    attribution: "Bridges translation, Fadel Soliman",
  },
  {
    code: "id",
    nameEnglish: "Indonesian",
    nameNative: "Bahasa Indonesia",
    nameArabic: "الإندونيسية",
    direction: "ltr",
  },
  { code: "bn", nameEnglish: "Bengali", nameNative: "বাংলা", nameArabic: "البنغالية", direction: "ltr" },
  { code: "ur", nameEnglish: "Urdu", nameNative: "اردو", nameArabic: "الأردية", direction: "rtl" },
  { code: "fa", nameEnglish: "Persian", nameNative: "فارسی", nameArabic: "الفارسية", direction: "rtl" },
  { code: "hi", nameEnglish: "Hindi", nameNative: "हिन्दी", nameArabic: "الهندية", direction: "ltr" },
  { code: "tr", nameEnglish: "Turkish", nameNative: "Türkçe", nameArabic: "التركية", direction: "ltr" },
  { code: "ha", nameEnglish: "Hausa", nameNative: "Hausa", nameArabic: "الهوسا", direction: "ltr" },
  { code: "fr", nameEnglish: "French", nameNative: "Français", nameArabic: "الفرنسية", direction: "ltr" },
  { code: "ps", nameEnglish: "Pashto", nameNative: "پښتو", nameArabic: "البشتو", direction: "rtl" },
  { code: "sd", nameEnglish: "Sindhi", nameNative: "سنڌي", nameArabic: "السندية", direction: "rtl" },
  { code: "ru", nameEnglish: "Russian", nameNative: "Русский", nameArabic: "الروسية", direction: "ltr" },
  { code: "ku", nameEnglish: "Kurdish", nameNative: "کوردی", nameArabic: "الكردية", direction: "rtl" },
  { code: "uz", nameEnglish: "Uzbek", nameNative: "Oʻzbekcha", nameArabic: "الأوزبكية", direction: "ltr" },
  { code: "sw", nameEnglish: "Swahili", nameNative: "Kiswahili", nameArabic: "السواحيلية", direction: "ltr" },
  { code: "om", nameEnglish: "Oromo", nameNative: "Afaan Oromoo", nameArabic: "الأورومية", direction: "ltr" },
  { code: "am", nameEnglish: "Amharic", nameNative: "አማርኛ", nameArabic: "الأمهرية", direction: "ltr" },
  { code: "so", nameEnglish: "Somali", nameNative: "Soomaali", nameArabic: "الصومالية", direction: "ltr" },
  { code: "az", nameEnglish: "Azerbaijani", nameNative: "Azərbaycan", nameArabic: "الأذربيجانية", direction: "ltr" },
  { code: "kk", nameEnglish: "Kazakh", nameNative: "Қазақша", nameArabic: "الكازاخية", direction: "ltr" },
  { code: "ber", nameEnglish: "Tamazight", nameNative: "ⵜⴰⵎⴰⵣⵉⵖⵜ", nameArabic: "الأمازيغية", direction: "ltr" },
];

export function getLanguageByCode(code: string): TranslationLanguage | undefined {
  return TRANSLATION_LANGUAGES.find((l) => l.code === code);
}

/** "English - Bridges" / "الإنجليزية - Bridges": the language in the interface language, then its source. */
export function translationDisplayName(language: TranslationLanguage, uiLanguage: "en" | "ar"): string {
  const name = uiLanguage === "ar" ? language.nameArabic : language.nameEnglish.replace(/\s*\([^)]*\)$/, "");
  return language.sourceLabel ? `${name} - ${language.sourceLabel}` : name;
}

/** Matches the English, native or Arabic language name, ignoring case. */
export function matchesTranslationQuery(language: TranslationLanguage, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [language.nameEnglish, language.nameNative, language.nameArabic].some((name) =>
    name.toLocaleLowerCase().includes(needle),
  );
}
