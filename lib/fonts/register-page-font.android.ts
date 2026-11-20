import * as Font from "expo-font";
import { File, Paths } from "expo-file-system";
import { readerContent } from "@/modules/hafiz-reader-content";
import { selectQpcV4Palette } from "./qpc-v4-palette";
import type { QuranPageFontStyle } from "./page-style";

// Android uses palette zero. Select the original font's plain or Tajweed palette for the theme.
const palette = { v4: 3, "v4-dark": 4, "v4-tajweed": 0, "v4-tajweed-dark": 1 } as const;

export async function registerPageFont(name: string, style: QuranPageFontStyle, page: number) {
  if (style === "qcf2") {
    await Font.loadAsync(name, readerContent.classicPageUri(page));
    return;
  }
  const bytes = await readerContent.v4PageBytes(page);
  if (palette[style] !== 0) selectQpcV4Palette(bytes, palette[style]);
  const file = new File(Paths.cache, name + ".ttf");
  file.create({ overwrite: true });
  try {
    file.write(bytes);
    await Font.loadAsync(name, file.uri);
  } finally {
    // Typeface retains the mapped file after registration.
    try { file.delete(); } catch { /* Cache cleanup can be retried by Android. */ }
  }
}
