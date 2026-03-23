import type { SQLiteDatabase } from "expo-sqlite";
import { createEmptyCard } from "./scheduler";
import type { DeckScope, StudyCardRow } from "./types";
import { enqueueSync } from "@/lib/database/sync-queue";

// ─── Deck ID generation ──────────────────────────────────────

export function generateDeckId(scope: DeckScope): string {
  switch (scope.type) {
    case "surah":
      return `surah-${scope.surahs.sort((a, b) => a - b).join(",")}`;
    case "juz":
      return `juz-${scope.juzNumbers.sort((a, b) => a - b).join(",")}`;
    case "hizb":
      return `hizb-${scope.hizbNumbers.sort((a, b) => a - b).join(",")}`;
    case "custom":
      return `custom-${scope.surahStart}:${scope.ayahStart}-${scope.surahEnd}:${scope.ayahEnd}`;
  }
}

// ─── Resolve scope to ayah list ──────────────────────────────

type AyahRef = { surah: number; ayah: number };

export async function resolveScope(
  db: SQLiteDatabase,
  scope: DeckScope
): Promise<AyahRef[]> {
  switch (scope.type) {
    case "surah": {
      const placeholders = scope.surahs.map(() => "?").join(",");
      return db.getAllAsync<AyahRef>(
        `SELECT surah, ayah FROM quran_text WHERE surah IN (${placeholders}) ORDER BY surah, ayah`,
        scope.surahs
      );
    }
    case "juz": {
      const rows = await db.getAllAsync<{
        surah: number;
        ayah_start: number;
        ayah_end: number;
      }>(
        `SELECT surah, ayah_start, ayah_end FROM juz_map WHERE juz IN (${scope.juzNumbers.map(() => "?").join(",")}) ORDER BY juz, surah, ayah_start`,
        scope.juzNumbers
      );
      const ayahs: AyahRef[] = [];
      for (const row of rows) {
        for (let a = row.ayah_start; a <= row.ayah_end; a++) {
          ayahs.push({ surah: row.surah, ayah: a });
        }
      }
      return ayahs;
    }
    case "hizb": {
      // hizb_map has (surah_start, ayah_start, surah_end, ayah_end)
      const rows = await db.getAllAsync<{
        surah_start: number;
        ayah_start: number;
        surah_end: number;
        ayah_end: number;
      }>(
        `SELECT surah_start, ayah_start, surah_end, ayah_end FROM hizb_map WHERE hizb IN (${scope.hizbNumbers.map(() => "?").join(",")}) ORDER BY hizb`,
        scope.hizbNumbers
      );
      const ayahs: AyahRef[] = [];
      for (const row of rows) {
        // Fetch all ayahs in this range
        const rangeAyahs = await db.getAllAsync<AyahRef>(
          `SELECT surah, ayah FROM quran_text
           WHERE (surah > ? OR (surah = ? AND ayah >= ?))
             AND (surah < ? OR (surah = ? AND ayah <= ?))
           ORDER BY surah, ayah`,
          [row.surah_start, row.surah_start, row.ayah_start,
           row.surah_end, row.surah_end, row.ayah_end]
        );
        ayahs.push(...rangeAyahs);
      }
      return ayahs;
    }
    case "custom": {
      return db.getAllAsync<AyahRef>(
        `SELECT surah, ayah FROM quran_text
         WHERE (surah > ? OR (surah = ? AND ayah >= ?))
           AND (surah < ? OR (surah = ? AND ayah <= ?))
         ORDER BY surah, ayah`,
        [scope.surahStart, scope.surahStart, scope.ayahStart,
         scope.surahEnd, scope.surahEnd, scope.ayahEnd]
      );
    }
  }
}

// ─── Create deck (generate cards) ────────────────────────────

export async function createDeck(
  db: SQLiteDatabase,
  deckId: string,
  scope: DeckScope
): Promise<number> {
  const ayahs = await resolveScope(db, scope);
  if (ayahs.length === 0) return 0;

  const now = new Date().toISOString();
  const emptyCard = createEmptyCard();

  await db.withTransactionAsync(async () => {
    // Store deck metadata in user_settings
    await db.runAsync(
      "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
      [`deck_${deckId}`, JSON.stringify({ id: deckId, scope, createdAt: now })]
    );

    // Insert cards in batches
    const BATCH = 500;
    for (let i = 0; i < ayahs.length; i += BATCH) {
      const batch = ayahs.slice(i, i + BATCH);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      const params: any[] = [];
      for (const a of batch) {
        const cardId = `${a.surah}:${a.ayah}`;
        params.push(
          cardId,
          deckId,
          emptyCard.due.toISOString(),
          emptyCard.stability,
          emptyCard.difficulty,
          emptyCard.elapsed_days,
          emptyCard.scheduled_days,
          emptyCard.learning_steps,
          emptyCard.reps,
          emptyCard.lapses,
          emptyCard.state,
          null, // last_review
          now,
          now
        );
      }
      await db.runAsync(
        `INSERT OR IGNORE INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, created_at, updated_at) VALUES ${placeholders}`,
        params
      );
    }
  });

  return ayahs.length;
}

// ─── Query helpers ───────────────────────────────────────────

export async function getDueCards(
  db: SQLiteDatabase,
  deckId?: string
): Promise<StudyCardRow[]> {
  const now = new Date().toISOString();
  if (deckId) {
    return db.getAllAsync<StudyCardRow>(
      "SELECT * FROM study_cards WHERE deck_id = ? AND due <= ? ORDER BY due",
      [deckId, now]
    );
  }
  return db.getAllAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE due <= ? ORDER BY due",
    [now]
  );
}

export async function getDueCount(db: SQLiteDatabase, deckId?: string): Promise<number> {
  const now = new Date().toISOString();
  if (deckId) {
    const row = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM study_cards WHERE deck_id = ? AND due <= ?",
      [deckId, now]
    );
    return row?.count ?? 0;
  }
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM study_cards WHERE due <= ?",
    [now]
  );
  return row?.count ?? 0;
}

export async function getTotalCardCount(db: SQLiteDatabase, deckId?: string): Promise<number> {
  if (deckId) {
    const row = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM study_cards WHERE deck_id = ?",
      [deckId]
    );
    return row?.count ?? 0;
  }
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM study_cards",
    []
  );
  return row?.count ?? 0;
}

export async function getNewCount(db: SQLiteDatabase, deckId?: string): Promise<number> {
  if (deckId) {
    const row = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM study_cards WHERE deck_id = ? AND state = 0",
      [deckId]
    );
    return row?.count ?? 0;
  }
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM study_cards WHERE state = 0",
    []
  );
  return row?.count ?? 0;
}

export async function getDecks(db: SQLiteDatabase): Promise<{ id: string; scope: DeckScope; createdAt: string }[]> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM user_settings WHERE key LIKE 'deck_%'"
  );
  return rows.map((r) => JSON.parse(r.value));
}

export async function deleteDeck(db: SQLiteDatabase, deckId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    // Delete associated log entries
    await db.runAsync(
      "DELETE FROM study_log WHERE card_id IN (SELECT id FROM study_cards WHERE deck_id = ?)",
      [deckId]
    );
    // Delete cards
    await db.runAsync("DELETE FROM study_cards WHERE deck_id = ?", [deckId]);
    // Delete deck metadata
    await db.runAsync("DELETE FROM user_settings WHERE key = ?", [`deck_${deckId}`]);
  });
}

export async function updateCard(db: SQLiteDatabase, card: StudyCardRow): Promise<void> {
  await db.runAsync(
    `UPDATE study_cards SET
      due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
      learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ?, updated_at = ?
     WHERE id = ?`,
    [
      card.due, card.stability, card.difficulty, card.elapsed_days, card.scheduled_days,
      card.learning_steps, card.reps, card.lapses, card.state, card.last_review, card.updated_at,
      card.id,
    ]
  );

  // Enqueue for sync
  enqueueSync(db, "study_cards", "UPDATE", card.id, {
    id: card.id,
    deck_id: card.deck_id,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review,
    created_at: card.created_at,
    updated_at: card.updated_at,
  }).catch(console.warn);
}

export async function insertStudyLog(
  db: SQLiteDatabase,
  cardId: string,
  rating: number,
  state: number,
  due: string,
  stability: number,
  difficulty: number,
  elapsedDays: number,
  scheduledDays: number,
  reviewedAt: string
): Promise<void> {
  await db.runAsync(
    `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [cardId, rating, state, due, stability, difficulty, elapsedDays, scheduledDays, reviewedAt]
  );

  // Enqueue for sync
  enqueueSync(db, "study_log", "INSERT", `${cardId}:${reviewedAt}`, {
    card_id: cardId,
    rating,
    state,
    due,
    stability,
    difficulty,
    elapsed_days: elapsedDays,
    scheduled_days: scheduledDays,
    reviewed_at: reviewedAt,
  }).catch(console.warn);
}

export async function getStudyStreak(db: SQLiteDatabase): Promise<number> {
  // Count consecutive days with at least one review, ending today or yesterday
  const rows = await db.getAllAsync<{ review_date: string }>(
    `SELECT DISTINCT DATE(reviewed_at) as review_date FROM study_log ORDER BY review_date DESC LIMIT 365`
  );
  if (rows.length === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const firstDate = new Date(rows[0].review_date);
  firstDate.setHours(0, 0, 0, 0);

  // Streak must start from today or yesterday
  if (firstDate < yesterday) return 0;

  let streak = 0;
  let expected = firstDate;

  for (const row of rows) {
    const d = new Date(row.review_date);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === expected.getTime()) {
      streak++;
      expected = new Date(expected);
      expected.setDate(expected.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export async function getLastReviewDate(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ reviewed_at: string }>(
    "SELECT reviewed_at FROM study_log ORDER BY reviewed_at DESC LIMIT 1"
  );
  return row?.reviewed_at ?? null;
}
