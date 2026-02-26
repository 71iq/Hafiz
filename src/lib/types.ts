import type { Ayah, Surah } from "../db/database";

export interface SurahHeaderItem {
  type: "surah-header";
  surah: Surah;
}

export interface AyahItem {
  type: "ayah";
  ayah: Ayah;
  surahName: string;
}

export type ListItem = SurahHeaderItem | AyahItem;
