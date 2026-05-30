import type { SQLiteDatabase } from "expo-sqlite";
import { createEmptyCard } from "./scheduler";
import {
  ALL_NEW_CARD_SORT_ORDERS,
  ALL_NEW_REVIEW_ORDERS,
  ALL_TEST_MODES,
  ALL_WORD_TEST_MODES,
  ALL_REVIEW_SORT_ORDERS,
  DEFAULT_DECK_ENABLE_FUZZ,
  DEFAULT_DECK_ENABLE_SHORT_TERM,
  DEFAULT_DECK_DAILY_REVIEW_LIMIT,
  DEFAULT_ENABLED_MODES,
  DEFAULT_DECK_LEARNING_STEPS,
  DEFAULT_DECK_MAXIMUM_INTERVAL,
  DEFAULT_DECK_NEW_CARD_LIMIT,
  DEFAULT_DECK_RELEARNING_STEPS,
  DEFAULT_DECK_REQUEST_RETENTION,
  DEFAULT_WORD_TEST_MODES,
  DEFAULT_NEW_CARD_SORT_ORDER,
  DEFAULT_NEW_REVIEW_ORDER,
  DEFAULT_REVIEW_SORT_ORDER,
  MAX_DECK_MAXIMUM_INTERVAL,
  MAX_DECK_REQUEST_RETENTION,
  MIN_DECK_MAXIMUM_INTERVAL,
  MIN_DECK_DAILY_REVIEW_LIMIT,
  MIN_DECK_NEW_CARD_LIMIT,
  MIN_DECK_REQUEST_RETENTION,
  type DeckReviewSettings,
  type DeckCardListItem,
  type SchedulerStep,
  type StudyCardRow,
  type TestMode,
  type WordTestMode,
} from "./types";
import { enqueueSync } from "@/lib/database/sync-queue";
import { writeUserSetting } from "@/lib/database/user-settings";
import { emitReviewActivity } from "./review-events";
import { recordAchievementEvent } from "@/lib/achievements/queries";
import {
  filterStudyRowsByDefaultDeckFilter,
  getAllMatchingSmartCardIdSet,
  getDueCardsForReview,
  getSmartCardContent,
  getSmartDeckCandidateCardIds,
  getSmartDeckStats,
  getSmartDeckTodayStats,
  isSmartDeckId,
  migrateLegacyRetentionDecks,
  SMART_DECK_IDS,
  type DueCardsForReviewOptions,
} from "./smart-decks";

type ReviewActivityDay = { date: string; count: number };

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

const SMART_CARD_SQL = `deck_id IN (${Object.values(SMART_DECK_IDS).map((id) => `'${id}'`).join(", ")})`;
const NON_SMART_CARD_SQL = `NOT ${SMART_CARD_SQL}`;
const ACTIVE_CARD_SQL = "deleted_at IS NULL";
const REVIEWABLE_CARD_SQL = `${ACTIVE_CARD_SQL} AND suspended_at IS NULL AND (buried_until IS NULL OR buried_until <= ?)`;

function localStartOfTomorrow(): Date {
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

function dayDiffLocal(from: Date, to: Date): number {
  const fromStart = new Date(from);
  fromStart.setHours(0, 0, 0, 0);
  const toStart = new Date(to);
  toStart.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((toStart.getTime() - fromStart.getTime()) / 86400000));
}

function cardToSyncData(card: StudyCardRow): Record<string, any> {
  return {
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
    suspended_at: card.suspended_at,
    buried_until: card.buried_until,
    marked_at: card.marked_at,
    created_at: card.created_at,
    updated_at: card.updated_at,
    deleted_at: card.deleted_at ?? null,
  };
}

function rowWithDefaultStatus(row: StudyCardRow): StudyCardRow {
  return {
    ...row,
    suspended_at: row.suspended_at ?? null,
    buried_until: row.buried_until ?? null,
    marked_at: row.marked_at ?? null,
    deleted_at: row.deleted_at ?? null,
  };
}

function isReviewableCard(row: StudyCardRow, nowIso: string): boolean {
  return !row.deleted_at && !row.suspended_at && (!row.buried_until || row.buried_until <= nowIso);
}

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

function todayBounds(): { start: string; end: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
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

  const firstIndex = dayIndexFromDateKey(dateKeysDesc[0]);

  if (firstIndex !== todayIndex) return 0;

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

export const MEANINGS_DECK_ID = "meanings";
export const MUTASHABIHAT_DECK_ID = "mutashabihat";
const DECK_REVIEW_SETTINGS_PREFIX = "review_settings_";

function deckReviewSettingsKey(deckId: string): string {
  return `${DECK_REVIEW_SETTINGS_PREFIX}${deckId}`;
}

function clampReviewLimit(value: unknown): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return DEFAULT_DECK_DAILY_REVIEW_LIMIT;
  return Math.max(MIN_DECK_DAILY_REVIEW_LIMIT, n);
}

function clampNewCardLimit(value: unknown): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return DEFAULT_DECK_NEW_CARD_LIMIT;
  return Math.max(MIN_DECK_NEW_CARD_LIMIT, n);
}

function clampRetention(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return DEFAULT_DECK_REQUEST_RETENTION;
  return Math.max(MIN_DECK_REQUEST_RETENTION, Math.min(MAX_DECK_REQUEST_RETENTION, n));
}

function clampMaximumInterval(value: unknown): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return DEFAULT_DECK_MAXIMUM_INTERVAL;
  return Math.max(MIN_DECK_MAXIMUM_INTERVAL, Math.min(MAX_DECK_MAXIMUM_INTERVAL, n));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

const SCHEDULER_STEP_RE = /^\d+(?:\.\d+)?[mhd]$/;

function isSchedulerStep(value: string): value is SchedulerStep {
  return SCHEDULER_STEP_RE.test(value);
}

function normalizeStepList(value: unknown, fallback: readonly SchedulerStep[]): SchedulerStep[] {
  if (!Array.isArray(value)) return [...fallback];
  if (value.length === 0) return [];
  const valid = value
    .map((step) => String(step).trim())
    .filter(isSchedulerStep);
  return valid.length > 0 ? valid : [...fallback];
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function normalizeModeList<T extends string>(value: unknown, allowed: readonly T[], fallback: readonly T[]): T[] {
  if (!Array.isArray(value)) return [...fallback];
  const valid = value.filter((mode): mode is T => allowed.includes(mode as T));
  return valid.length > 0 ? valid : [...fallback];
}

function normalizeDeckReviewSettings(value: unknown, fallback?: DeckReviewSettings): DeckReviewSettings {
  const raw = value && typeof value === "object" ? value as Partial<DeckReviewSettings> : {};
  return {
    dailyReviewLimit: clampReviewLimit(raw.dailyReviewLimit ?? fallback?.dailyReviewLimit),
    newCardsLimit: clampNewCardLimit(raw.newCardsLimit ?? fallback?.newCardsLimit),
    requestRetention: clampRetention(raw.requestRetention ?? fallback?.requestRetention),
    maximumInterval: clampMaximumInterval(raw.maximumInterval ?? fallback?.maximumInterval),
    enableFuzz: normalizeBoolean(raw.enableFuzz, fallback?.enableFuzz ?? DEFAULT_DECK_ENABLE_FUZZ),
    enableShortTerm: normalizeBoolean(raw.enableShortTerm, fallback?.enableShortTerm ?? DEFAULT_DECK_ENABLE_SHORT_TERM),
    learningSteps: normalizeStepList(raw.learningSteps, fallback?.learningSteps ?? DEFAULT_DECK_LEARNING_STEPS),
    relearningSteps: normalizeStepList(raw.relearningSteps, fallback?.relearningSteps ?? DEFAULT_DECK_RELEARNING_STEPS),
    newReviewOrder: normalizeEnum(raw.newReviewOrder, ALL_NEW_REVIEW_ORDERS, fallback?.newReviewOrder ?? DEFAULT_NEW_REVIEW_ORDER),
    reviewSortOrder: normalizeEnum(raw.reviewSortOrder, ALL_REVIEW_SORT_ORDERS, fallback?.reviewSortOrder ?? DEFAULT_REVIEW_SORT_ORDER),
    newCardSortOrder: normalizeEnum(raw.newCardSortOrder, ALL_NEW_CARD_SORT_ORDERS, fallback?.newCardSortOrder ?? DEFAULT_NEW_CARD_SORT_ORDER),
    testModes: normalizeModeList<TestMode>(raw.testModes, ALL_TEST_MODES, fallback?.testModes ?? DEFAULT_ENABLED_MODES),
    wordTestModes: normalizeModeList<WordTestMode>(
      raw.wordTestModes,
      ALL_WORD_TEST_MODES,
      fallback?.wordTestModes ?? DEFAULT_WORD_TEST_MODES
    ),
  };
}

async function readLegacyReviewSettings(db: SQLiteDatabase): Promise<DeckReviewSettings> {
  const [dailyLimitRow, testModesRow, wordModesRow] = await Promise.all([
    db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = 'daily_review_limit'"),
    db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = 'flashcard_test_modes'"),
    db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = 'word_flashcard_test_modes'"),
  ]);
  let testModes: TestMode[] = DEFAULT_ENABLED_MODES;
  let wordTestModes: WordTestMode[] = DEFAULT_WORD_TEST_MODES;

  if (testModesRow?.value) {
    try {
      testModes = normalizeModeList<TestMode>(JSON.parse(testModesRow.value), ALL_TEST_MODES, DEFAULT_ENABLED_MODES);
    } catch {}
  }
  if (wordModesRow?.value) {
    try {
      wordTestModes = normalizeModeList<WordTestMode>(JSON.parse(wordModesRow.value), ALL_WORD_TEST_MODES, DEFAULT_WORD_TEST_MODES);
    } catch {}
  }

  return {
    dailyReviewLimit: clampReviewLimit(dailyLimitRow?.value),
    newCardsLimit: DEFAULT_DECK_NEW_CARD_LIMIT,
    requestRetention: DEFAULT_DECK_REQUEST_RETENTION,
    maximumInterval: DEFAULT_DECK_MAXIMUM_INTERVAL,
    enableFuzz: DEFAULT_DECK_ENABLE_FUZZ,
    enableShortTerm: DEFAULT_DECK_ENABLE_SHORT_TERM,
    learningSteps: [...DEFAULT_DECK_LEARNING_STEPS],
    relearningSteps: [...DEFAULT_DECK_RELEARNING_STEPS],
    newReviewOrder: DEFAULT_NEW_REVIEW_ORDER,
    reviewSortOrder: DEFAULT_REVIEW_SORT_ORDER,
    newCardSortOrder: DEFAULT_NEW_CARD_SORT_ORDER,
    testModes,
    wordTestModes,
  };
}

export async function readDeckReviewSettings(
  db: SQLiteDatabase,
  deckId: string | null | undefined
): Promise<DeckReviewSettings> {
  const fallback = await readLegacyReviewSettings(db);
  if (!deckId) return fallback;

  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [deckReviewSettingsKey(deckId)]
  );
  if (!row?.value) return fallback;

  try {
    return normalizeDeckReviewSettings(JSON.parse(row.value), fallback);
  } catch {
    return fallback;
  }
}

export async function writeDeckReviewSettings(
  db: SQLiteDatabase,
  deckId: string,
  settings: Partial<DeckReviewSettings>
): Promise<void> {
  const normalized = normalizeDeckReviewSettings(settings);
  await writeUserSetting(db, deckReviewSettingsKey(deckId), JSON.stringify(normalized));
}

function meaningCardId(surah: number, ayah: number, wordPos: number): string {
  return `word:${surah}:${ayah}:${wordPos}`;
}

function mutashabihatCardId(surah: number, ayah: number): string {
  return `${MUTASHABIHAT_DECK_ID}:${surah}:${ayah}`;
}

function retentionCardId(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

export async function isMeaningCardSaved(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
  wordPos: number
): Promise<boolean> {
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM study_cards WHERE id = ? AND deck_id = ? AND deleted_at IS NULL",
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

  const existingDeck = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [`deck_${MEANINGS_DECK_ID}`]
  );
  if (!existingDeck) {
    await writeUserSetting(db, `deck_${MEANINGS_DECK_ID}`, JSON.stringify({
      id: MEANINGS_DECK_ID,
      scope: { type: "custom", surahStart: 1, ayahStart: 1, surahEnd: 1, ayahEnd: 1 },
      createdAt: now,
    }));
  }

  const result = await db.runAsync(
    `INSERT INTO study_cards
      (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
      deck_id = excluded.deck_id,
      due = excluded.due,
      stability = excluded.stability,
      difficulty = excluded.difficulty,
      elapsed_days = excluded.elapsed_days,
      scheduled_days = excluded.scheduled_days,
      learning_steps = excluded.learning_steps,
      reps = excluded.reps,
      lapses = excluded.lapses,
      state = excluded.state,
      last_review = excluded.last_review,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      deleted_at = NULL
     WHERE study_cards.deleted_at IS NOT NULL`,
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
      suspended_at: null,
      buried_until: null,
      marked_at: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
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

export async function isRetentionCardSaved(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): Promise<boolean> {
  const cardId = retentionCardId(surah, ayah);
  const legacyCardId = mutashabihatCardId(surah, ayah);
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c
       FROM study_cards
      WHERE deleted_at IS NULL
        AND ((id = ? AND deck_id = ? AND marked_at IS NOT NULL)
         OR (id = ? AND deck_id != ? AND ${NON_SMART_CARD_SQL})
         OR (id = ? AND deck_id = ?))`,
    [cardId, SMART_DECK_IDS.retention, cardId, MEANINGS_DECK_ID, legacyCardId, MUTASHABIHAT_DECK_ID]
  );
  return (row?.c ?? 0) > 0;
}

export async function addRetentionCard(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): Promise<{ created: boolean }> {
  await migrateLegacyRetentionDecks(db);
  const now = new Date().toISOString();
  const emptyCard = createEmptyCard();
  const cardId = retentionCardId(surah, ayah);

  const existing = await db.getFirstAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE id = ? AND deck_id = ? AND deleted_at IS NULL",
    [cardId, SMART_DECK_IDS.retention]
  );
  if (existing?.id) {
    if (existing.marked_at) return { created: false };
    await updateCard(db, rowWithDefaultStatus({
      ...existing,
      marked_at: now,
      updated_at: now,
    }));
    return { created: true };
  }

  const result = await db.runAsync(
    `INSERT INTO study_cards
      (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, suspended_at, buried_until, marked_at, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
      deck_id = excluded.deck_id,
      due = excluded.due,
      stability = excluded.stability,
      difficulty = excluded.difficulty,
      elapsed_days = excluded.elapsed_days,
      scheduled_days = excluded.scheduled_days,
      learning_steps = excluded.learning_steps,
      reps = excluded.reps,
      lapses = excluded.lapses,
      state = excluded.state,
      last_review = excluded.last_review,
      suspended_at = excluded.suspended_at,
      buried_until = excluded.buried_until,
      marked_at = excluded.marked_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      deleted_at = NULL
     WHERE study_cards.deleted_at IS NOT NULL`,
    [
      cardId,
      SMART_DECK_IDS.retention,
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
      null,
      null,
      now,
      now,
      now,
    ]
  );

  const created = (result.changes ?? 0) > 0;
  if (created) {
    enqueueSync(db, "study_cards", "INSERT", cardId, {
      id: cardId,
      deck_id: SMART_DECK_IDS.retention,
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
      suspended_at: null,
      buried_until: null,
      marked_at: now,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }).catch(console.warn);
  }

  return { created };
}

// ─── Query helpers ───────────────────────────────────────────

function reviewQueueOptionsFromSettings(settings: DeckReviewSettings, limit: number): DueCardsForReviewOptions {
  return {
    limit,
    newCardsLimit: settings.newCardsLimit,
    newReviewOrder: settings.newReviewOrder,
    reviewSortOrder: settings.reviewSortOrder,
    newCardSortOrder: settings.newCardSortOrder,
  };
}

async function getTodayReviewedCount(db: SQLiteDatabase, deckId?: string): Promise<number> {
  const { start, end } = todayBounds();
  if (deckId) {
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM study_log sl
       JOIN study_cards sc ON sc.id = sl.card_id
       WHERE sc.deck_id = ? AND sc.deleted_at IS NULL AND sl.reviewed_at >= ? AND sl.reviewed_at < ?`,
      [deckId, start, end]
    );
    return row?.count ?? 0;
  }

  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
       FROM study_log sl
       JOIN study_cards sc ON sc.id = sl.card_id
      WHERE sc.deleted_at IS NULL
        AND sl.reviewed_at >= ? AND sl.reviewed_at < ?`,
    [start, end]
  );
  return row?.count ?? 0;
}

export async function getRemainingReviewLimit(
  db: SQLiteDatabase,
  deckId: string | undefined,
  limit: number
): Promise<number> {
  return Math.max(0, clampReviewLimit(limit) - await getTodayReviewedCount(db, deckId));
}

export async function getTodayDueCount(
  db: SQLiteDatabase,
  deckId: string | undefined,
  settingsOrLimit: DeckReviewSettings | number
): Promise<number> {
  const settings = typeof settingsOrLimit === "number"
    ? normalizeDeckReviewSettings({ dailyReviewLimit: settingsOrLimit })
    : normalizeDeckReviewSettings(settingsOrLimit);
  const remaining = await getRemainingReviewLimit(db, deckId, settings.dailyReviewLimit);
  if (remaining <= 0) return 0;
  return (await getDueCardsForReview(db, deckId, reviewQueueOptionsFromSettings(settings, remaining))).length;
}

export async function getDueCount(db: SQLiteDatabase, deckId?: string): Promise<number> {
  const now = new Date().toISOString();
  if (isSmartDeckId(deckId)) {
    return (await getSmartDeckStats(db, deckId)).due;
  }
  if (deckId) {
    const rows = await db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE deck_id = ? AND due <= ? AND ${REVIEWABLE_CARD_SQL}`,
      [deckId, now, now]
    );
    return (await filterStudyRowsByDefaultDeckFilter(db, rows)).length;
  }
  const [nonSmartRow, smartRows] = await Promise.all([
    db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE due <= ? AND ${NON_SMART_CARD_SQL} AND ${REVIEWABLE_CARD_SQL}`,
      [now, now]
    ),
    getFilteredSmartMaterializedRows(db),
  ]);
  const nonSmartRows = await filterStudyRowsByDefaultDeckFilter(db, nonSmartRow);
  return nonSmartRows.length + smartRows.filter((row) => row.due <= now && isReviewableCard(row, now)).length;
}

export async function getDeckTodayStats(
  db: SQLiteDatabase,
  deckId: string,
  settingsOrLimit: DeckReviewSettings | number
): Promise<{ total: number; dueCount: number; newCount: number }> {
  const settings = typeof settingsOrLimit === "number"
    ? normalizeDeckReviewSettings({ dailyReviewLimit: settingsOrLimit })
    : normalizeDeckReviewSettings(settingsOrLimit);
  const remaining = await getRemainingReviewLimit(db, deckId, settings.dailyReviewLimit);
  if (remaining <= 0) {
    return { total: await getTotalCardCount(db, deckId), dueCount: 0, newCount: 0 };
  }

  if (isSmartDeckId(deckId)) {
    const stats = await getSmartDeckTodayStats(db, deckId, reviewQueueOptionsFromSettings(settings, remaining));
    return { total: stats.total, dueCount: stats.due, newCount: stats.newCount };
  }

  const [total, rows] = await Promise.all([
    getTotalCardCount(db, deckId),
    getDueCardsForReview(db, deckId, reviewQueueOptionsFromSettings(settings, remaining)),
  ]);
  return {
    total,
    dueCount: rows.filter((row) => row.state !== 0).length,
    newCount: rows.filter((row) => row.state === 0).length,
  };
}

export async function getTotalCardCount(db: SQLiteDatabase, deckId?: string): Promise<number> {
  if (isSmartDeckId(deckId)) {
    return (await getSmartDeckStats(db, deckId)).total;
  }
  if (deckId) {
    const rows = await db.getAllAsync<StudyCardRow>(
      "SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL",
      [deckId]
    );
    return (await filterStudyRowsByDefaultDeckFilter(db, rows)).length;
  }
  const [nonSmartRow, smartRows] = await Promise.all([
    db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE deleted_at IS NULL AND ${NON_SMART_CARD_SQL}`,
      []
    ),
    getFilteredSmartMaterializedRows(db),
  ]);
  const nonSmartRows = await filterStudyRowsByDefaultDeckFilter(db, nonSmartRow);
  return nonSmartRows.length + smartRows.length;
}

async function getFilteredSmartMaterializedRows(db: SQLiteDatabase): Promise<StudyCardRow[]> {
  const rows = await db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards WHERE deleted_at IS NULL AND ${SMART_CARD_SQL}`,
    []
  );
  const matchingSmartIds = await getAllMatchingSmartCardIdSet(db);
  return rows.map(rowWithDefaultStatus).filter((row) => matchingSmartIds.has(row.id));
}

export async function getTotalAyahCardCount(db: SQLiteDatabase): Promise<number> {
  await migrateLegacyRetentionDecks(db);
  const rows = await db.getAllAsync<StudyCardRow>(
    `SELECT *
      FROM study_cards
      WHERE deleted_at IS NULL
        AND id NOT LIKE 'word:%'
        AND (${NON_SMART_CARD_SQL} OR deck_id = ?)`,
    [SMART_DECK_IDS.retention]
  );
  return (await filterStudyRowsByDefaultDeckFilter(db, rows)).length;
}

export async function getMemorizedAyahCardCount(db: SQLiteDatabase): Promise<number> {
  await migrateLegacyRetentionDecks(db);
  const rows = await db.getAllAsync<StudyCardRow>(
    `SELECT *
      FROM study_cards
      WHERE deleted_at IS NULL
        AND (reps > 0 OR last_review IS NOT NULL)
        AND id NOT LIKE 'word:%'
        AND (${NON_SMART_CARD_SQL} OR deck_id = ?)`,
    [SMART_DECK_IDS.retention]
  );
  return (await filterStudyRowsByDefaultDeckFilter(db, rows)).length;
}

export async function getNewCount(db: SQLiteDatabase, deckId?: string): Promise<number> {
  if (isSmartDeckId(deckId)) {
    return (await getSmartDeckStats(db, deckId)).newCount;
  }
  if (deckId) {
    const now = new Date().toISOString();
    const rows = await db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE deck_id = ? AND state = 0 AND ${REVIEWABLE_CARD_SQL}`,
      [deckId, now]
    );
    return (await filterStudyRowsByDefaultDeckFilter(db, rows)).length;
  }
  const now = new Date().toISOString();
  const [nonSmartRow, smartRows] = await Promise.all([
    db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE state = 0 AND ${NON_SMART_CARD_SQL} AND ${REVIEWABLE_CARD_SQL}`,
      [now]
    ),
    getFilteredSmartMaterializedRows(db),
  ]);
  const nonSmartRows = await filterStudyRowsByDefaultDeckFilter(db, nonSmartRow);
  return nonSmartRows.length + smartRows.filter((row) => row.state === 0 && isReviewableCard(row, now)).length;
}

async function ensureStudyCardRow(
  db: SQLiteDatabase,
  deckId: string,
  cardId: string
): Promise<StudyCardRow> {
  const existing = await db.getFirstAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE id = ? AND deck_id = ? AND deleted_at IS NULL",
    [cardId, deckId]
  );
  if (existing) return rowWithDefaultStatus(existing);

  const now = new Date();
  const nowIso = now.toISOString();
  const emptyCard = createEmptyCard(now);
  const row: StudyCardRow = {
    id: cardId,
    deck_id: deckId,
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
    suspended_at: null,
    buried_until: null,
    marked_at: null,
    created_at: nowIso,
    updated_at: nowIso,
    deleted_at: null,
  };

  await db.runAsync(
    `INSERT INTO study_cards
      (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
       reps, lapses, state, last_review, suspended_at, buried_until, marked_at, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
      deck_id = excluded.deck_id,
      due = excluded.due,
      stability = excluded.stability,
      difficulty = excluded.difficulty,
      elapsed_days = excluded.elapsed_days,
      scheduled_days = excluded.scheduled_days,
      learning_steps = excluded.learning_steps,
      reps = excluded.reps,
      lapses = excluded.lapses,
      state = excluded.state,
      last_review = excluded.last_review,
      suspended_at = excluded.suspended_at,
      buried_until = excluded.buried_until,
      marked_at = excluded.marked_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      deleted_at = NULL
     WHERE study_cards.deleted_at IS NOT NULL`,
    [
      row.id,
      row.deck_id,
      row.due,
      row.stability,
      row.difficulty,
      row.elapsed_days,
      row.scheduled_days,
      row.learning_steps,
      row.reps,
      row.lapses,
      row.state,
      row.last_review,
      row.suspended_at,
      row.buried_until,
      row.marked_at,
      row.created_at,
      row.updated_at,
    ]
  );
  enqueueSync(db, "study_cards", "INSERT", cardId, cardToSyncData(row)).catch(console.warn);
  return row;
}

export async function deleteStudyCard(
  db: SQLiteDatabase,
  deckId: string,
  cardId: string
): Promise<void> {
  const row = await db.getFirstAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE id = ? AND deck_id = ? AND deleted_at IS NULL",
    [cardId, deckId]
  );
  const deletedAt = new Date().toISOString();
  const result = await db.runAsync(
    "UPDATE study_cards SET updated_at = ?, deleted_at = ? WHERE id = ? AND deck_id = ? AND deleted_at IS NULL",
    [deletedAt, deletedAt, cardId, deckId]
  );
  if ((result.changes ?? 0) > 0) {
    enqueueSync(db, "study_cards", "DELETE", cardId, row ? {
      ...cardToSyncData(rowWithDefaultStatus(row)),
      updated_at: deletedAt,
      deleted_at: deletedAt,
    } : { id: cardId, updated_at: deletedAt, deleted_at: deletedAt }).catch(console.warn);
  }
}

export async function setStudyCardSuspended(
  db: SQLiteDatabase,
  deckId: string,
  cardId: string,
  suspended: boolean
): Promise<StudyCardRow> {
  const row = await ensureStudyCardRow(db, deckId, cardId);
  const now = new Date().toISOString();
  const updated = {
    ...row,
    suspended_at: suspended ? now : null,
    buried_until: suspended ? null : row.buried_until,
    updated_at: now,
  };
  await updateCard(db, updated);
  return updated;
}

export async function setStudyCardBuried(
  db: SQLiteDatabase,
  deckId: string,
  cardId: string,
  buried: boolean
): Promise<StudyCardRow> {
  const row = await ensureStudyCardRow(db, deckId, cardId);
  const now = new Date().toISOString();
  const updated = {
    ...row,
    buried_until: buried ? localStartOfTomorrow().toISOString() : null,
    updated_at: now,
  };
  await updateCard(db, updated);
  return updated;
}

export async function setStudyCardMarked(
  db: SQLiteDatabase,
  deckId: string,
  cardId: string,
  marked: boolean
): Promise<StudyCardRow> {
  const row = await ensureStudyCardRow(db, deckId, cardId);
  const now = new Date().toISOString();
  const updated = {
    ...row,
    marked_at: marked ? now : null,
    updated_at: now,
  };
  await updateCard(db, updated);
  return updated;
}

export async function resetStudyCardProgress(
  db: SQLiteDatabase,
  deckId: string,
  cardId: string
): Promise<StudyCardRow> {
  const row = await ensureStudyCardRow(db, deckId, cardId);
  const now = new Date();
  const emptyCard = createEmptyCard(now);
  const updated = {
    ...row,
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
    updated_at: now.toISOString(),
  };
  await updateCard(db, updated);
  return updated;
}

export async function setStudyCardDueDate(
  db: SQLiteDatabase,
  deckId: string,
  cardId: string,
  dueDate: Date
): Promise<StudyCardRow> {
  const row = await ensureStudyCardRow(db, deckId, cardId);
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(dueDate);
  target.setHours(0, 0, 0, 0);
  const scheduledDays = dayDiffLocal(today, target);
  const due = scheduledDays === 0 ? now : target;
  const updated = {
    ...row,
    due: due.toISOString(),
    scheduled_days: scheduledDays,
    suspended_at: null,
    buried_until: null,
    updated_at: now.toISOString(),
  };
  await updateCard(db, updated);
  return updated;
}

export async function getNextEligibleReviewDate(db: SQLiteDatabase): Promise<string | null> {
  const rows = await db.getAllAsync<StudyCardRow>(
    `SELECT *
       FROM study_cards
      WHERE deleted_at IS NULL
        AND suspended_at IS NULL
      ORDER BY due ASC`
  );
  const matchingSmartIds = await getAllMatchingSmartCardIdSet(db);
  const nonSmartRows = await filterStudyRowsByDefaultDeckFilter(
    db,
    rows.filter((row) => !isSmartDeckId(row.deck_id))
  );
  const smartRows = rows.filter((row) => isSmartDeckId(row.deck_id) && matchingSmartIds.has(row.id));
  const [next] = [...nonSmartRows, ...smartRows].sort((a, b) =>
    getReviewEligibleAt(a).localeCompare(getReviewEligibleAt(b))
  );
  return next ? getReviewEligibleAt(next) : null;
}

function getReviewEligibleAt(row: StudyCardRow): string {
  return row.buried_until && row.buried_until > row.due ? row.buried_until : row.due;
}

export async function getDeckCardsForList(
  db: SQLiteDatabase,
  deckId: string
): Promise<DeckCardListItem[]> {
  if (isSmartDeckId(deckId)) {
    if (deckId === SMART_DECK_IDS.retention) {
      await migrateLegacyRetentionDecks(db);
    }
    const [candidateIds, existingRows] = await Promise.all([
      getSmartDeckCandidateCardIds(db, deckId),
      db.getAllAsync<StudyCardRow>("SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL", [deckId]),
    ]);
    const rowById = new Map(existingRows.map((row) => [row.id, rowWithDefaultStatus(row)]));
    const now = new Date();
    const emptyCard = createEmptyCard(now);
    const nowIso = now.toISOString();
    const items: DeckCardListItem[] = [];
    for (const id of candidateIds) {
      const row = rowById.get(id) ?? {
        id,
        deck_id: deckId,
        due: nowIso,
        stability: emptyCard.stability,
        difficulty: emptyCard.difficulty,
        elapsed_days: emptyCard.elapsed_days,
        scheduled_days: emptyCard.scheduled_days,
        learning_steps: emptyCard.learning_steps,
        reps: emptyCard.reps,
        lapses: emptyCard.lapses,
        state: emptyCard.state,
        last_review: null,
        suspended_at: null,
        buried_until: null,
        marked_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      items.push(await decorateDeckCardListItem(db, row, !rowById.has(id)));
    }
    return items;
  }

  const rows = await db.getAllAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC",
    [deckId]
  );
  const filteredRows = await filterStudyRowsByDefaultDeckFilter(db, rows);
  const items: DeckCardListItem[] = [];
  for (const row of filteredRows) {
    items.push(await decorateDeckCardListItem(db, rowWithDefaultStatus(row), false));
  }
  return items;
}

async function decorateDeckCardListItem(
  db: SQLiteDatabase,
  row: StudyCardRow,
  isVirtual: boolean
): Promise<DeckCardListItem> {
  const normalizedRow = rowWithDefaultStatus(row);
  const smartContent = await getSmartCardContent(db, normalizedRow.id);
  if (smartContent?.targetRef) {
    const ref = smartContent.targetRef;
    const reference = `${ref.surah}:${ref.ayah}`;
    const title = `${reference} · ${ref.surahNameEn}`;
    const preview = smartContent.promptUthmani ?? smartContent.asbabOccasions?.[0] ?? smartContent.cue ?? ref.textUthmani;
    const searchText = [
      normalizedRow.id,
      reference,
      ref.surahNameAr,
      ref.surahNameEn,
      ref.textUthmani,
      ref.textClean,
      smartContent.cue,
      smartContent.promptUthmani,
      smartContent.hiddenAnswerUthmani,
      smartContent.qiraatText,
      ...(smartContent.qiraatGroup ?? []),
      ...(smartContent.asbabOccasions ?? []),
      ...(smartContent.asbabGroup ?? []),
    ].filter(Boolean).join(" ");
    return {
      ...normalizedRow,
      reference,
      title,
      subtitle: ref.surahNameAr,
      preview,
      searchText,
      kind: "smart",
      isVirtual,
    };
  }

  const parsed = parseStudyCardId(normalizedRow.id);
  if (!parsed) {
    return {
      ...normalizedRow,
      reference: normalizedRow.id,
      title: normalizedRow.id,
      subtitle: normalizedRow.deck_id,
      preview: "",
      searchText: `${normalizedRow.id} ${normalizedRow.deck_id}`,
      kind: "ayah",
      isVirtual,
    };
  }

  const [ayahRow, surahRow, translationRow] = await Promise.all([
    db.getFirstAsync<{ text_uthmani: string; text_search: string | null }>(
      "SELECT text_uthmani, text_search FROM quran_text WHERE surah = ? AND ayah = ?",
      [parsed.surah, parsed.ayah]
    ),
    db.getFirstAsync<{ name_arabic: string; name_english: string }>(
      "SELECT name_arabic, name_english FROM surahs WHERE number = ?",
      [parsed.surah]
    ),
    db.getFirstAsync<{ text_en: string }>(
      "SELECT text_en FROM translations WHERE surah = ? AND ayah = ?",
      [parsed.surah, parsed.ayah]
    ),
  ]);

  if (parsed.kind === "word" && parsed.wordPos) {
    const [wordRow, wordMeaningRow, wordIrabRow] = await Promise.all([
      db.getFirstAsync<{ word_arabic: string | null; translation_en: string | null }>(
        "SELECT word_arabic, translation_en FROM word_translations WHERE surah = ? AND ayah = ? AND word_pos = ?",
        [parsed.surah, parsed.ayah, parsed.wordPos]
      ),
      db.getFirstAsync<{ word: string | null; meaning: string | null }>(
        `SELECT
           COALESCE(NULLIF(base.word, ''), custom.word) AS word,
           CASE
             WHEN base.meaning IS NOT NULL AND TRIM(base.meaning) != '' THEN base.meaning
             ELSE custom.meaning
           END AS meaning
         FROM (SELECT ? AS surah, ? AS ayah, ? AS word_pos) key
         LEFT JOIN word_meanings_ar base
           ON base.surah = key.surah AND base.ayah = key.ayah AND base.word_pos = key.word_pos
         LEFT JOIN user_word_meanings custom
           ON custom.surah = key.surah AND custom.ayah = key.ayah AND custom.word_pos = key.word_pos`,
        [parsed.surah, parsed.ayah, parsed.wordPos]
      ),
      db.getFirstAsync<{ arabic_word: string | null }>(
        "SELECT arabic_word FROM word_irab WHERE surah = ? AND ayah = ? AND word_pos = ?",
        [parsed.surah, parsed.ayah, parsed.wordPos]
      ),
    ]);
    const reference = `${parsed.surah}:${parsed.ayah}:${parsed.wordPos}`;
    const word = wordIrabRow?.arabic_word ?? wordMeaningRow?.word ?? wordRow?.word_arabic ?? reference;
    const preview = wordMeaningRow?.meaning ?? wordRow?.translation_en ?? ayahRow?.text_uthmani ?? "";
    const searchText = [
      normalizedRow.id,
      reference,
      word,
      preview,
      wordRow?.translation_en,
      wordMeaningRow?.meaning,
      surahRow?.name_arabic,
      surahRow?.name_english,
      ayahRow?.text_uthmani,
      ayahRow?.text_search,
      translationRow?.text_en,
    ].filter(Boolean).join(" ");
    return {
      ...normalizedRow,
      reference,
      title: word,
      subtitle: `${surahRow?.name_english ?? parsed.surah} · ${parsed.surah}:${parsed.ayah}`,
      preview,
      searchText,
      kind: "word",
      isVirtual,
    };
  }

  const reference = `${parsed.surah}:${parsed.ayah}`;
  const preview = ayahRow?.text_uthmani ?? "";
  const searchText = [
    normalizedRow.id,
    reference,
    surahRow?.name_arabic,
    surahRow?.name_english,
    ayahRow?.text_uthmani,
    ayahRow?.text_search,
    translationRow?.text_en,
  ].filter(Boolean).join(" ");
  return {
    ...normalizedRow,
    reference,
    title: reference,
    subtitle: surahRow?.name_english ?? "",
    preview,
    searchText,
    kind: "ayah",
    isVirtual,
  };
}

function parseStudyCardId(cardId: string): { kind: "ayah" | "word"; surah: number; ayah: number; wordPos?: number } | null {
  const parts = cardId.split(":");
  if (parts[0] === "word" && parts.length >= 4) {
    const surah = parseInt(parts[1], 10);
    const ayah = parseInt(parts[2], 10);
    const wordPos = parseInt(parts[3], 10);
    return Number.isFinite(surah) && Number.isFinite(ayah) && Number.isFinite(wordPos)
      ? { kind: "word", surah, ayah, wordPos }
      : null;
  }
  if (parts.length >= 2) {
    const surah = parseInt(parts[0], 10);
    const ayah = parseInt(parts[1], 10);
    return Number.isFinite(surah) && Number.isFinite(ayah) ? { kind: "ayah", surah, ayah } : null;
  }
  return null;
}

export async function updateCard(db: SQLiteDatabase, card: StudyCardRow): Promise<void> {
  await db.runAsync(
    `UPDATE study_cards SET
      due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
      learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ?,
      suspended_at = ?, buried_until = ?, marked_at = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [
      card.due, card.stability, card.difficulty, card.elapsed_days, card.scheduled_days,
      card.learning_steps, card.reps, card.lapses, card.state, card.last_review,
      card.suspended_at, card.buried_until, card.marked_at, card.updated_at,
      card.id,
    ]
  );

  // Enqueue for sync
  enqueueSync(db, "study_cards", "UPDATE", card.id, cardToSyncData(card)).catch(console.warn);
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
