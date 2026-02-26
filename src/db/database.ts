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

export interface StudyLogEntry {
  surah: number;
  ayah: number;
  interval: number;
  repetitions: number;
  ease_factor: number;
  next_review_date: string;
  last_review_date: string;
  updated_at?: string;
  synced?: number;
}

export interface StudyStats {
  cards_studied: number;
  total_reviews: number;
}

export interface JuzMapRow {
  juz: number;
  surah: number;
  ayah_start: number;
  ayah_end: number;
}

export interface WordRoot {
  surah: number;
  ayah: number;
  word_pos: number;
  word_text: string;
  root: string;
  lemma: string;
}

export interface RootSearchResult {
  surah: number;
  ayah: number;
  word_pos: number;
  word_text: string;
  root: string;
  lemma: string;
  text_uthmani: string;
  text_clean: string;
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

export function getAllAyahs(db: SQLiteDatabase): Ayah[] {
  return db.getAllSync<Ayah>(
    "SELECT * FROM quran_text ORDER BY surah, ayah"
  );
}

export function getAllSurahs(db: SQLiteDatabase): Surah[] {
  return db.getAllSync<Surah>(
    "SELECT * FROM surahs ORDER BY number"
  );
}

export function getAyah(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): Ayah | null {
  return db.getFirstSync<Ayah>(
    "SELECT * FROM quran_text WHERE surah = ? AND ayah = ?",
    [surah, ayah]
  );
}

// --- Study log (runtime table) ---

export function ensureStudyLogTable(db: SQLiteDatabase): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS study_log (
      surah            INTEGER NOT NULL,
      ayah             INTEGER NOT NULL,
      interval         REAL NOT NULL DEFAULT 0,
      repetitions      INTEGER NOT NULL DEFAULT 0,
      ease_factor      REAL NOT NULL DEFAULT 2.5,
      next_review_date TEXT NOT NULL DEFAULT '',
      last_review_date TEXT NOT NULL DEFAULT '',
      updated_at       TEXT NOT NULL DEFAULT '',
      synced           INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (surah, ayah)
    )
  `);

  // Migration: add columns for existing installs
  const cols = db.getAllSync<{ name: string }>(
    "PRAGMA table_info(study_log)"
  );
  const colNames = cols.map((c) => c.name);
  if (!colNames.includes("updated_at")) {
    db.execSync(
      "ALTER TABLE study_log ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"
    );
  }
  if (!colNames.includes("synced")) {
    db.execSync(
      "ALTER TABLE study_log ADD COLUMN synced INTEGER NOT NULL DEFAULT 0"
    );
  }
}

export function getStudyLogEntry(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): StudyLogEntry | null {
  return db.getFirstSync<StudyLogEntry>(
    "SELECT * FROM study_log WHERE surah = ? AND ayah = ?",
    [surah, ayah]
  );
}

export function upsertStudyLog(
  db: SQLiteDatabase,
  entry: StudyLogEntry
): void {
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO study_log (surah, ayah, interval, repetitions, ease_factor, next_review_date, last_review_date, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(surah, ayah) DO UPDATE SET
       interval = excluded.interval,
       repetitions = excluded.repetitions,
       ease_factor = excluded.ease_factor,
       next_review_date = excluded.next_review_date,
       last_review_date = excluded.last_review_date,
       updated_at = excluded.updated_at,
       synced = 0`,
    [
      entry.surah,
      entry.ayah,
      entry.interval,
      entry.repetitions,
      entry.ease_factor,
      entry.next_review_date,
      entry.last_review_date,
      now,
    ]
  );
}

export function getDueCards(
  db: SQLiteDatabase,
  today: string
): StudyLogEntry[] {
  return db.getAllSync<StudyLogEntry>(
    "SELECT * FROM study_log WHERE next_review_date <= ? ORDER BY next_review_date",
    [today]
  );
}

export function getDueCountForSurah(
  db: SQLiteDatabase,
  surah: number,
  today: string
): number {
  const row = db.getFirstSync<{ count: number }>(
    "SELECT COUNT(*) as count FROM study_log WHERE surah = ? AND next_review_date <= ?",
    [surah, today]
  );
  return row?.count ?? 0;
}

export function getDueCountForJuz(
  db: SQLiteDatabase,
  juz: number,
  today: string
): number {
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM study_log sl
     INNER JOIN juz_map jm ON sl.surah = jm.surah
       AND sl.ayah >= jm.ayah_start AND sl.ayah <= jm.ayah_end
     WHERE jm.juz = ? AND sl.next_review_date <= ?`,
    [juz, today]
  );
  return row?.count ?? 0;
}

// --- Juz queries ---

export function getAyahsByJuz(db: SQLiteDatabase, juz: number): Ayah[] {
  return db.getAllSync<Ayah>(
    `SELECT qt.* FROM quran_text qt
     INNER JOIN juz_map jm ON qt.surah = jm.surah
       AND qt.ayah >= jm.ayah_start AND qt.ayah <= jm.ayah_end
     WHERE jm.juz = ?
     ORDER BY qt.surah, qt.ayah`,
    [juz]
  );
}

export function getAyahsBySurah(db: SQLiteDatabase, surah: number): Ayah[] {
  return db.getAllSync<Ayah>(
    "SELECT * FROM quran_text WHERE surah = ? ORDER BY ayah",
    [surah]
  );
}

// --- Duplicate detection ---

export function getDuplicateTexts(
  db: SQLiteDatabase,
  textClean: string
): Ayah[] {
  return db.getAllSync<Ayah>(
    "SELECT * FROM quran_text WHERE text_clean = ? ORDER BY surah, ayah",
    [textClean]
  );
}

export function getPreviousAyah(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): Ayah | null {
  if (ayah > 1) {
    return getAyah(db, surah, ayah - 1);
  }
  // First ayah of surah — get last ayah of previous surah
  if (surah <= 1) return null;
  const prevSurah = getSurah(db, surah - 1);
  if (!prevSurah) return null;
  return getAyah(db, surah - 1, prevSurah.ayah_count);
}

export function getNextAyah(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): Ayah | null {
  const currentSurah = getSurah(db, surah);
  if (!currentSurah) return null;
  if (ayah < currentSurah.ayah_count) {
    return getAyah(db, surah, ayah + 1);
  }
  // Last ayah of surah — get first ayah of next surah
  if (surah >= 114) return null;
  return getAyah(db, surah + 1, 1);
}

// --- Search queries ---

export function searchAyahsByText(
  db: SQLiteDatabase,
  query: string
): Ayah[] {
  return db.getAllSync<Ayah>(
    "SELECT * FROM quran_text WHERE text_clean LIKE '%' || ? || '%' ORDER BY surah, ayah LIMIT 100",
    [query]
  );
}

export function searchByRoot(
  db: SQLiteDatabase,
  root: string
): RootSearchResult[] {
  return db.getAllSync<RootSearchResult>(
    `SELECT wr.surah, wr.ayah, wr.word_pos, wr.word_text, wr.root, wr.lemma,
            qt.text_uthmani, qt.text_clean
     FROM word_roots wr
     INNER JOIN quran_text qt ON wr.surah = qt.surah AND wr.ayah = qt.ayah
     WHERE wr.root = ?
     ORDER BY wr.surah, wr.ayah, wr.word_pos`,
    [root]
  );
}

export function getDistinctRoots(
  db: SQLiteDatabase,
  prefix: string
): string[] {
  const rows = db.getAllSync<{ root: string }>(
    "SELECT DISTINCT root FROM word_roots WHERE root LIKE ? || '%' ORDER BY root LIMIT 20",
    [prefix]
  );
  return rows.map((r) => r.root);
}

// --- Sync helpers ---

export function getUnsyncedEntries(db: SQLiteDatabase): StudyLogEntry[] {
  return db.getAllSync<StudyLogEntry>(
    "SELECT * FROM study_log WHERE synced = 0"
  );
}

export function markAsSynced(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): void {
  db.runSync(
    "UPDATE study_log SET synced = 1 WHERE surah = ? AND ayah = ?",
    [surah, ayah]
  );
}

export function upsertFromRemote(
  db: SQLiteDatabase,
  entry: StudyLogEntry
): void {
  // Only overwrite if remote updated_at is newer than local
  db.runSync(
    `INSERT INTO study_log (surah, ayah, interval, repetitions, ease_factor, next_review_date, last_review_date, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(surah, ayah) DO UPDATE SET
       interval = excluded.interval,
       repetitions = excluded.repetitions,
       ease_factor = excluded.ease_factor,
       next_review_date = excluded.next_review_date,
       last_review_date = excluded.last_review_date,
       updated_at = excluded.updated_at,
       synced = 1
     WHERE excluded.updated_at > study_log.updated_at OR study_log.synced = 1`,
    [
      entry.surah,
      entry.ayah,
      entry.interval,
      entry.repetitions,
      entry.ease_factor,
      entry.next_review_date,
      entry.last_review_date,
      entry.updated_at ?? new Date().toISOString(),
    ]
  );
}

export function getStudyStats(db: SQLiteDatabase): StudyStats {
  const row = db.getFirstSync<{ cards_studied: number; total_reviews: number }>(
    `SELECT
       COUNT(*) as cards_studied,
       COALESCE(SUM(repetitions), 0) as total_reviews
     FROM study_log
     WHERE repetitions > 0`
  );
  return {
    cards_studied: row?.cards_studied ?? 0,
    total_reviews: row?.total_reviews ?? 0,
  };
}
