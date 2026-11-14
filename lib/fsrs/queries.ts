import { buildLocalReviewCounts, calculateLongestStreak } from "@/lib/fsrs/review-activity";
import { StudyCardDeletedError } from "@/lib/fsrs/card-errors";
import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { createEmptyCard, type Card } from "./scheduler";
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
import { compareSyncTimestamps } from "@/lib/database/sync-timestamps";
import { putUserSetting, writeUserSetting } from "@/lib/database/user-settings";
import {
  dayDiffLocal,
  dayIndexFromLocalDateKey as dayIndexFromDateKey,
  formatLocalDateKey,
  localStartOfTomorrow,
  todayBounds,
} from "@/lib/date";
import { emitReviewActivity } from "./review-events";
import { reviewDueCutoff } from "./review-transition";
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
  materializeSmartDeckCards,
  migrateLegacyRetentionDecks,
  SMART_DECK_IDS,
  type DueCardsForReviewOptions,
} from "./smart-decks";
import { formatAyahRef, toArabicNumber } from "@/lib/arabic";
import { deviceTimeZone, localDateOf } from "@/lib/habit/dates";
import type { Grader } from "@/lib/hifz/grading";

type ReviewActivityDay = { date: string; count: number };

type ReviewStats = {
  activity: ReviewActivityDay[];
  activeDays: number;
  totalReviews: number;
  averageDailyReviews: number;
  longestStreak: number;
};

const SMART_CARD_SQL = `deck_id IN (${Object.values(SMART_DECK_IDS).map((id) => `'${id}'`).join(", ")})`;
const NON_SMART_CARD_SQL = `NOT ${SMART_CARD_SQL}`;
const ACTIVE_CARD_SQL = "deleted_at IS NULL";
const REVIEWABLE_CARD_SQL = `${ACTIVE_CARD_SQL} AND suspended_at IS NULL AND (buried_until IS NULL OR buried_until <= ?)`;

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
    // Only page cards carry a tier; leaving the keys out keeps other cards' uploads unchanged.
    ...(card.tier ? { tier: card.tier, tier_changed_at: card.tier_changed_at ?? null } : {}),
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

async function readLegacyReviewSettings(db: DatabaseExecutor): Promise<DeckReviewSettings> {
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
  db: DatabaseExecutor,
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
  db: AppDatabase,
  deckId: string,
  settings: Partial<DeckReviewSettings>
): Promise<void> {
  const normalized = normalizeDeckReviewSettings(settings);
  await writeUserSetting(db, deckReviewSettingsKey(deckId), JSON.stringify(normalized));
}

function meaningCardId(surah: number, ayah: number, wordPos: number): string {
  return `word:${surah}:${ayah}:${wordPos}`;
}

export async function isMeaningCardSaved(
  db: DatabaseExecutor,
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
  db: AppDatabase,
  surah: number,
  ayah: number,
  wordPos: number
): Promise<{ created: boolean }> {
  const now = new Date().toISOString();
  const emptyCard = createEmptyCard();
  const cardId = meaningCardId(surah, ayah, wordPos);

  let created = false;
  // The deck setting, the card and their queued uploads commit together or not at all.
  await db.withTransactionAsync(async (tx) => {
    created = await insertMeaningCardRows(tx, cardId, now, emptyCard);
  });

  if (created) {
    // The badge is a side effect of a saved card; its failure must not fail the save.
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

async function insertMeaningCardRows(
  db: DatabaseExecutor,
  cardId: string,
  now: string,
  emptyCard: Card
): Promise<boolean> {
  const existingDeck = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [`deck_${MEANINGS_DECK_ID}`]
  );
  if (!existingDeck) {
    await putUserSetting(db, `deck_${MEANINGS_DECK_ID}`, JSON.stringify({
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
    await enqueueSync(db, "study_cards", "INSERT", cardId, {
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
    });
  }
  return created;
}

// ─── Query helpers ───────────────────────────────────────────

/**
 * Cards studied today. A card counts once however many learning steps or Again presses it took, so
 * learning one new card does not use up several places in the daily limit.
 */
async function getTodayReviewedCount(db: DatabaseExecutor, deckId?: string): Promise<number> {
  const { start, end } = todayBounds();
  if (deckId) {
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(DISTINCT sl.card_id) as count
       FROM study_log sl
       JOIN study_cards sc ON sc.id = sl.card_id
       WHERE sc.deck_id = ? AND sc.deleted_at IS NULL AND sl.reviewed_at >= ? AND sl.reviewed_at < ?`,
      [deckId, start, end]
    );
    return row?.count ?? 0;
  }

  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(DISTINCT sl.card_id) as count
       FROM study_log sl
       JOIN study_cards sc ON sc.id = sl.card_id
      WHERE sc.deleted_at IS NULL
        AND sl.reviewed_at >= ? AND sl.reviewed_at < ?`,
    [start, end]
  );
  return row?.count ?? 0;
}

export async function getRemainingReviewLimit(
  db: DatabaseExecutor,
  deckId: string | undefined,
  limit: number
): Promise<number> {
  return Math.max(0, clampReviewLimit(limit) - await getTodayReviewedCount(db, deckId));
}

/** New cards of a deck first studied today: a log row written while the card was still new. */
async function getTodayIntroducedNewCount(db: DatabaseExecutor, deckId: string): Promise<number> {
  const { start, end } = todayBounds();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(DISTINCT sl.card_id) as count
       FROM study_log sl
       JOIN study_cards sc ON sc.id = sl.card_id
      WHERE sc.deck_id = ? AND sc.deleted_at IS NULL AND sl.state = 0
        AND sl.reviewed_at >= ? AND sl.reviewed_at < ?`,
    [deckId, start, end]
  );
  return row?.count ?? 0;
}

type DeckQueueOptions = Exclude<DueCardsForReviewOptions, number> & { limit: number; newCardsLimit: number };

/**
 * One deck's queue options for the rest of today: its review limit less the cards studied today and
 * its new-card limit less the new cards introduced today, so neither limit restarts with each
 * session. Null once the daily review limit is used up.
 */
async function getDeckQueueOptions(
  db: DatabaseExecutor,
  deckId: string,
  settings: DeckReviewSettings
): Promise<DeckQueueOptions | null> {
  const limit = await getRemainingReviewLimit(db, deckId, settings.dailyReviewLimit);
  if (limit <= 0) return null;
  return {
    limit,
    newCardsLimit: Math.max(0, settings.newCardsLimit - await getTodayIntroducedNewCount(db, deckId)),
    newReviewOrder: settings.newReviewOrder,
    reviewSortOrder: settings.reviewSortOrder,
    newCardSortOrder: settings.newCardSortOrder,
  };
}

export type ReviewQueueItem = { card: StudyCardRow; settings: DeckReviewSettings };

/** The decks Home lists, in its order. Review all and the Home due headline cover exactly these. */
export const REVIEW_DECK_IDS: readonly string[] = [...Object.values(SMART_DECK_IDS), MEANINGS_DECK_ID];

/**
 * The cards a review session loads, each paired with its own deck's review settings, so grading,
 * interval previews and test modes follow the card's deck in Review all as in a single deck. Review
 * all is every deck's own queue in turn, with that deck's limits, so it offers what the deck rows
 * count, including new smart-deck cards that have no row yet.
 */
export async function loadReviewQueue(db: AppDatabase, deckId?: string): Promise<ReviewQueueItem[]> {
  if (!deckId) {
    const queue: ReviewQueueItem[] = [];
    for (const id of REVIEW_DECK_IDS) queue.push(...await loadReviewQueue(db, id));
    return queue;
  }
  const settings = await readDeckReviewSettings(db, deckId);
  const options = await getDeckQueueOptions(db, deckId, settings);
  if (!options) return [];
  if (isSmartDeckId(deckId)) {
    await materializeSmartDeckCards(db, deckId, options.limit, options.newCardsLimit);
  }
  const rows = await getDueCardsForReview(db, deckId, options);
  return rows.map((card) => ({ card, settings }));
}

export async function getDueCount(db: AppDatabase, deckId?: string): Promise<number> {
  const now = new Date().toISOString();
  const dueCutoff = reviewDueCutoff();
  if (isSmartDeckId(deckId)) {
    return (await getSmartDeckStats(db, deckId)).due;
  }
  if (deckId) {
    const rows = await db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE deck_id = ? AND due <= ? AND ${REVIEWABLE_CARD_SQL}`,
      [deckId, dueCutoff, now]
    );
    return (await filterStudyRowsByDefaultDeckFilter(db, rows)).length;
  }
  const [nonSmartRow, smartRows] = await Promise.all([
    db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE due <= ? AND ${NON_SMART_CARD_SQL} AND ${REVIEWABLE_CARD_SQL}`,
      [dueCutoff, now]
    ),
    getFilteredSmartMaterializedRows(db),
  ]);
  const nonSmartRows = await filterStudyRowsByDefaultDeckFilter(db, nonSmartRow);
  return nonSmartRows.length + smartRows.filter((row) => row.due <= dueCutoff && isReviewableCard(row, now)).length;
}

export async function getDeckTodayStats(
  db: AppDatabase,
  deckId: string,
  settingsOrLimit: DeckReviewSettings | number
): Promise<{ total: number; dueCount: number; newCount: number }> {
  const settings = typeof settingsOrLimit === "number"
    ? normalizeDeckReviewSettings({ dailyReviewLimit: settingsOrLimit })
    : normalizeDeckReviewSettings(settingsOrLimit);
  const options = await getDeckQueueOptions(db, deckId, settings);
  if (!options) {
    return { total: await getTotalCardCount(db, deckId), dueCount: 0, newCount: 0 };
  }

  if (isSmartDeckId(deckId)) {
    const stats = await getSmartDeckTodayStats(db, deckId, options);
    return { total: stats.total, dueCount: stats.due, newCount: stats.newCount };
  }

  const [total, rows] = await Promise.all([
    getTotalCardCount(db, deckId),
    getDueCardsForReview(db, deckId, options),
  ]);
  return {
    total,
    dueCount: rows.filter((row) => row.state !== 0).length,
    newCount: rows.filter((row) => row.state === 0).length,
  };
}

export async function getTotalCardCount(db: AppDatabase, deckId?: string): Promise<number> {
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

async function getFilteredSmartMaterializedRows(db: DatabaseExecutor): Promise<StudyCardRow[]> {
  const rows = await db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards WHERE deleted_at IS NULL AND ${SMART_CARD_SQL}`,
    []
  );
  const matchingSmartIds = await getAllMatchingSmartCardIdSet(db);
  return rows.map(rowWithDefaultStatus).filter((row) => matchingSmartIds.has(row.id));
}

export async function getTotalAyahCardCount(db: AppDatabase): Promise<number> {
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

export async function getMemorizedAyahCardCount(db: AppDatabase): Promise<number> {
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

export async function getNewCount(db: AppDatabase, deckId?: string): Promise<number> {
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

/**
 * requireLive: the caller acted on a card it loaded as a live row, such as a session card. If that
 * row is gone or deleted the action fails instead of creating or reviving the card. Without it, an
 * action on a virtual smart-deck card creates the row and may revive an earlier deletion.
 */
export type CardActionOptions = { requireLive?: boolean };

async function ensureStudyCardRow(
  db: DatabaseExecutor,
  deckId: string,
  cardId: string,
  requireLive: boolean
): Promise<StudyCardRow> {
  // A card id is global, so a live card in another deck is the same card: keep its progress
  // instead of creating an empty card that would overwrite it locally and on the server.
  const existing = await db.getFirstAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE id = ? AND deleted_at IS NULL",
    [cardId]
  );
  if (existing) return rowWithDefaultStatus(existing);
  if (requireLive) throw new StudyCardDeletedError();

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
  await enqueueSync(db, "study_cards", "INSERT", cardId, cardToSyncData(row));
  return row;
}

/** Delete a card. The tombstone and its queued upload commit together or not at all. */
export async function deleteStudyCard(database: AppDatabase, deckId: string, cardId: string): Promise<void> {
  await database.withTransactionAsync((db) => deleteStudyCardRow(db, deckId, cardId));
}

/**
 * An ISO instant later than `now` and every given stamp, so a write made now supersedes all of them.
 * Card writes stamp past the version they replace: a version stamped by a clock running ahead
 * (another device's deletion, or a restore after it) must not make this device's later grades look
 * older and lose to it in sync. Review times (reviewed_at, last_review, due) stay the real ones.
 */
function laterThanAll(now: Date, stamps: readonly (string | null | undefined)[]): string {
  let at = now.toISOString();
  for (const stamp of stamps) {
    if (!stamp || compareSyncTimestamps(stamp, at) < 0) continue;
    const next = Date.parse(stamp) + 1;
    if (Number.isFinite(next)) at = new Date(next).toISOString();
  }
  return at;
}

/** Soft-delete a card with its upload queued, using the caller's executor (inside its transaction). */
export async function deleteStudyCardRow(db: DatabaseExecutor, deckId: string, cardId: string): Promise<void> {
  const row = await db.getFirstAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE id = ? AND deck_id = ? AND deleted_at IS NULL",
    [cardId, deckId]
  );
  const deletedAt = laterThanAll(new Date(), [row?.updated_at]);
  const result = await db.runAsync(
    "UPDATE study_cards SET updated_at = ?, deleted_at = ? WHERE id = ? AND deck_id = ? AND deleted_at IS NULL",
    [deletedAt, deletedAt, cardId, deckId]
  );
  if ((result.changes ?? 0) > 0) {
    await enqueueSync(db, "study_cards", "DELETE", cardId, row ? {
      ...cardToSyncData(rowWithDefaultStatus(row)),
      updated_at: deletedAt,
      deleted_at: deletedAt,
    } : { id: cardId, updated_at: deletedAt, deleted_at: deletedAt });
  }
}

export async function setStudyCardSuspended(
  db: AppDatabase,
  deckId: string,
  cardId: string,
  suspended: boolean,
  options: CardActionOptions = {}
): Promise<StudyCardRow> {
  return updateStudyCardInTransaction(db, deckId, cardId, options, (row) => {
    const now = new Date().toISOString();
    const updated = {
      ...row,
      suspended_at: suspended ? now : null,
      buried_until: suspended ? null : row.buried_until,
      updated_at: now,
    };
    return updated;
  });
}

export async function setStudyCardBuried(
  db: AppDatabase,
  deckId: string,
  cardId: string,
  buried: boolean,
  options: CardActionOptions = {}
): Promise<StudyCardRow> {
  return updateStudyCardInTransaction(db, deckId, cardId, options, (row) => {
    const now = new Date().toISOString();
    const updated = {
      ...row,
      buried_until: buried ? localStartOfTomorrow().toISOString() : null,
      updated_at: now,
    };
    return updated;
  });
}

export async function setStudyCardMarked(
  db: AppDatabase,
  deckId: string,
  cardId: string,
  marked: boolean,
  options: CardActionOptions = {}
): Promise<StudyCardRow> {
  return updateStudyCardInTransaction(db, deckId, cardId, options, (row) => {
    const now = new Date().toISOString();
    const updated = {
      ...row,
      marked_at: marked ? now : null,
      updated_at: now,
    };
    return updated;
  });
}

export async function resetStudyCardProgress(
  db: AppDatabase,
  deckId: string,
  cardId: string,
  options: CardActionOptions = {}
): Promise<StudyCardRow> {
  return updateStudyCardInTransaction(db, deckId, cardId, options, (row) => {
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
    return updated;
  });
}

export async function setStudyCardDueDate(
  db: AppDatabase,
  deckId: string,
  cardId: string,
  dueDate: Date,
  options: CardActionOptions = {}
): Promise<StudyCardRow> {
  return updateStudyCardInTransaction(db, deckId, cardId, options, (row) => {
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
    return updated;
  });
}

export async function getNextEligibleReviewDate(db: DatabaseExecutor): Promise<string | null> {
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
  db: AppDatabase,
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
    const ayahLookup = await loadAyahListLookup(db, candidateIds);
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
      items.push(await decorateDeckCardListItem(db, row, !rowById.has(id), ayahLookup));
    }
    return items;
  }

  const rows = await db.getAllAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC",
    [deckId]
  );
  const filteredRows = await filterStudyRowsByDefaultDeckFilter(db, rows);
  const items: DeckCardListItem[] = [];
  const ayahLookup = await loadAyahListLookup(db, filteredRows.map((row) => row.id));
  for (const row of filteredRows) {
    items.push(await decorateDeckCardListItem(db, rowWithDefaultStatus(row), false, ayahLookup));
  }
  return items;
}

type AyahListInfo = {
  text_uthmani: string;
  text_search: string | null;
  name_arabic: string;
  name_english: string;
  text_en: string | null;
};

/**
 * Ayah text, surah names and translation for every ayah, in one query. The retention deck lists up
 * to 6,236 ayah cards, and three single-row queries per card on the serialized connection kept the
 * card list loading for many seconds. Loaded only when the list holds ayah cards.
 */
async function loadAyahListLookup(db: DatabaseExecutor, cardIds: string[]): Promise<Map<string, AyahListInfo> | null> {
  if (!cardIds.some((id) => parseStudyCardId(id)?.kind === "ayah")) return null;
  const rows = await db.getAllAsync<AyahListInfo & { surah: number; ayah: number }>(
    `SELECT q.surah, q.ayah, q.text_uthmani, q.text_search, s.name_arabic, s.name_english, t.text_en
       FROM quran_text q
       JOIN surahs s ON s.number = q.surah
       LEFT JOIN translations t ON t.surah = q.surah AND t.ayah = q.ayah`,
  );
  return new Map(rows.map((row) => [`${row.surah}:${row.ayah}`, row]));
}

async function decorateDeckCardListItem(
  db: DatabaseExecutor,
  row: StudyCardRow,
  isVirtual: boolean,
  ayahLookup: Map<string, AyahListInfo> | null = null
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
      titleAr: formatAyahRef(true, ref.surah, ref.ayah),
      subtitleAr: ref.surahNameAr,
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
      titleAr: normalizedRow.id,
      subtitleAr: normalizedRow.deck_id,
      preview: "",
      searchText: `${normalizedRow.id} ${normalizedRow.deck_id}`,
      kind: "ayah",
      isVirtual,
    };
  }

  const cached = parsed.kind === "ayah" ? ayahLookup?.get(`${parsed.surah}:${parsed.ayah}`) : undefined;
  const [ayahRow, surahRow, translationRow] = cached
    ? [cached, cached, cached.text_en == null ? null : { text_en: cached.text_en }]
    : await Promise.all([
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
      titleAr: word,
      subtitleAr: `${surahRow?.name_arabic ?? toArabicNumber(parsed.surah)}، ${formatAyahRef(true, parsed.surah, parsed.ayah)}`,
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
    titleAr: formatAyahRef(true, parsed.surah, parsed.ayah),
    subtitleAr: surahRow?.name_arabic ?? "",
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

/**
 * Create the card row if needed, apply a change and queue both uploads in one transaction, so a
 * queue failure leaves the card as it was.
 */
async function updateStudyCardInTransaction(
  database: AppDatabase,
  deckId: string,
  cardId: string,
  options: CardActionOptions,
  change: (row: StudyCardRow) => StudyCardRow
): Promise<StudyCardRow> {
  let updated: StudyCardRow | null = null;
  await database.withTransactionAsync(async (db) => {
    const next = change(await ensureStudyCardRow(db, deckId, cardId, options.requireLive ?? false));
    await putCardRow(db, next);
    updated = next;
  });
  if (!updated) throw new Error("Study card was not saved.");
  return updated;
}

/**
 * Write a card's scheduling state and queue its upload with the given executor. A card deleted
 * meanwhile, for example by a sync pull, is not revived: the write fails and nothing is queued.
 */
export async function putCardRow(db: DatabaseExecutor, card: StudyCardRow): Promise<void> {
  // A row that carries a tier (page cards) writes it; other callers leave the cached tier alone.
  const writesTier = card.tier !== undefined;
  const stored = await db.getFirstAsync<{ updated_at: string | null }>(
    "SELECT updated_at FROM study_cards WHERE id = ? AND deleted_at IS NULL",
    [card.id],
  );
  const written = Date.parse(card.updated_at);
  const updatedAt = laterThanAll(Number.isFinite(written) ? new Date(written) : new Date(), [stored?.updated_at]);
  const result = await db.runAsync(
    `UPDATE study_cards SET
      due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
      learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ?,
      suspended_at = ?, buried_until = ?, marked_at = ?, updated_at = ?${writesTier ? ", tier = ?, tier_changed_at = ?" : ""}
     WHERE id = ? AND deleted_at IS NULL`,
    [
      card.due, card.stability, card.difficulty, card.elapsed_days, card.scheduled_days,
      card.learning_steps, card.reps, card.lapses, card.state, card.last_review,
      card.suspended_at, card.buried_until, card.marked_at, updatedAt,
      ...(writesTier ? [card.tier ?? null, card.tier_changed_at ?? null] : []),
      card.id,
    ]
  );
  if ((result.changes ?? 0) === 0) throw new StudyCardDeletedError();

  await enqueueSync(db, "study_cards", "UPDATE", card.id, cardToSyncData({ ...card, updated_at: updatedAt }));
}


/**
 * Undoes a card's deletion: it comes back with its schedule and history as they were, so its training
 * is kept. Its updated_at is later than both now and the version it replaces, so a deletion stamped by
 * a clock running ahead of this one does not win over the restore when it uploads. Queues the upload.
 * Returns false when there is no deleted card with this id.
 */
export async function restoreDeletedStudyCard(db: DatabaseExecutor, id: string, now: Date): Promise<boolean> {
  const row = await db.getFirstAsync<StudyCardRow>("SELECT * FROM study_cards WHERE id = ? AND deleted_at IS NOT NULL", [id]);
  if (!row) return false;
  const at = laterThanAll(now, [row.updated_at, row.deleted_at]);
  const result = await db.runAsync("UPDATE study_cards SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL", [
    at,
    id,
  ]);
  if ((result.changes ?? 0) === 0) return false;
  await enqueueSync(db, "study_cards", "UPDATE", id, cardToSyncData(rowWithDefaultStatus({ ...row, deleted_at: null, updated_at: at })));
  return true;
}

/** The row insertNewStudyCard writes, for a caller that grades a card in the transaction that creates it. */
export function newStudyCardRow({
  id,
  deckId,
  due,
  tier = null,
  now,
}: {
  id: string;
  deckId: string;
  due: Date;
  tier?: string | null;
  now: string;
}): StudyCardRow {
  const empty = createEmptyCard(due);
  return {
    id,
    deck_id: deckId,
    due: empty.due.toISOString(),
    stability: empty.stability,
    difficulty: empty.difficulty,
    elapsed_days: empty.elapsed_days,
    scheduled_days: empty.scheduled_days,
    learning_steps: empty.learning_steps,
    reps: empty.reps,
    lapses: empty.lapses,
    state: empty.state,
    last_review: null,
    suspended_at: null,
    buried_until: null,
    marked_at: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    tier,
    tier_changed_at: tier ? now : null,
  };
}

/**
 * Create a new card, or revive a deleted one, with its upload queued, using the caller's executor.
 * Returns false when a live card with this id already exists.
 */
export async function insertNewStudyCard(
  db: DatabaseExecutor,
  { id, deckId, due, tier = null, now }: { id: string; deckId: string; due: Date; tier?: string | null; now: string },
): Promise<boolean> {
  const empty = createEmptyCard(due);
  const result = await db.runAsync(
    `INSERT INTO study_cards
      (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review,
       created_at, updated_at, deleted_at, tier, tier_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
      deck_id = excluded.deck_id, due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty,
      elapsed_days = excluded.elapsed_days, scheduled_days = excluded.scheduled_days, learning_steps = excluded.learning_steps,
      reps = excluded.reps, lapses = excluded.lapses, state = excluded.state, last_review = NULL,
      suspended_at = NULL, buried_until = NULL, marked_at = NULL,
      created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = NULL,
      tier = excluded.tier, tier_changed_at = excluded.tier_changed_at
     WHERE study_cards.deleted_at IS NOT NULL`,
    [
      id, deckId, empty.due.toISOString(), empty.stability, empty.difficulty, empty.elapsed_days, empty.scheduled_days,
      empty.learning_steps, empty.reps, empty.lapses, empty.state, now, now, tier, tier ? now : null,
    ]
  );
  if ((result.changes ?? 0) === 0) return false;
  const row = newStudyCardRow({ id, deckId, due, tier, now });
  await enqueueSync(db, "study_cards", "INSERT", id, cardToSyncData(row));
  return true;
}

export type StudyLogInput = {
  cardId: string;
  rating: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reviewedAt: string;
  /** The review session, when the review came from one. */
  sessionId?: string | null;
  /** Time from showing the card to grading it. */
  durationMs?: number | null;
  /** 4.5.1 support level the card was recited at; null for cards without a ladder. */
  supportLevel?: number | null;
  /** GRD-02: the rubric's proposal, logged beside the final rating. */
  proposedRating?: number | null;
  grader?: Grader;
  errorCount?: number;
  /** STR-08: the missed day this review was graded toward, or null when it counts for its own day. */
  makeupFor?: string | null;
};

/**
 * Record one review and queue its upload with the given executor. Its local date and zone are fixed
 * when it happens (DAY-01), so travel never moves a past review to another day.
 */
export async function putStudyLogRow(db: DatabaseExecutor, log: StudyLogInput): Promise<void> {
  const { cardId, rating, state, due, stability, difficulty, elapsedDays, scheduledDays, reviewedAt } = log;
  const reviewedAtDate = new Date(reviewedAt);
  const localDate = localDateOf(reviewedAtDate);
  const tz = deviceTimeZone(reviewedAtDate);
  const sessionId = log.sessionId ?? null;
  const durationMs = log.durationMs == null ? null : Math.max(0, Math.round(log.durationMs));
  const supportLevel = log.supportLevel ?? null;
  const proposedRating = log.proposedRating ?? null;
  const grader = log.grader ?? "self";
  const errorCount = log.errorCount ?? 0;
  const makeupFor = log.makeupFor ?? null;
  await db.runAsync(
    `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at, sync_status,
       session_id, duration_ms, support_level, proposed_rating, grader, local_date, tz, error_count, makeup_for)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cardId, rating, state, due, stability, difficulty, elapsedDays, scheduledDays, reviewedAt,
      sessionId, durationMs, supportLevel, proposedRating, grader, localDate, tz, errorCount, makeupFor,
    ]
  );
  await enqueueSync(db, "study_log", "INSERT", `${cardId}:${reviewedAt}`, {
    card_id: cardId,
    rating,
    state,
    due,
    stability,
    difficulty,
    elapsed_days: elapsedDays,
    scheduled_days: scheduledDays,
    reviewed_at: reviewedAt,
    session_id: sessionId,
    duration_ms: durationMs,
    support_level: supportLevel,
    proposed_rating: proposedRating,
    grader,
    local_date: localDate,
    tz,
    error_count: errorCount,
    makeup_for: makeupFor,
  });
}

/** Publish a committed review: achievements are a logged side effect, then listeners refresh. */
export function publishReviewLogged(db: AppDatabase, log: StudyLogInput): void {
  recordAchievementEvent(db, {
    type: "review_logged",
    cardId: log.cardId,
    rating: log.rating,
    reviewedAt: log.reviewedAt,
  }).catch(console.warn);
  emitReviewActivity();
}

export async function getReviewStats(db: DatabaseExecutor, activityDays = 90): Promise<ReviewStats> {
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
