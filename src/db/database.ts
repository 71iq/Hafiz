import { type SQLiteDatabase } from "expo-sqlite";

export interface Ayah {
  surah: number;
  ayah: number;
  text_uthmani: string;
  text_clean: string;
}

export interface Surah {
  number: number;
  name_arabic: string;
  name_english: string;
  ayah_count: number;
  revelation_type: string;
}

export function getRandomAyah(db: SQLiteDatabase): Ayah | null {
  return db.getFirstSync<Ayah>(
    "SELECT * FROM quran_text ORDER BY RANDOM() LIMIT 1"
  );
}

export function getSurah(db: SQLiteDatabase, number: number): Surah | null {
  return db.getFirstSync<Surah>(
    "SELECT * FROM surahs WHERE number = ?",
    [number]
  );
}
