import type { QuranFontStyle } from "@/lib/settings/context";

export type QuranBaseFont = "qcf2" | "v4";

export function quranBaseFont(style: QuranFontStyle): QuranBaseFont {
  return style === "qcf2" ? "qcf2" : "v4";
}

export function isTajweedStyle(style: QuranFontStyle): boolean {
  return style === "v4-tajweed";
}

export function styleForBaseFont(base: QuranBaseFont, current: QuranFontStyle): QuranFontStyle {
  if (base === "qcf2") return "qcf2";
  return isTajweedStyle(current) ? "v4-tajweed" : "v4";
}

export function styleForTajweed(enabled: boolean, current: QuranFontStyle): QuranFontStyle {
  if (enabled) return "v4-tajweed";
  return current === "qcf2" ? "qcf2" : "v4";
}
