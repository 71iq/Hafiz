import { I18nManager, Platform } from "react-native";
import { getResolvedUiBootstrap } from "@/lib/settings/ui-bootstrap";

const UI_LANGUAGE_CACHE_KEY = "hafiz_ui_language";

function primarySubtag(locale: string | null | undefined): string | null {
  if (!locale) return null;
  return locale.toLowerCase().split(/[-_]/)[0] || null;
}

export function getDeviceLanguage(): "en" | "ar" {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return "en";
    return primarySubtag(window.navigator?.language) === "ar" ? "ar" : "en";
  }
  let locale: string | null = null;
  try {
    locale = Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    locale = null;
  }
  if (locale) return primarySubtag(locale) === "ar" ? "ar" : "en";
  return I18nManager.isRTL ? "ar" : "en";
}

export function getStartupLanguage(): "en" | "ar" {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const cached = window.localStorage.getItem(UI_LANGUAGE_CACHE_KEY);
    if (cached === "en" || cached === "ar") return cached;
  }
  if (Platform.OS !== "web") {
    const mirror = getResolvedUiBootstrap();
    if (mirror) return mirror.language;
  }
  return getDeviceLanguage();
}
