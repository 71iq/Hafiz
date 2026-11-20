import type { UIStrings } from "@/lib/i18n/strings";
import type { QuranFontStyle } from "@/lib/fonts/page-style";

/**
 * The saved Quran font style combines two user choices: the Classic (QCF2) or Modern (V4) page font,
 * and the separate Tajweed colours switch, which needs the Modern font. Both settings surfaces use
 * these helpers so they stay one contract.
 */
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

export type ClassicDownloadState = "available" | "ready" | "failed" | number;

export function classicFontCopy(s: UIStrings, state: ClassicDownloadState, darkFallback: boolean) {
  if (typeof state === "number") {
    return { label: s.quranFontQcf2, hint: s.classicDownloadProgress.replace("{pages}", String(state)) };
  }
  if (state === "failed") return { label: s.classicDownloadRetry, hint: s.classicDownloadFailed };
  if (state === "available") return { label: s.classicDownloadAction, hint: s.classicDownloadHint };
  return { label: s.quranFontQcf2, hint: darkFallback ? `${s.quranFontChoiceHint} ${s.quranFontDarkFallback}` : s.quranFontChoiceHint };
}
