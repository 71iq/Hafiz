import * as Clipboard from "expo-clipboard";
import type { Ayah } from "../db/database";

export function copyAyahToClipboard(ayah: Ayah, surahName: string) {
  const text = [
    `"${ayah.text_uthmani}"`,
    `[Surah ${surahName} : Ayah ${ayah.ayah}]`,
    `hafiz://open?surah=${ayah.surah}&ayah=${ayah.ayah}`,
  ].join("\n");

  Clipboard.setStringAsync(text);
}
