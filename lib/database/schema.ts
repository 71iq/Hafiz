import type { DatabaseExecutor } from "@/lib/database/types";
import { deviceTimeZone, localDateOf } from "@/lib/habit/dates";

export async function createSchema(db: DatabaseExecutor): Promise<void> {
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

    -- Narrative Surah introductions (offline static data)
    CREATE TABLE IF NOT EXISTS surah_info (
      surah INTEGER NOT NULL,
      language TEXT NOT NULL CHECK (language IN ('en', 'ar')),
      summary TEXT NOT NULL,
      sections_json TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT,
      PRIMARY KEY (surah, language)
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

    -- Tafsir (multi-source)
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

    -- Arabic word meanings (quran-words.com) — separate from English word_translations
    CREATE TABLE IF NOT EXISTS word_meanings_ar (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      word_pos INTEGER NOT NULL,
      word TEXT,
      meaning TEXT,
      PRIMARY KEY (surah, ayah, word_pos)
    );

    -- Da'as i'rab per word — separate from MASAQ word_irab (keep that intact)
    CREATE TABLE IF NOT EXISTS word_irab_daas (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      word_pos INTEGER NOT NULL,
      word TEXT,
      irab TEXT,
      PRIMARY KEY (surah, ayah, word_pos)
    );

    -- Arabic descriptions for tajweed rule keys
    CREATE TABLE IF NOT EXISTS tajweed_rules_ar (
      rule_key TEXT PRIMARY KEY,
      name_ar TEXT,
      short_ar TEXT,
      description_ar TEXT
    );

    -- English descriptions for tajweed rule keys
    CREATE TABLE IF NOT EXISTS tajweed_rules_en (
      rule_key TEXT PRIMARY KEY,
      name TEXT,
      name_ar TEXT,
      short TEXT,
      description TEXT
    );

    -- Qira'at encyclopedia per ayah
    CREATE TABLE IF NOT EXISTS qiraat_encyclopedia (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      text TEXT,
      ayah_group TEXT,
      PRIMARY KEY (surah, ayah)
    );

    -- Reasons of revelation per ayah
    CREATE TABLE IF NOT EXISTS asbab_al_nuzul (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      occasions_json TEXT NOT NULL,
      ayah_group TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'asbab-al-nuzul-dataset',
      PRIMARY KEY (surah, ayah)
    );

    -- NourQuran mutashabihat and similar ayah tails
    CREATE TABLE IF NOT EXISTS mutashabihat_groups (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('similar', 'tail')),
      cue TEXT NOT NULL,
      source TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mutashabihat_refs (
      group_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      surah_name_ar TEXT,
      tail_5 TEXT,
      pre_text TEXT,
      similar_text TEXT,
      post_text TEXT,
      PRIMARY KEY (group_id, sort_order)
    );

    -- Reflection Journey curated levels (offline-first bundled content)
    CREATE TABLE IF NOT EXISTS reflection_journey_levels (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      order_index INTEGER UNIQUE NOT NULL,
      title_en TEXT NOT NULL,
      title_ar TEXT NOT NULL,
      summary_en TEXT,
      summary_ar TEXT,
      response_prompt_en TEXT NOT NULL,
      response_prompt_ar TEXT NOT NULL,
      estimated_minutes INTEGER,
      content_json TEXT NOT NULL
    );

    -- Quran Foundation ayah audio metadata cache (online enrichment, not synced)
    CREATE TABLE IF NOT EXISTS qf_ayah_audio_cache (
      recitation_id INTEGER NOT NULL,
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      verse_key TEXT NOT NULL,
      url TEXT NOT NULL,
      duration REAL,
      format TEXT,
      segments_json TEXT,
      reciter_name TEXT,
      recitation_style TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (recitation_id, surah, ayah)
    );

    -- Quran Foundation hadith-by-ayah cache (online enrichment, not synced)
    CREATE TABLE IF NOT EXISTS qf_ayah_hadith_cache (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      language TEXT NOT NULL,
      page INTEGER NOT NULL,
      limit_count INTEGER NOT NULL,
      direction TEXT NOT NULL,
      has_more INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (surah, ayah, language, page, limit_count)
    );

    -- Vocabulary flashcards (saved word meanings)
    CREATE TABLE IF NOT EXISTS vocab_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      word_pos INTEGER NOT NULL,
      word TEXT,
      meaning_ar TEXT,
      meaning_en TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      due TEXT,
      stability REAL DEFAULT 0,
      difficulty REAL DEFAULT 0,
      elapsed_days INTEGER DEFAULT 0,
      scheduled_days INTEGER DEFAULT 0,
      reps INTEGER DEFAULT 0,
      lapses INTEGER DEFAULT 0,
      state INTEGER DEFAULT 0,
      last_review TEXT,
      UNIQUE (surah, ayah, word_pos)
    );

    -- User-supplied word meanings for bundled gaps
    CREATE TABLE IF NOT EXISTS user_word_meanings (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      word_pos INTEGER NOT NULL,
      word TEXT,
      meaning TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (surah, ayah, word_pos)
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
      suspended_at TEXT,
      buried_until TEXT,
      marked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      tier TEXT,
      tier_changed_at TEXT
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
      sync_status TEXT DEFAULT 'pending',
      session_id TEXT,
      duration_ms INTEGER,
      support_level INTEGER,
      proposed_rating INTEGER,
      grader TEXT,
      local_date TEXT,
      tz TEXT,
      error_count INTEGER NOT NULL DEFAULT 0,
      makeup_for TEXT
    );

    -- Review sessions (synced owner-only). One row per session, updated as cards are graded.
    CREATE TABLE IF NOT EXISTS review_sessions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      deck_id TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      local_date TEXT NOT NULL,
      tz TEXT NOT NULL,
      cards_reviewed INTEGER NOT NULL DEFAULT 0,
      pages_reviewed INTEGER NOT NULL DEFAULT 0,
      new_lines INTEGER NOT NULL DEFAULT 0,
      clean_pages INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      minimum_met INTEGER NOT NULL DEFAULT 0,
      full_met INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'app',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    -- Recitation errors (synced owner-only). Open rows feed the mistake inbox until resolved.
    CREATE TABLE IF NOT EXISTS recitation_errors (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      session_id TEXT,
      surah INTEGER NOT NULL,
      ayah INTEGER,
      word INTEGER,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      corrected TEXT NOT NULL,
      sibling_ref TEXT,
      local_date TEXT NOT NULL,
      clean_count INTEGER NOT NULL DEFAULT 0,
      last_clean_date TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    -- Wird habit days (synced owner-only). The earned status only rises; the excuse is last write wins.
    CREATE TABLE IF NOT EXISTS habit_days (
      local_date TEXT PRIMARY KEY,
      status TEXT CHECK (status IS NULL OR status IN ('done', 'made_up', 'earned_back', 'excused', 'paused', 'grace')),
      earned_status TEXT CHECK (earned_status IS NULL OR earned_status IN ('done', 'made_up', 'earned_back', 'paused', 'grace')),
      reason TEXT CHECK (reason IS NULL OR reason IN ('illness', 'travel', 'menstruation', 'other')),
      excuse_updated_at TEXT,
      minimum_met INTEGER NOT NULL DEFAULT 0,
      full_met INTEGER NOT NULL DEFAULT 0,
      manzil_cycle_completed INTEGER NOT NULL DEFAULT 0,
      source_session_id TEXT,
      credited_through TEXT,
      tz TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Scheduled reminders on this device. Never synced or restored.
    CREATE TABLE IF NOT EXISTS notification_log (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      template_id TEXT NOT NULL,
      local_date TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      os_id TEXT,
      delivered_at TEXT,
      opened_at TEXT,
      converted INTEGER NOT NULL DEFAULT 0,
      cancelled_at TEXT
    );

    -- User bookmarks
    CREATE TABLE IF NOT EXISTS bookmarks (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      qf_bookmark_id TEXT,
      qf_synced_at TEXT,
      qf_sync_error TEXT,
      qf_is_in_default_collection INTEGER NOT NULL DEFAULT 0,
      qf_collections_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (surah, ayah)
    );

    -- User highlights
    CREATE TABLE IF NOT EXISTS highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT,
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      word_start INTEGER,
      word_end INTEGER,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );

    -- User settings (key-value store)
    CREATE TABLE IF NOT EXISTS user_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
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

    -- Private ayah notes (synced owner-only)
    CREATE TABLE IF NOT EXISTS private_notes (
      id TEXT PRIMARY KEY,
      surah INTEGER NOT NULL,
      ayah_start INTEGER NOT NULL,
      ayah_end INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      qf_note_id TEXT,
      qf_synced_at TEXT,
      qf_sync_error TEXT,
      qf_ranges_json TEXT
    );

    -- Reflection Journey owner-only progress and responses
    CREATE TABLE IF NOT EXISTS reflection_journey_entries (
      level_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('draft', 'completed')),
      response_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    -- Achievement unlocks (public badge row syncs without private payload)
    CREATE TABLE IF NOT EXISTS achievement_unlocks (
      achievement_id TEXT PRIMARY KEY,
      unlocked_at TEXT NOT NULL,
      seen_at TEXT,
      local_payload TEXT NOT NULL DEFAULT '{}',
      public_payload TEXT NOT NULL DEFAULT '{}',
      sync_status TEXT DEFAULT 'pending'
    );

    -- Achievement progress cache
    CREATE TABLE IF NOT EXISTS achievement_progress (
      achievement_id TEXT PRIMARY KEY,
      current_value INTEGER NOT NULL DEFAULT 0,
      target_value INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}'
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

    -- Quran Foundation user API sync queue (separate from Supabase sync)
    CREATE TABLE IF NOT EXISTS qf_sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('bookmark', 'private_note')),
      operation TEXT NOT NULL CHECK (operation IN ('UPSERT', 'DELETE')),
      local_id TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at TEXT
    );

    -- ============================================================
    -- INDEXES for performance
    -- ============================================================

    CREATE INDEX IF NOT EXISTS idx_quran_text_surah ON quran_text(surah);
    CREATE INDEX IF NOT EXISTS idx_word_roots_root ON word_roots(root);
    CREATE INDEX IF NOT EXISTS idx_word_roots_surah_ayah ON word_roots(surah, ayah);
    CREATE INDEX IF NOT EXISTS idx_word_roots_surah_ayah_pos ON word_roots(surah, ayah, word_pos);
    CREATE INDEX IF NOT EXISTS idx_tajweed_surah_ayah ON tajweed_rules(surah, ayah);
    CREATE INDEX IF NOT EXISTS idx_juz_map_juz ON juz_map(juz);
    CREATE INDEX IF NOT EXISTS idx_study_cards_deck ON study_cards(deck_id);
    CREATE INDEX IF NOT EXISTS idx_study_cards_due ON study_cards(due);
    CREATE INDEX IF NOT EXISTS idx_study_log_card ON study_log(card_id);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(table_name);
    CREATE INDEX IF NOT EXISTS idx_qf_sync_queue_status ON qf_sync_queue(status, id);
    CREATE INDEX IF NOT EXISTS idx_qf_sync_queue_local ON qf_sync_queue(entity_type, local_id);
    CREATE INDEX IF NOT EXISTS idx_highlights_surah_ayah ON highlights(surah, ayah);
    CREATE INDEX IF NOT EXISTS idx_study_log_reviewed ON study_log(reviewed_at);
    CREATE INDEX IF NOT EXISTS idx_word_roots_lemma ON word_roots(lemma);
    CREATE INDEX IF NOT EXISTS idx_word_meanings_ar_sa ON word_meanings_ar(surah, ayah);
    CREATE INDEX IF NOT EXISTS idx_word_irab_daas_sa ON word_irab_daas(surah, ayah);
    CREATE INDEX IF NOT EXISTS idx_asbab_al_nuzul_sa ON asbab_al_nuzul(surah, ayah);
    CREATE INDEX IF NOT EXISTS idx_mutashabihat_groups_kind ON mutashabihat_groups(kind);
    CREATE INDEX IF NOT EXISTS idx_mutashabihat_refs_group ON mutashabihat_refs(group_id);
    CREATE INDEX IF NOT EXISTS idx_mutashabihat_refs_surah_ayah ON mutashabihat_refs(surah, ayah);
    CREATE INDEX IF NOT EXISTS idx_qf_audio_cache_sa ON qf_ayah_audio_cache(surah, ayah);
    CREATE INDEX IF NOT EXISTS idx_qf_hadith_cache_sa ON qf_ayah_hadith_cache(surah, ayah, language);
    CREATE INDEX IF NOT EXISTS idx_private_notes_ayah ON private_notes(surah, ayah_start, ayah_end);
    CREATE INDEX IF NOT EXISTS idx_reflection_journey_levels_order ON reflection_journey_levels(order_index);
    CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_unlocked ON achievement_unlocks(unlocked_at);
  `);
}

export async function migrateUserSchema(db: DatabaseExecutor): Promise<void> {
  const legacyDate = "1970-01-01T00:00:00.000Z";

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS user_word_meanings (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      word_pos INTEGER NOT NULL,
      word TEXT,
      meaning TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (surah, ayah, word_pos)
    );
  `);

  await addColumnIfMissing(db, "study_cards", "created_at", `created_at TEXT NOT NULL DEFAULT '${legacyDate}'`);
  await addColumnIfMissing(db, "study_cards", "updated_at", `updated_at TEXT NOT NULL DEFAULT '${legacyDate}'`);
  await addColumnIfMissing(db, "study_cards", "suspended_at", "suspended_at TEXT");
  await addColumnIfMissing(db, "study_cards", "buried_until", "buried_until TEXT");
  await addColumnIfMissing(db, "study_cards", "marked_at", "marked_at TEXT");
  await addColumnIfMissing(db, "study_cards", "deleted_at", "deleted_at TEXT");
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_study_cards_buried ON study_cards(buried_until);
    CREATE INDEX IF NOT EXISTS idx_study_cards_marked ON study_cards(marked_at);
  `);
  await addColumnIfMissing(db, "private_notes", "created_at", `created_at TEXT NOT NULL DEFAULT '${legacyDate}'`);
  await addColumnIfMissing(db, "private_notes", "updated_at", `updated_at TEXT NOT NULL DEFAULT '${legacyDate}'`);
  await addColumnIfMissing(db, "private_notes", "deleted_at", "deleted_at TEXT");
  await addColumnIfMissing(db, "highlights", "sync_id", "sync_id TEXT");
  await addColumnIfMissing(db, "highlights", "updated_at", "updated_at TEXT");
  await addColumnIfMissing(db, "highlights", "deleted_at", "deleted_at TEXT");
  await addColumnIfMissing(db, "reflection_journey_entries", "created_at", `created_at TEXT NOT NULL DEFAULT '${legacyDate}'`);
  await addColumnIfMissing(db, "reflection_journey_entries", "updated_at", `updated_at TEXT NOT NULL DEFAULT '${legacyDate}'`);
  await addColumnIfMissing(db, "reflection_journey_entries", "completed_at", "completed_at TEXT");
  await addColumnIfMissing(db, "achievement_unlocks", "seen_at", "seen_at TEXT");
  await addColumnIfMissing(db, "achievement_unlocks", "local_payload", "local_payload TEXT NOT NULL DEFAULT '{}'");
  await addColumnIfMissing(db, "achievement_unlocks", "public_payload", "public_payload TEXT NOT NULL DEFAULT '{}'");
  await addColumnIfMissing(db, "achievement_unlocks", "sync_status", "sync_status TEXT DEFAULT 'pending'");
  await addColumnIfMissing(db, "user_settings", "updated_at", "updated_at TEXT");
  await addColumnIfMissing(db, "user_settings", "deleted_at", "deleted_at TEXT");
  await addColumnIfMissing(db, "achievement_progress", "updated_at", `updated_at TEXT NOT NULL DEFAULT '${legacyDate}'`);
  await addColumnIfMissing(db, "achievement_progress", "payload", "payload TEXT NOT NULL DEFAULT '{}'");
  await addColumnIfMissing(db, "mutashabihat_refs", "pre_text", "pre_text TEXT");
  await addColumnIfMissing(db, "mutashabihat_refs", "similar_text", "similar_text TEXT");
  await addColumnIfMissing(db, "mutashabihat_refs", "post_text", "post_text TEXT");
  // Learning and consistency: session and grading detail on each review (spec 7.1).
  await addColumnIfMissing(db, "study_log", "session_id", "session_id TEXT");
  await addColumnIfMissing(db, "study_log", "duration_ms", "duration_ms INTEGER");
  await addColumnIfMissing(db, "study_log", "support_level", "support_level INTEGER");
  await addColumnIfMissing(db, "study_log", "proposed_rating", "proposed_rating INTEGER");
  await addColumnIfMissing(db, "study_log", "grader", "grader TEXT");
  await addColumnIfMissing(db, "study_log", "local_date", "local_date TEXT");
  await addColumnIfMissing(db, "study_log", "tz", "tz TEXT");
  await addColumnIfMissing(db, "study_log", "error_count", "error_count INTEGER NOT NULL DEFAULT 0");
  // STR-08: the missed day this review was graded toward, while that day could still be made up.
  await addColumnIfMissing(db, "study_log", "makeup_for", "makeup_for TEXT");
  await addColumnIfMissing(db, "study_cards", "tier", "tier TEXT");
  await addColumnIfMissing(db, "study_cards", "tier_changed_at", "tier_changed_at TEXT");

  await db.execAsync(`
    UPDATE study_cards
      SET created_at = COALESCE(NULLIF(created_at, ''), NULLIF(last_review, ''), NULLIF(due, ''), '${legacyDate}')
      WHERE created_at IS NULL OR created_at = '';
    UPDATE study_cards
      SET updated_at = COALESCE(NULLIF(updated_at, ''), NULLIF(last_review, ''), NULLIF(due, ''), created_at, '${legacyDate}')
      WHERE updated_at IS NULL OR updated_at = '';
    UPDATE private_notes
      SET updated_at = COALESCE(NULLIF(updated_at, ''), NULLIF(created_at, ''), '${legacyDate}')
      WHERE updated_at IS NULL OR updated_at = '';
    UPDATE highlights
      SET updated_at = COALESCE(NULLIF(updated_at, ''), NULLIF(created_at, ''), '${legacyDate}')
      WHERE updated_at IS NULL OR updated_at = '';
    UPDATE highlights
      SET sync_id = 'highlight:' || surah || ':' || ayah || ':' || COALESCE(CAST(word_start AS TEXT), 'ayah') || ':' || COALESCE(CAST(word_end AS TEXT), 'ayah') || ':' || color
      WHERE sync_id IS NULL OR sync_id = '';
    UPDATE reflection_journey_entries
      SET updated_at = COALESCE(NULLIF(updated_at, ''), NULLIF(completed_at, ''), NULLIF(created_at, ''), '${legacyDate}')
      WHERE updated_at IS NULL OR updated_at = '';
    UPDATE achievement_progress
      SET updated_at = COALESCE(NULLIF(updated_at, ''), '${legacyDate}')
      WHERE updated_at IS NULL OR updated_at = '';
    UPDATE user_settings
      SET updated_at = COALESCE(NULLIF(updated_at, ''), '${legacyDate}')
      WHERE updated_at IS NULL OR updated_at = '';
  `);

  await createUserMigrationIndexes(db);
  await backfillStudyLogLocalDates(db);
}

/**
 * Reviews saved before local dates were recorded get the device's date for their instant, the same
 * date the old streak used. New reviews store their own date and zone when they happen (DAY-01).
 */
async function backfillStudyLogLocalDates(db: DatabaseExecutor): Promise<void> {
  const rows = await db.getAllAsync<{ id: number; reviewed_at: string }>(
    "SELECT id, reviewed_at FROM study_log WHERE local_date IS NULL",
  );
  if (rows.length === 0) return;
  const zone = deviceTimeZone();
  for (const row of rows) {
    const reviewedAt = new Date(row.reviewed_at);
    if (Number.isNaN(reviewedAt.getTime())) continue;
    await db.runAsync("UPDATE study_log SET local_date = ?, tz = COALESCE(tz, ?) WHERE id = ?", [
      localDateOf(reviewedAt),
      zone,
      row.id,
    ]);
  }
}

async function addColumnIfMissing(
  db: DatabaseExecutor,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  try {
    await db.getFirstAsync(`SELECT ${column} FROM ${table} LIMIT 1`);
  } catch {
    try {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    } catch (error) {
      console.warn(`[Database] Legacy schema migration skipped ${table}.${column}:`, error);
    }
  }
}

async function createUserMigrationIndexes(db: DatabaseExecutor): Promise<void> {
  const statements = [
    "CREATE INDEX IF NOT EXISTS idx_private_notes_updated ON private_notes(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_highlights_sync_id ON highlights(sync_id)",
    "CREATE INDEX IF NOT EXISTS idx_highlights_updated ON highlights(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_reflection_journey_entries_updated ON reflection_journey_entries(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_reflection_journey_entries_completed ON reflection_journey_entries(completed_at)",
    "CREATE INDEX IF NOT EXISTS idx_user_settings_updated ON user_settings(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_user_word_meanings_updated ON user_word_meanings(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_study_log_local_date ON study_log(local_date)",
    "CREATE INDEX IF NOT EXISTS idx_study_log_session ON study_log(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_study_cards_tier ON study_cards(tier)",
    "CREATE INDEX IF NOT EXISTS idx_review_sessions_local_date ON review_sessions(local_date)",
    "CREATE INDEX IF NOT EXISTS idx_recitation_errors_open ON recitation_errors(resolved_at, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_recitation_errors_card ON recitation_errors(card_id)",
    "CREATE INDEX IF NOT EXISTS idx_recitation_errors_location ON recitation_errors(surah, ayah, word)",
    "CREATE INDEX IF NOT EXISTS idx_study_log_makeup_for ON study_log(makeup_for) WHERE makeup_for IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_notification_log_date ON notification_log(local_date)",
  ];

  for (const statement of statements) {
    try {
      await db.execAsync(statement);
    } catch (error) {
      console.warn("[Database] Legacy schema index migration skipped:", error);
    }
  }
}

/** Create text_search index — must run AFTER the text_search column migration */
export async function createTextSearchIndex(db: DatabaseExecutor): Promise<void> {
  try {
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_quran_text_search ON quran_text(text_search)");
  } catch {
    // Column may not exist yet on very old databases — the migration will handle it
  }
}
