import { Platform } from "react-native";

export type QuranFontStyle = "qcf2" | "v4" | "v4-tajweed";
export type QuranPageFontStyle = QuranFontStyle | "v4-dark" | "v4-tajweed-dark";

export function resolvePageFontStyle(style: QuranFontStyle, isDark: boolean): QuranPageFontStyle {
  if (!isDark || style === "qcf2") return style;
  if (Platform.OS === "android") return style === "v4" ? "v4-dark" : "v4-tajweed-dark";
  return Platform.OS === "ios" ? "qcf2" : style;
}
