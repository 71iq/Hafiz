import { I18nManager, Platform } from "react-native";

const UI_LANGUAGE_CACHE_KEY = "hafiz_ui_language";

export function getStartupLanguage(): "en" | "ar" {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const cached = window.localStorage.getItem(UI_LANGUAGE_CACHE_KEY);
    if (cached === "en" || cached === "ar") return cached;
  }
  return I18nManager.isRTL ? "ar" : "en";
}
