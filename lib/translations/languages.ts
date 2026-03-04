export type TranslationLanguage = {
  code: string;
  nameEnglish: string;
  nameNative: string;
  direction: "ltr" | "rtl";
};

export const DEFAULT_LANGUAGE = "en";

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: "en", nameEnglish: "English", nameNative: "English", direction: "ltr" },
  { code: "id", nameEnglish: "Indonesian", nameNative: "Bahasa Indonesia", direction: "ltr" },
  { code: "bn", nameEnglish: "Bengali", nameNative: "বাংলা", direction: "ltr" },
  { code: "ur", nameEnglish: "Urdu", nameNative: "اردو", direction: "rtl" },
  { code: "fa", nameEnglish: "Persian", nameNative: "فارسی", direction: "rtl" },
  { code: "hi", nameEnglish: "Hindi", nameNative: "हिन्दी", direction: "ltr" },
  { code: "tr", nameEnglish: "Turkish", nameNative: "Türkçe", direction: "ltr" },
  { code: "ha", nameEnglish: "Hausa", nameNative: "Hausa", direction: "ltr" },
  { code: "fr", nameEnglish: "French", nameNative: "Français", direction: "ltr" },
  { code: "ps", nameEnglish: "Pashto", nameNative: "پښتو", direction: "rtl" },
  { code: "sd", nameEnglish: "Sindhi", nameNative: "سنڌي", direction: "rtl" },
  { code: "ru", nameEnglish: "Russian", nameNative: "Русский", direction: "ltr" },
  { code: "ku", nameEnglish: "Kurdish", nameNative: "کوردی", direction: "rtl" },
  { code: "uz", nameEnglish: "Uzbek", nameNative: "Oʻzbekcha", direction: "ltr" },
  { code: "sw", nameEnglish: "Swahili", nameNative: "Kiswahili", direction: "ltr" },
  { code: "om", nameEnglish: "Oromo", nameNative: "Afaan Oromoo", direction: "ltr" },
  { code: "am", nameEnglish: "Amharic", nameNative: "አማርኛ", direction: "ltr" },
  { code: "so", nameEnglish: "Somali", nameNative: "Soomaali", direction: "ltr" },
  { code: "az", nameEnglish: "Azerbaijani", nameNative: "Azərbaycan", direction: "ltr" },
  { code: "kk", nameEnglish: "Kazakh", nameNative: "Қазақша", direction: "ltr" },
  { code: "ber", nameEnglish: "Tamazight", nameNative: "ⵜⴰⵎⴰⵣⵉⵖⵜ", direction: "ltr" },
];

export function getLanguageByCode(code: string): TranslationLanguage | undefined {
  return TRANSLATION_LANGUAGES.find((l) => l.code === code);
}
