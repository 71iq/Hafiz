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

export interface SurahTextItem {
  type: "surah-text";
  surah: Surah;
  ayahs: Ayah[];
}

export type ListItem = SurahHeaderItem | SurahTextItem;
