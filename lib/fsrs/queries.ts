import type { SQLiteDatabase } from "expo-sqlite";
import { createEmptyCard } from "./scheduler";
import type { DeckScope, StudyCardRow } from "./types";
import { enqueueSync } from "@/lib/database/sync-queue";
import { emitReviewActivity } from "./review-events";
import { recordAchievementEvent } from "@/lib/achievements/queries";

export type ReviewActivityDay = { date: string; count: number };

type ReviewStats = {
  activity: ReviewActivityDay[];
  activeDays: number;
  totalReviews: number;
  averageDailyReviews: number;
  longestStreak: number;
};

export type WirdStatus = {
  currentDays: number;
  longestDays: number;
  maintainedToday: boolean;
  lastReviewDate: string | null;
  state: "empty" | "maintained_today" | "open_today" | "fresh_start";
};

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayIndexFromDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.floor(new Date(year, (month || 1) - 1, day || 1).getTime() / 86400000);
}

function buildLocalReviewCounts(rows: { reviewed_at: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const reviewedAt = new Date(row.reviewed_at);
    if (Number.isNaN(reviewedAt.getTime())) continue;
    const key = formatLocalDateKey(reviewedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function calculateLongestStreak(dateKeys: string[]): number {
  let maxStreak = 0;
  let runStreak = 0;
  let prevIndex: number | null = null;

  for (const dateKey of dateKeys) {
    const dayIndex = dayIndexFromDateKey(dateKey);
    runStreak = prevIndex !== null && dayIndex - prevIndex === 1 ? runStreak + 1 : 1;
    maxStreak = Math.max(maxStreak, runStreak);
    prevIndex = dayIndex;
  }

  return maxStreak;
}

function calculateCurrentStreak(dateKeysDesc: string[], todayIndex: number): number {
  if (dateKeysDesc.length === 0) return 0;

  const yesterdayIndex = todayIndex - 1;
  const firstIndex = dayIndexFromDateKey(dateKeysDesc[0]);

  if (firstIndex < yesterdayIndex) return 0;

  let streak = 0;
  let expectedIndex = firstIndex;

  for (const dateKey of dateKeysDesc) {
    const dayIndex = dayIndexFromDateKey(dateKey);
    if (dayIndex === expectedIndex) {
      streak++;
      expectedIndex--;
    } else {
      break;
    }
  }

  return streak;
}

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
  scope: DeckScope,
  name?: string
): Promise<number> {
  const ayahs = await resolveScope(db, scope);
  if (ayahs.length === 0) return 0;

  const now = new Date().toISOString();
  const emptyCard = createEmptyCard();

  await db.withTransactionAsync(async () => {
    // Store deck metadata in user_settings
    await db.runAsync(
      "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
      [`deck_${deckId}`, JSON.stringify({ id: deckId, name, scope, createdAt: now })]
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

  recordAchievementEvent(db, { type: "deck_created", deckId, createdAt: now }).catch(console.warn);

  return ayahs.length;
}

export async function addAyahToDeck(
  db: SQLiteDatabase,
  deckId: string,
  surah: number,
  ayah: number
): Promise<boolean> {
  const now = new Date().toISOString();
  const emptyCard = createEmptyCard();
  const cardId = `${surah}:${ayah}`;
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM study_cards WHERE id = ? AND deck_id = ?",
    [cardId, deckId]
  );
  if (existing?.id) return false;

  await db.runAsync(
    `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
      null,
      now,
      now,
    ]
  );
  return true;
}

export const MEANINGS_DECK_ID = "meanings";
export const MUTASHABIHAT_DECK_ID = "mutashabihat";
export const MUTASHABIHAT_DECK_NAME = "Mutashabihat";

export function meaningCardId(surah: number, ayah: number, wordPos: number): string {
  return `word:${surah}:${ayah}:${wordPos}`;
}

export function mutashabihatCardId(surah: number, ayah: number): string {
  return `${MUTASHABIHAT_DECK_ID}:${surah}:${ayah}`;
}

async function ensureMutashabihatDeck(db: SQLiteDatabase, now: string): Promise<boolean> {
  const existing = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [`deck_${MUTASHABIHAT_DECK_ID}`]
  );

  const metadata = {
    id: MUTASHABIHAT_DECK_ID,
    name: MUTASHABIHAT_DECK_NAME,
    scope: { type: "custom", surahStart: 1, ayahStart: 1, surahEnd: 1, ayahEnd: 1 },
    createdAt: now,
  };

  if (!existing) {
    await db.runAsync(
      "INSERT INTO user_settings (key, value) VALUES (?, ?)",
      [`deck_${MUTASHABIHAT_DECK_ID}`, JSON.stringify(metadata)]
    );
    return true;
  }

  try {
    const current = JSON.parse(existing.value);
    if (current?.name !== MUTASHABIHAT_DECK_NAME) {
      await db.runAsync(
        "UPDATE user_settings SET value = ? WHERE key = ?",
        [
          JSON.stringify({
            ...metadata,
            ...current,
            id: MUTASHABIHAT_DECK_ID,
            name: MUTASHABIHAT_DECK_NAME,
            scope: current?.scope ?? metadata.scope,
            createdAt: current?.createdAt ?? now,
          }),
          `deck_${MUTASHABIHAT_DECK_ID}`,
        ]
      );
    }
  } catch {
    await db.runAsync(
      "UPDATE user_settings SET value = ? WHERE key = ?",
      [JSON.stringify(metadata), `deck_${MUTASHABIHAT_DECK_ID}`]
    );
  }

  return false;
}

export async function isMeaningCardSaved(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
  wordPos: number
): Promise<boolean> {
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM study_cards WHERE id = ? AND deck_id = ?",
    [meaningCardId(surah, ayah, wordPos), MEANINGS_DECK_ID]
  );
  return (row?.c ?? 0) > 0;
}

export async function addMeaningCard(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
  wordPos: number
): Promise<{ created: boolean }> {
  const now = new Date().toISOString();
  const emptyCard = createEmptyCard();
  const cardId = meaningCardId(surah, ayah, wordPos);

  await db.runAsync(
    "INSERT OR IGNORE INTO user_settings (key, value) VALUES (?, ?)",
    [
      `deck_${MEANINGS_DECK_ID}`,
      JSON.stringify({
        id: MEANINGS_DECK_ID,
        scope: { type: "custom", surahStart: 1, ayahStart: 1, surahEnd: 1, ayahEnd: 1 },
        createdAt: now,
      }),
    ]
  );

  const result = await db.runAsync(
    `INSERT OR IGNORE INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cardId,
      MEANINGS_DECK_ID,
      emptyCard.due.toISOString(),
      emptyCard.stability,
      emptyCard.difficulty,
      emptyCard.elapsed_days,
      emptyCard.scheduled_days,
      emptyCard.learning_steps,
      emptyCard.reps,
      emptyCard.lapses,
      emptyCard.state,
      null,
      now,
      now,
    ]
  );

  const created = (result.changes ?? 0) > 0;
  if (created) {
    enqueueSync(db, "study_cards", "INSERT", cardId, {
      id: cardId,
      deck_id: MEANINGS_DECK_ID,
      due: emptyCard.due.toISOString(),
      stability: emptyCard.stability,
      difficulty: emptyCard.difficulty,
      elapsed_days: emptyCard.elapsed_days,
      scheduled_days: emptyCard.scheduled_days,
      learning_steps: emptyCard.learning_steps,
      reps: emptyCard.reps,
      lapses: emptyCard.lapses,
      state: emptyCard.state,
      last_review: null,
      created_at: now,
      updated_at: now,
    }).catch(console.warn);

    recordAchievementEvent(db, {
      type: "vocab_saved",
      cardId,
      surah,
      ayah,
      wordPos,
      createdAt: now,
    }).catch(console.warn);
  }

  return { created };
}

export async function isMutashabihatCardSaved(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): Promise<boolean> {
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM study_cards WHERE id = ? AND deck_id = ?",
    [mutashabihatCardId(surah, ayah), MUTASHABIHAT_DECK_ID]
  );
  return (row?.c ?? 0) > 0;
}

export async function addMutashabihatCard(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): Promise<{ created: boolean }> {
  const now = new Date().toISOString();
  const emptyCard = createEmptyCard();
  const cardId = mutashabihatCardId(surah, ayah);
  const deckCreated = await ensureMutashabihatDeck(db, now);

  const result = await db.runAsync(
    `INSERT OR IGNORE INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cardId,
      MUTASHABIHAT_DECK_ID,
      emptyCard.due.toISOString(),
      emptyCard.stability,
      emptyCard.difficulty,
      emptyCard.elapsed_days,
      emptyCard.scheduled_days,
      emptyCard.learning_steps,
      emptyCard.reps,
      emptyCard.lapses,
      emptyCard.state,
      null,
      now,
      now,
    ]
  );

  const created = (result.changes ?? 0) > 0;
  if (created) {
    enqueueSync(db, "study_cards", "INSERT", cardId, {
      id: cardId,
      deck_id: MUTASHABIHAT_DECK_ID,
      due: emptyCard.due.toISOString(),
      stability: emptyCard.stability,
      difficulty: emptyCard.difficulty,
      elapsed_days: emptyCard.elapsed_days,
      scheduled_days: emptyCard.scheduled_days,
      learning_steps: emptyCard.learning_steps,
      reps: emptyCard.reps,
      lapses: emptyCard.lapses,
      state: emptyCard.state,
      last_review: null,
      created_at: now,
      updated_at: now,
    }).catch(console.warn);
  }

  if (deckCreated) {
    recordAchievementEvent(db, { type: "deck_created", deckId: MUTASHABIHAT_DECK_ID, createdAt: now }).catch(console.warn);
  }

  return { created };
}

// ─── Query helpers ───────────────────────────────────────────

export async function getDueCards(
  db: SQLiteDatabase,
  deckId?: string,
  limit?: number
): Promise<StudyCardRow[]> {
  const now = new Date().toISOString();
  const limitClause = limit ? ` LIMIT ${limit}` : "";
  if (deckId) {
    return db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE deck_id = ? AND due <= ? ORDER BY due${limitClause}`,
      [deckId, now]
    );
  }
  return db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards WHERE due <= ? ORDER BY due${limitClause}`,
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

export async function getTotalAyahCardCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM study_cards WHERE id NOT LIKE 'word:%'",
    []
  );
  return row?.count ?? 0;
}

export async function getMemorizedAyahCardCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM study_cards WHERE state = 2 AND id NOT LIKE 'word:%'",
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

export async function getDecks(db: SQLiteDatabase): Promise<{ id: string; name?: string; scope: DeckScope; createdAt: string }[]> {
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

  recordAchievementEvent(db, { type: "review_logged", cardId, rating, reviewedAt }).catch(console.warn);

  emitReviewActivity();
}

export async function getStudyStreak(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<{ reviewed_at: string }>(
    `SELECT reviewed_at FROM study_log ORDER BY reviewed_at DESC`
  );
  if (rows.length === 0) return 0;

  const reviewDates = [...buildLocalReviewCounts(rows).keys()].sort().reverse();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIdx = dayIndexFromDateKey(formatLocalDateKey(today));
  return calculateCurrentStreak(reviewDates, todayIdx);
}

export async function getWirdStatus(db: SQLiteDatabase): Promise<WirdStatus> {
  const rows = await db.getAllAsync<{ reviewed_at: string }>(
    `SELECT reviewed_at FROM study_log ORDER BY reviewed_at DESC`
  );
  const counts = buildLocalReviewCounts(rows);
  const dateKeys = [...counts.keys()].sort();

  if (dateKeys.length === 0) {
    return {
      currentDays: 0,
      longestDays: 0,
      maintainedToday: false,
      lastReviewDate: null,
      state: "empty",
    };
  }

  const reviewDatesDesc = [...dateKeys].reverse();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIndex = dayIndexFromDateKey(formatLocalDateKey(today));
  const latestDateKey = reviewDatesDesc[0];
  const latestIndex = dayIndexFromDateKey(latestDateKey);
  const currentDays = calculateCurrentStreak(reviewDatesDesc, todayIndex);
  const state: WirdStatus["state"] =
    latestIndex === todayIndex
      ? "maintained_today"
      : latestIndex === todayIndex - 1
        ? "open_today"
        : "fresh_start";
  const latestRow = rows.find((row) => {
    const reviewedAt = new Date(row.reviewed_at);
    return !Number.isNaN(reviewedAt.getTime()) && formatLocalDateKey(reviewedAt) === latestDateKey;
  });

  return {
    currentDays,
    longestDays: calculateLongestStreak(dateKeys),
    maintainedToday: state === "maintained_today",
    lastReviewDate: latestRow?.reviewed_at ?? latestDateKey,
    state,
  };
}

export async function getReviewStats(db: SQLiteDatabase, activityDays = 90): Promise<ReviewStats> {
  const rows = await db.getAllAsync<{ reviewed_at: string }>(
    "SELECT reviewed_at FROM study_log ORDER BY reviewed_at ASC"
  );
  const counts = buildLocalReviewCounts(rows);
  const dateKeys = [...counts.keys()].sort();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIndex = dayIndexFromDateKey(formatLocalDateKey(today));
  const start = new Date(today);
  start.setDate(start.getDate() - Math.max(activityDays - 1, 0));
  const startIndex = dayIndexFromDateKey(formatLocalDateKey(start));

  const activity = dateKeys
    .filter((dateKey) => {
      const dayIndex = dayIndexFromDateKey(dateKey);
      return dayIndex >= startIndex && dayIndex <= todayIndex;
    })
    .map((date) => ({ date, count: counts.get(date) ?? 0 }));

  const totalReviews = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const activeDays = dateKeys.length;

  return {
    activity,
    activeDays,
    totalReviews,
    averageDailyReviews: activeDays > 0 ? Math.round(totalReviews / activeDays) : 0,
    longestStreak: calculateLongestStreak(dateKeys),
  };
}

export async function getLastReviewDate(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ reviewed_at: string }>(
    "SELECT reviewed_at FROM study_log ORDER BY reviewed_at DESC LIMIT 1"
  );
  return row?.reviewed_at ?? null;
}
