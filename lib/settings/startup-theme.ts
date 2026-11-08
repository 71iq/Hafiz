import { Platform } from "react-native";

export function getCachedAuthDarkMode({ useDocumentFallback = false }: { useDocumentFallback?: boolean } = {}):
  | boolean
  | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;

  const theme = window.localStorage.getItem("hafiz_theme");
  if (theme === "dark" || theme === "amoled") return true;
  if (theme === "beige" || theme === "white") return false;
  if (theme === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? null;
  }

  if (useDocumentFallback && typeof document !== "undefined") {
    const rootBackground = window.getComputedStyle(document.documentElement).backgroundColor;
    if (rootBackground === "rgb(10, 10, 10)" || rootBackground === "rgb(38, 38, 38)") {
      return true;
    }
  }

  return null;
}
