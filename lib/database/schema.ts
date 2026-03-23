import type { SQLiteDatabase } from "expo-sqlite";

export async function createSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    -- ============================================================
    -- PRE-POPULATED TABLES (read-only static data)
    -- ============================================================

    -- Surah metadata (114 rows)
    CREATE TABLE IF NOT EXISTS surahs (
      number INTEGER PRIMARY KEY,
      name_arabic TEXT NOT NULL,
      name_english TEXT NOT NULL,
      ayah_count INTEGER NOT NULL,
      revelation_type TEXT NOT NULL
    );

    -- Full Quran text (6,236 rows)
    CREATE TABLE IF NOT EXISTS quran_text (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      text_uthmani TEXT NOT NULL,
      text_clean TEXT NOT NULL,
      text_qcf2 TEXT NOT NULL DEFAULT '',
      v2_page INTEGER NOT NULL DEFAULT 0,
      text_search TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (surah, ayah)
    );

    -- Juz mapping (135 rows)
    CREATE TABLE IF NOT EXISTS juz_map (
      juz INTEGER NOT NULL,
      surah INTEGER NOT NULL,
      ayah_start INTEGER NOT NULL,
      ayah_end INTEGER NOT NULL
    );

    -- Hizb mapping (60 rows)
    CREATE TABLE IF NOT EXISTS hizb_map (
      hizb INTEGER NOT NULL,
      surah_start INTEGER NOT NULL,
      ayah_start INTEGER NOT NULL,
      surah_end INTEGER NOT NULL,
      ayah_end INTEGER NOT NULL
    );

    -- Word roots (50,268 rows)
    CREATE TABLE IF NOT EXISTS word_roots (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      word_pos INTEGER NOT NULL,
      word_text TEXT NOT NULL,
      root TEXT,
      lemma TEXT
    );

    -- Page-to-ayah mapping for 604-page Mushaf
    CREATE TABLE IF NOT EXISTS page_map (
      page INTEGER PRIMARY KEY,
      surah_start INTEGER NOT NULL,
      ayah_start INTEGER NOT NULL,
      surah_end INTEGER NOT NULL,
      ayah_end INTEGER NOT NULL
    );

    -- Tafseer (multi-source: muyassar, zilal)
    CREATE TABLE IF NOT EXISTS tafseer (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'muyassar',
      text TEXT NOT NULL,
      PRIMARY KEY (surah, ayah, source)
    );

    -- Sahih International English translation (6,236 rows)
    CREATE TABLE IF NOT EXISTS translations (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      text_en TEXT NOT NULL,
      PRIMARY KEY (surah, ayah)
    );

    -- Word-by-word English translations
    CREATE TABLE IF NOT EXISTS word_translations (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      word_pos INTEGER NOT NULL,
      word_arabic TEXT,
      translation_en TEXT NOT NULL,
      transliteration TEXT,
      PRIMARY KEY (surah, ayah, word_pos)
    );

    -- MASAQ grammatical analysis (إعراب)
    CREATE TABLE IF NOT EXISTS word_irab (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      word_pos INTEGER NOT NULL,
      arabic_word TEXT,
      morphological_tag TEXT,
      syntactic_function TEXT,
      root TEXT,
      lemma TEXT,
      pattern TEXT,
      PRIMARY KEY (surah, ayah, word_pos)
    );

    -- Morphology data (تصريف)
    CREATE TABLE IF NOT EXISTS word_morphology (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      word_pos INTEGER NOT NULL,
      form TEXT,
      pos_tag TEXT,
      root TEXT,
      lemma TEXT,
      person TEXT,
      gender TEXT,
      number TEXT,
      case_field TEXT,
      mood TEXT,
      voice TEXT,
      verb_form TEXT,
      PRIMARY KEY (surah, ayah, word_pos)
    );

    -- Page line layout (9,046 rows — line-by-line Mushaf layout)
    CREATE TABLE IF NOT EXISTS page_lines (
      page_number INTEGER NOT NULL,
      line_number INTEGER NOT NULL,
      line_type TEXT NOT NULL,
      is_centered INTEGER NOT NULL DEFAULT 0,
      first_word_id INTEGER,
      last_word_id INTEGER,
      surah_number INTEGER,
      PRIMARY KEY (page_number, line_number)
    );

    -- Tajweed rules
    CREATE TABLE IF NOT EXISTS tajweed_rules (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      rule TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL
    );

    -- ============================================================
    -- USER DATA TABLES (read/write, synced)
    -- ============================================================

    -- FSRS study cards
    CREATE TABLE IF NOT EXISTS study_cards (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      due TEXT NOT NULL,
      stability REAL NOT NULL,
      difficulty REAL NOT NULL,
      elapsed_days INTEGER NOT NULL,
      scheduled_days INTEGER NOT NULL,
      learning_steps INTEGER NOT NULL,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      state INTEGER NOT NULL DEFAULT 0,
      last_review TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Study review log
    CREATE TABLE IF NOT EXISTS study_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      state INTEGER NOT NULL,
      due TEXT NOT NULL,
      stability REAL NOT NULL,
      difficulty REAL NOT NULL,
      elapsed_days INTEGER NOT NULL,
      scheduled_days INTEGER NOT NULL,
      reviewed_at TEXT NOT NULL,
      sync_status TEXT DEFAULT 'pending'
    );

    -- User bookmarks
    CREATE TABLE IF NOT EXISTS bookmarks (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (surah, ayah)
    );

    -- User highlights
    CREATE TABLE IF NOT EXISTS highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      word_start INTEGER,
      word_end INTEGER,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- User settings (key-value store)
    CREATE TABLE IF NOT EXISTS user_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Active non-English translation (6,236 rows max, swapped on language change)
    CREATE TABLE IF NOT EXISTS translation_active (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (surah, ayah)
    );

    -- Search history (last 10 searches)
    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'text',
      created_at TEXT NOT NULL
    );

    -- Sync queue for offline-first sync
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      row_id TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      synced_at TEXT
    );

    -- ============================================================
    -- INDEXES for performance
    -- ============================================================

    CREATE INDEX IF NOT EXISTS idx_quran_text_surah ON quran_text(surah);
    CREATE INDEX IF NOT EXISTS idx_word_roots_root ON word_roots(root);
    CREATE INDEX IF NOT EXISTS idx_word_roots_surah_ayah ON word_roots(surah, ayah);
    CREATE INDEX IF NOT EXISTS idx_tajweed_surah_ayah ON tajweed_rules(surah, ayah);
    CREATE INDEX IF NOT EXISTS idx_juz_map_juz ON juz_map(juz);
    CREATE INDEX IF NOT EXISTS idx_study_cards_deck ON study_cards(deck_id);
    CREATE INDEX IF NOT EXISTS idx_study_cards_due ON study_cards(due);
    CREATE INDEX IF NOT EXISTS idx_study_log_card ON study_log(card_id);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(table_name);
  `);
}

/** Create text_search index — must run AFTER the text_search column migration */
export async function createTextSearchIndex(db: SQLiteDatabase): Promise<void> {
  try {
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_quran_text_search ON quran_text(text_search)");
  } catch (_) {
    // Column may not exist yet on very old databases — the migration will handle it
  }
}
