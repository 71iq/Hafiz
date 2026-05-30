import type { SQLiteDatabase } from "expo-sqlite";
import { enqueueSync } from "@/lib/database/sync-queue";
import { deleteUserSetting, writeUserSetting } from "@/lib/database/user-settings";
import { createEmptyCard } from "./scheduler";
import {
  ALL_NEW_CARD_SORT_ORDERS,
  ALL_NEW_REVIEW_ORDERS,
  ALL_REVIEW_SORT_ORDERS,
  DEFAULT_DECK_NEW_CARD_LIMIT,
  DEFAULT_NEW_CARD_SORT_ORDER,
  DEFAULT_NEW_REVIEW_ORDER,
  DEFAULT_REVIEW_SORT_ORDER,
  MAX_DECK_NEW_CARD_LIMIT,
  type NewCardSortOrder,
  type NewReviewOrder,
  type ReviewSortOrder,
  type SurahAyahRange,
  type StudyCardRow,
} from "./types";

export const SMART_DECK_IDS = {
  retention: "default-retention",
  mutashabihat: "default-mutashabihat",
  similarTails: "default-similar-tails",
  qiraat: "default-qiraat",
  reasonsOfRevelation: "default-reasons-of-revelation",
} as const;

export type SmartDeckId = (typeof SMART_DECK_IDS)[keyof typeof SMART_DECK_IDS];

export type BuiltInDeckFilter =
  | { type: "all" }
  | { type: "surah"; surahs: number[]; ranges?: SurahAyahRange[] }
  | { type: "juz"; juzNumbers: number[] };

export type SmartCardKind = "mutashabihat" | "similarTail" | "qiraat" | "asbab";

export type SmartDeckRef = {
  groupId: string | null;
  sortOrder: number;
  surah: number;
  ayah: number;
  surahNameAr: string;
  surahNameEn: string;
  tail5: string | null;
  textUthmani: string;
  textClean: string;
  textQcf2: string;
  v2Page: number;
  preText?: string | null;
  similarText?: string | null;
  postText?: string | null;
};

export type SmartCardContent = {
  kind: SmartCardKind;
  cue: string;
  targetRef: SmartDeckRef;
  refs: SmartDeckRef[];
  promptQcf2?: string;
  promptUthmani?: string;
  hiddenAnswerQcf2?: string;
  hiddenAnswerUthmani?: string;
  prefixWordCount?: number;
  needsExplicitRefLabel?: boolean;
  qiraatText?: string;
  qiraatGroup?: string[];
  asbabOccasions?: string[];
  asbabGroup?: string[];
  asbabSource?: string;
};

export type SmartDeckStats = {
  total: number;
  due: number;
  newCount: number;
};

export type DueCardsForReviewOptions = number | {
  limit?: number;
  newCardsLimit?: number;
  newReviewOrder?: NewReviewOrder;
  reviewSortOrder?: ReviewSortOrder;
  newCardSortOrder?: NewCardSortOrder;
  dueUntil?: string;
};

const SMART_DECK_ID_LIST: SmartDeckId[] = [
  SMART_DECK_IDS.retention,
  SMART_DECK_IDS.mutashabihat,
  SMART_DECK_IDS.similarTails,
  SMART_DECK_IDS.qiraat,
  SMART_DECK_IDS.reasonsOfRevelation,
];

const LEGACY_MUTASHABIHAT_DECK_ID = "mutashabihat";
const MEANINGS_DECK_ID = "meanings";
const SQLITE_PARAM_BATCH = 800;
const INSERT_BATCH = 500;
const ACTIVE_CARD_SQL = "deleted_at IS NULL";
const REVIEWABLE_CARD_SQL = `${ACTIVE_CARD_SQL} AND suspended_at IS NULL AND (buried_until IS NULL OR buried_until <= ?)`;
const retentionMigrationPromises = new WeakMap<SQLiteDatabase, Promise<number>>();

function isReviewableCard(row: StudyCardRow, nowIso: string): boolean {
  return !row.deleted_at && !row.suspended_at && (!row.buried_until || row.buried_until <= nowIso);
}

function studyCardToSyncData(row: StudyCardRow): Record<string, any> {
  return {
    id: row.id,
    deck_id: row.deck_id,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review,
    suspended_at: row.suspended_at,
    buried_until: row.buried_until,
    marked_at: row.marked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  };
}

function parseAyahCardId(id: string): { surah: number; ayah: number } | null {
  const [surahRaw, ayahRaw, extra] = id.split(":");
  if (extra !== undefined) return null;
  const surah = parseInt(surahRaw, 10);
  const ayah = parseInt(ayahRaw, 10);
  return Number.isFinite(surah) && Number.isFinite(ayah) ? { surah, ayah } : null;
}

function parseLegacyMutashabihatCardId(id: string): string | null {
  const [prefix, surahRaw, ayahRaw, extra] = id.split(":");
  if (prefix !== LEGACY_MUTASHABIHAT_DECK_ID || extra !== undefined) return null;
  const surah = parseInt(surahRaw, 10);
  const ayah = parseInt(ayahRaw, 10);
  return Number.isFinite(surah) && Number.isFinite(ayah) ? `${surah}:${ayah}` : null;
}

export function isSmartDeckId(deckId: string | undefined | null): deckId is SmartDeckId {
  return !!deckId && (SMART_DECK_ID_LIST as string[]).includes(deckId);
}

function smartDeckFilterKey(deckId: SmartDeckId): string {
  return `smart_deck_filter_${deckId}`;
}

function normalizeSmartDeckFilter(filter: unknown): BuiltInDeckFilter {
  if (!filter || typeof filter !== "object") return { type: "all" };
  const raw = filter as any;
  if (raw.type === "surah") {
    const surahs = Array.isArray(raw.surahs)
      ? normalizeNumbers(raw.surahs, 1, 114)
      : [];
    const ranges = Array.isArray(raw.ranges)
      ? normalizeRanges(raw.ranges, surahs)
      : [];
    return surahs.length > 0 ? { type: "surah", surahs, ...(ranges.length > 0 ? { ranges } : {}) } : { type: "all" };
  }
  if (raw.type === "surahRange") {
    const surahStart = Number(raw.surahStart);
    const surahEnd = Number(raw.surahEnd);
    if (
      Number.isInteger(surahStart) &&
      Number.isInteger(surahEnd) &&
      surahStart >= 1 &&
      surahEnd <= 114 &&
      surahStart <= surahEnd
    ) {
      return {
        type: "surah",
        surahs: Array.from({ length: surahEnd - surahStart + 1 }, (_, index) => surahStart + index),
      };
    }
    return { type: "all" };
  }
  if (raw.type === "juz") {
    const juzNumbers = Array.isArray(raw.juzNumbers)
      ? normalizeNumbers(raw.juzNumbers, 1, 30)
      : [];
    return juzNumbers.length > 0 ? { type: "juz", juzNumbers } : { type: "all" };
  }
  return { type: "all" };
}

export async function readSmartDeckFilter(
  db: SQLiteDatabase,
  deckId: SmartDeckId
): Promise<BuiltInDeckFilter> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [smartDeckFilterKey(deckId)]
  );
  if (!row?.value) return { type: "all" };
  try {
    return normalizeSmartDeckFilter(JSON.parse(row.value));
  } catch {
    return { type: "all" };
  }
}

export async function writeSmartDeckFilter(
  db: SQLiteDatabase,
  deckId: SmartDeckId,
  filter: BuiltInDeckFilter
): Promise<void> {
  const normalized = normalizeSmartDeckFilter(filter);
  await writeUserSetting(db, smartDeckFilterKey(deckId), JSON.stringify(normalized));
}

export async function migrateLegacyRetentionDecks(db: SQLiteDatabase): Promise<number> {
  const running = retentionMigrationPromises.get(db);
  if (running) return running;
  const promise = runLegacyRetentionDeckMigration(db).finally(() => {
    retentionMigrationPromises.delete(db);
  });
  retentionMigrationPromises.set(db, promise);
  return promise;
}

async function runLegacyRetentionDeckMigration(db: SQLiteDatabase): Promise<number> {
  const now = new Date().toISOString();
  let migrated = 0;
  const syncOps: Array<{
    operation: "UPDATE" | "DELETE";
    rowId: string;
    data: Record<string, any>;
  }> = [];

  const rows = await db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards
      WHERE deleted_at IS NULL
        AND deck_id NOT IN (${SMART_DECK_ID_LIST.map(() => "?").join(",")})
        AND deck_id != ?
        AND id NOT LIKE 'word:%'`,
    [...SMART_DECK_ID_LIST, MEANINGS_DECK_ID]
  );

  if (rows.length > 0) {
    await db.withTransactionAsync(async () => {
      for (const row of rows) {
        const legacyAyahId = parseLegacyMutashabihatCardId(row.id);
        if (legacyAyahId) {
          const existing = await db.getFirstAsync<StudyCardRow>(
            "SELECT * FROM study_cards WHERE id = ? AND deleted_at IS NULL",
            [legacyAyahId]
          );
          await db.runAsync("UPDATE study_log SET card_id = ? WHERE card_id = ?", [legacyAyahId, row.id]);
          if (existing?.id) {
            const markedAt = existing.marked_at ?? row.marked_at ?? now;
            await db.runAsync(
              "UPDATE study_cards SET marked_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
              [markedAt, now, legacyAyahId]
            );
            syncOps.push({
              operation: "UPDATE",
              rowId: legacyAyahId,
              data: studyCardToSyncData({
                ...existing,
                marked_at: markedAt,
                updated_at: now,
              }),
            });
            await db.runAsync(
              "UPDATE study_cards SET updated_at = ?, deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
              [now, now, row.id]
            );
            syncOps.push({
              operation: "DELETE",
              rowId: row.id,
              data: {
                ...studyCardToSyncData(row),
                updated_at: now,
                deleted_at: now,
              },
            });
          } else {
            const markedAt = row.marked_at ?? now;
            await db.runAsync(
              "UPDATE study_cards SET id = ?, deck_id = ?, marked_at = ?, updated_at = ?, deleted_at = NULL WHERE id = ? AND deleted_at IS NULL",
              [legacyAyahId, SMART_DECK_IDS.retention, markedAt, now, row.id]
            );
            syncOps.push({
              operation: "UPDATE",
              rowId: legacyAyahId,
              data: studyCardToSyncData({
                ...row,
                id: legacyAyahId,
                deck_id: SMART_DECK_IDS.retention,
                marked_at: markedAt,
                updated_at: now,
                deleted_at: null,
              }),
            });
          }
          migrated++;
          continue;
        }

        if (!parseAyahCardId(row.id)) continue;
        if (row.deck_id === SMART_DECK_IDS.retention) continue;
        const markedAt = row.marked_at ?? now;
        await db.runAsync(
          "UPDATE study_cards SET deck_id = ?, marked_at = ?, updated_at = ?, deleted_at = NULL WHERE id = ? AND deleted_at IS NULL",
          [SMART_DECK_IDS.retention, markedAt, now, row.id]
        );
        syncOps.push({
          operation: "UPDATE",
          rowId: row.id,
          data: studyCardToSyncData({
            ...row,
            deck_id: SMART_DECK_IDS.retention,
            marked_at: markedAt,
            updated_at: now,
            deleted_at: null,
          }),
        });
        migrated++;
      }
    });
  }

  for (const op of syncOps) {
    enqueueSync(db, "study_cards", op.operation, op.rowId, op.data).catch(console.warn);
  }

  const deckSettings = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM user_settings WHERE key LIKE 'deck_%'"
  );
  await Promise.all(deckSettings.map(async (setting) => {
    let deckId = setting.key.startsWith("deck_") ? setting.key.slice("deck_".length) : "";
    try {
      const deck = JSON.parse(setting.value);
      deckId = typeof deck?.id === "string" ? deck.id : deckId;
      if (deck?.id === MEANINGS_DECK_ID) return;
    } catch {}
    await deleteUserSetting(db, setting.key);
    if (deckId && deckId !== MEANINGS_DECK_ID) {
      await deleteUserSetting(db, `review_settings_${deckId}`);
    }
  }));

  return migrated;
}

export async function getSmartDeckCandidateCardIds(
  db: SQLiteDatabase,
  deckId: SmartDeckId,
  filter?: BuiltInDeckFilter
): Promise<string[]> {
  const activeFilter = filter ?? await readSmartDeckFilter(db, deckId);
  if (deckId === SMART_DECK_IDS.retention) {
    const params: any[] = [];
    const clause = buildFilterClause("q", activeFilter, params);
    const rows = await db.getAllAsync<{ surah: number; ayah: number }>(
      `SELECT q.surah, q.ayah
         FROM quran_text q
        ${clause ? `WHERE ${clause}` : ""}
        ORDER BY q.surah, q.ayah`,
      params
    );
    return rows.map((row) => `${row.surah}:${row.ayah}`);
  }
  if (deckId === SMART_DECK_IDS.reasonsOfRevelation) {
    const params: any[] = [];
    const clause = buildFilterClause("an", activeFilter, params);
    const rows = await db.getAllAsync<{ surah: number; ayah: number }>(
      `SELECT an.surah, an.ayah
         FROM asbab_al_nuzul an
        WHERE TRIM(COALESCE(an.occasions_json, '')) != ''
          ${clause ? `AND ${clause}` : ""}
        ORDER BY an.surah, an.ayah`,
      params
    );
    return rows.map((row) => `asbab:${row.surah}:${row.ayah}`);
  }
  if (deckId === SMART_DECK_IDS.qiraat) {
    const params: any[] = [];
    const clause = buildFilterClause("qe", activeFilter, params);
    const rows = await db.getAllAsync<{ surah: number; ayah: number }>(
      `SELECT qe.surah, qe.ayah
         FROM qiraat_encyclopedia qe
        WHERE TRIM(COALESCE(qe.text, '')) != ''
          ${clause ? `AND ${clause}` : ""}
        ORDER BY qe.surah, qe.ayah`,
      params
    );
    return rows.map((row) => `qiraat:${row.surah}:${row.ayah}`);
  }

  const kind = deckId === SMART_DECK_IDS.mutashabihat ? "similar" : "tail";
  const prefix = deckId === SMART_DECK_IDS.mutashabihat ? "mutashabihat:" : "similar-tail:";
  const params: any[] = [kind];
  const clause = buildFilterClause("r", activeFilter, params);
  const rows = await db.getAllAsync<{
    id: string;
    group_sort_order: number;
    ref_sort_order: number;
    cue: string;
    tail_5: string | null;
    text_clean: string;
    text_qcf2: string;
  }>(
    `SELECT g.id, g.sort_order AS group_sort_order, r.sort_order AS ref_sort_order,
            g.cue, r.tail_5, qt.text_clean, qt.text_qcf2
       FROM mutashabihat_groups g
       JOIN mutashabihat_refs r ON r.group_id = g.id
       JOIN quran_text qt ON qt.surah = r.surah AND qt.ayah = r.ayah
      WHERE g.kind = ?
        ${clause ? `AND ${clause}` : ""}
      ORDER BY g.sort_order, r.sort_order`,
    params
  );
  return rows
    .filter((row) => kind !== "tail" || hasVisibleTailPrompt(row.cue, row.tail_5, row.text_clean, row.text_qcf2))
    .map((row) => `${prefix}${row.id}:${row.ref_sort_order}`);
}

export async function getAllMatchingSmartCardIdSet(db: SQLiteDatabase): Promise<Set<string>> {
  const ids = await Promise.all(SMART_DECK_ID_LIST.map((deckId) => getSmartDeckCandidateCardIds(db, deckId)));
  return new Set(ids.flat());
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

type NormalizedDueOptions = {
  limit: number;
  newCardsLimit: number;
  newReviewOrder: NewReviewOrder;
  reviewSortOrder: ReviewSortOrder;
  newCardSortOrder: NewCardSortOrder;
  dueUntil?: string;
};

function normalizeDueOptions(options?: DueCardsForReviewOptions): NormalizedDueOptions {
  if (typeof options === "number") {
    return {
      limit: options,
      newCardsLimit: DEFAULT_DECK_NEW_CARD_LIMIT,
      newReviewOrder: DEFAULT_NEW_REVIEW_ORDER,
      reviewSortOrder: DEFAULT_REVIEW_SORT_ORDER,
      newCardSortOrder: DEFAULT_NEW_CARD_SORT_ORDER,
    };
  }
  return {
    limit: options?.limit ?? 0,
    newCardsLimit: typeof options?.newCardsLimit === "number" && Number.isFinite(options.newCardsLimit)
      ? Math.max(0, Math.min(MAX_DECK_NEW_CARD_LIMIT, options.newCardsLimit))
      : DEFAULT_DECK_NEW_CARD_LIMIT,
    newReviewOrder: normalizeEnum(options?.newReviewOrder, ALL_NEW_REVIEW_ORDERS, DEFAULT_NEW_REVIEW_ORDER),
    reviewSortOrder: normalizeEnum(options?.reviewSortOrder, ALL_REVIEW_SORT_ORDERS, DEFAULT_REVIEW_SORT_ORDER),
    newCardSortOrder: normalizeEnum(options?.newCardSortOrder, ALL_NEW_CARD_SORT_ORDERS, DEFAULT_NEW_CARD_SORT_ORDER),
    dueUntil: typeof options?.dueUntil === "string" ? options.dueUntil : undefined,
  };
}

function shuffleRows(rows: StudyCardRow[]): StudyCardRow[] {
  const next = [...rows];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function sortReviewRows(rows: StudyCardRow[], sortOrder: ReviewSortOrder): StudyCardRow[] {
  if (sortOrder === "random") return shuffleRows(rows);
  return [...rows].sort((a, b) => {
    if (sortOrder === "oldest") return (a.last_review ?? a.created_at).localeCompare(b.last_review ?? b.created_at);
    if (sortOrder === "newest") return (b.last_review ?? b.created_at).localeCompare(a.last_review ?? a.created_at);
    return a.due.localeCompare(b.due);
  });
}

function sortNewRows(rows: StudyCardRow[], sortOrder: NewCardSortOrder): StudyCardRow[] {
  if (sortOrder === "random") return shuffleRows(rows);
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function interleaveRows(first: StudyCardRow[], second: StudyCardRow[]): StudyCardRow[] {
  const rows: StudyCardRow[] = [];
  const max = Math.max(first.length, second.length);
  for (let i = 0; i < max; i++) {
    if (first[i]) rows.push(first[i]);
    if (second[i]) rows.push(second[i]);
  }
  return rows;
}

function applyReviewQueueOptions(rows: StudyCardRow[], options?: DueCardsForReviewOptions): StudyCardRow[] {
  const normalized = normalizeDueOptions(options);
  const limit = normalized.limit > 0 ? normalized.limit : rows.length;
  const reviews = sortReviewRows(rows.filter((row) => row.state !== 0), normalized.reviewSortOrder);
  const newCards = sortNewRows(rows.filter((row) => row.state === 0), normalized.newCardSortOrder)
    .slice(0, normalized.newCardsLimit);
  const ordered = normalized.newReviewOrder === "newFirst"
    ? [...newCards, ...reviews]
    : normalized.newReviewOrder === "mixed"
      ? interleaveRows(reviews, newCards)
      : [...reviews, ...newCards];
  return ordered.slice(0, limit);
}

export async function getSmartDeckStats(
  db: SQLiteDatabase,
  deckId: SmartDeckId,
  filter?: BuiltInDeckFilter
): Promise<SmartDeckStats> {
  if (deckId === SMART_DECK_IDS.retention) {
    await migrateLegacyRetentionDecks(db);
  }
  const ids = await getSmartDeckCandidateCardIds(db, deckId, filter);
  if (ids.length === 0) return { total: 0, due: 0, newCount: 0 };

  const now = new Date().toISOString();
  const rows = await getStudyCardsByIds(db, ids, deckId);
  const existing = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !existing.has(id)).length;
  return {
    total: ids.length,
    due: rows.filter((row) => row.due <= now && isReviewableCard(row, now)).length + missing,
    newCount: rows.filter((row) => row.state === 0).length + missing,
  };
}

export async function getSmartDeckTodayStats(
  db: SQLiteDatabase,
  deckId: SmartDeckId,
  options?: DueCardsForReviewOptions
): Promise<SmartDeckStats> {
  if (deckId === SMART_DECK_IDS.retention) {
    await migrateLegacyRetentionDecks(db);
  }
  const ids = await getSmartDeckCandidateCardIds(db, deckId);
  if (ids.length === 0) return { total: 0, due: 0, newCount: 0 };

  const now = new Date().toISOString();
  const normalized = normalizeDueOptions(options);
  const rows = await getStudyCardsByIds(db, ids, deckId);
  const existing = new Set(rows.map((row) => row.id));
  const dueRows = rows
    .filter((row) => row.due <= now && isReviewableCard(row, now))
    .sort((a, b) => a.due.localeCompare(b.due));
  const missingRows = ids
    .filter((id) => !existing.has(id))
    .slice(0, normalized.newCardsLimit)
    .map((id) => {
      const emptyCard = createEmptyCard();
      return {
        id,
        deck_id: deckId,
        due: now,
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
      };
    });
  const queuedRows = applyReviewQueueOptions([...dueRows, ...missingRows], options);

  return {
    total: ids.length,
    due: queuedRows.filter((row) => row.state !== 0).length,
    newCount: queuedRows.filter((row) => row.state === 0).length,
  };
}

export async function materializeSmartDeckCards(
  db: SQLiteDatabase,
  deckId: SmartDeckId,
  limit?: number,
  newCardsLimit = DEFAULT_DECK_NEW_CARD_LIMIT
): Promise<number> {
  if (deckId === SMART_DECK_IDS.retention) {
    await migrateLegacyRetentionDecks(db);
  }
  const ids = await getSmartDeckCandidateCardIds(db, deckId);
  if (ids.length === 0) return 0;

  const nowIso = new Date().toISOString();
  const rows = await getStudyCardsByIds(db, ids, deckId);
  const existing = new Set(rows.map((row) => row.id));
  const targetDueCount = limit && limit > 0 ? Math.min(limit, ids.length) : ids.length;
  const safeNewCardsLimit = Number.isFinite(newCardsLimit)
    ? Math.max(0, Math.min(MAX_DECK_NEW_CARD_LIMIT, newCardsLimit))
    : DEFAULT_DECK_NEW_CARD_LIMIT;
  const existingDueRows = rows.filter((row) => row.due <= nowIso && isReviewableCard(row, nowIso));
  const existingDueReviewCount = existingDueRows.filter((row) => row.state !== 0).length;
  const existingDueNewCount = existingDueRows.length - existingDueReviewCount;
  const targetDueNewCount = Math.min(safeNewCardsLimit, Math.max(0, targetDueCount - existingDueReviewCount));
  const createCount = Math.max(0, targetDueNewCount - existingDueNewCount);
  if (createCount === 0) return 0;

  const missingIds = ids.filter((id) => !existing.has(id)).slice(0, createCount);
  if (missingIds.length === 0) return 0;

  const emptyCard = createEmptyCard();
  const due = emptyCard.due.toISOString();
  const createdRows = missingIds.map((id) => ({
    id,
    deck_id: deckId,
    due,
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
  }));

  await db.withTransactionAsync(async () => {
    for (let i = 0; i < createdRows.length; i += INSERT_BATCH) {
      const batch = createdRows.slice(i, i + INSERT_BATCH);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      const params: any[] = [];
      for (const row of batch) {
        params.push(
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
          row.deleted_at
        );
      }
      await db.runAsync(
        `INSERT INTO study_cards
          (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, suspended_at, buried_until, marked_at, created_at, updated_at, deleted_at)
         VALUES ${placeholders}
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
        params
      );
    }
  });

  for (const row of createdRows) {
    enqueueSync(db, "study_cards", "INSERT", row.id, row).catch(console.warn);
  }

  return createdRows.length;
}

export async function getDueCardsForReview(
  db: SQLiteDatabase,
  deckId?: string,
  options?: DueCardsForReviewOptions
): Promise<StudyCardRow[]> {
  const now = new Date().toISOString();
  const dueUntil = normalizeDueOptions(options).dueUntil ?? now;

  if (isSmartDeckId(deckId)) {
    const rows = await getSmartDeckDueRows(db, deckId, dueUntil, now);
    return applyReviewQueueOptions(rows, options);
  }

  if (deckId) {
    const rows = await db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE deck_id = ? AND due <= ? AND ${REVIEWABLE_CARD_SQL}`,
      [deckId, dueUntil, now]
    );
    return applyReviewQueueOptions(rows, options);
  }

  const rows = await db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards WHERE due <= ? AND ${REVIEWABLE_CARD_SQL}`,
    [dueUntil, now]
  );
  const matchingSmartIds = await getAllMatchingSmartCardIdSet(db);
  const filtered = rows.filter((row) => !isSmartDeckId(row.deck_id) || matchingSmartIds.has(row.id));
  return applyReviewQueueOptions(filtered, options);
}

export async function getSmartCardContent(
  db: SQLiteDatabase,
  cardId: string
): Promise<SmartCardContent | null> {
  if (cardId.startsWith("mutashabihat:")) {
    const parsed = parseMutashabihatCardId(cardId, "mutashabihat:");
    if (!parsed) return null;
    return getMutashabihatCardContent(db, parsed.groupId, parsed.sortOrder, "mutashabihat");
  }
  if (cardId.startsWith("similar-tail:")) {
    const parsed = parseMutashabihatCardId(cardId, "similar-tail:");
    if (!parsed) return null;
    return getMutashabihatCardContent(db, parsed.groupId, parsed.sortOrder, "similarTail");
  }
  if (cardId.startsWith("qiraat:")) {
    const [, surahRaw, ayahRaw] = cardId.split(":");
    const surah = parseInt(surahRaw, 10);
    const ayah = parseInt(ayahRaw, 10);
    if (!Number.isFinite(surah) || !Number.isFinite(ayah)) return null;
    const row = await db.getFirstAsync<{
      text_uthmani: string;
      text_clean: string;
      text_qcf2: string;
      v2_page: number;
      name_arabic: string;
      name_english: string;
      qiraat_text: string;
      ayah_group: string | null;
    }>(
      `SELECT qt.text_uthmani, qt.text_clean, qt.text_qcf2, qt.v2_page, s.name_arabic, s.name_english,
              qe.text AS qiraat_text, qe.ayah_group
         FROM qiraat_encyclopedia qe
         JOIN quran_text qt ON qt.surah = qe.surah AND qt.ayah = qe.ayah
         JOIN surahs s ON s.number = qe.surah
        WHERE qe.surah = ? AND qe.ayah = ? AND TRIM(COALESCE(qe.text, '')) != ''`,
      [surah, ayah]
    );
    if (!row) return null;
    const ref: SmartDeckRef = {
      groupId: null,
      sortOrder: 0,
      surah,
      ayah,
      surahNameAr: row.name_arabic,
      surahNameEn: row.name_english,
      tail5: null,
      textUthmani: row.text_uthmani,
      textClean: row.text_clean,
      textQcf2: row.text_qcf2,
      v2Page: row.v2_page,
    };
    return {
      kind: "qiraat",
      cue: `${surah}:${ayah}`,
      targetRef: ref,
      refs: [ref],
      qiraatText: row.qiraat_text,
      qiraatGroup: parseStringArray(row.ayah_group),
    };
  }
  if (cardId.startsWith("asbab:")) {
    const [, surahRaw, ayahRaw] = cardId.split(":");
    const surah = parseInt(surahRaw, 10);
    const ayah = parseInt(ayahRaw, 10);
    if (!Number.isFinite(surah) || !Number.isFinite(ayah)) return null;
    const row = await db.getFirstAsync<{
      text_uthmani: string;
      text_clean: string;
      text_qcf2: string;
      v2_page: number;
      name_arabic: string;
      name_english: string;
      occasions_json: string;
      ayah_group: string | null;
      source: string | null;
    }>(
      `SELECT qt.text_uthmani, qt.text_clean, qt.text_qcf2, qt.v2_page, s.name_arabic, s.name_english,
              an.occasions_json, an.ayah_group, an.source
         FROM asbab_al_nuzul an
         JOIN quran_text qt ON qt.surah = an.surah AND qt.ayah = an.ayah
         JOIN surahs s ON s.number = an.surah
        WHERE an.surah = ? AND an.ayah = ? AND TRIM(COALESCE(an.occasions_json, '')) != ''`,
      [surah, ayah]
    );
    if (!row) return null;
    const occasions = parseStringArray(row.occasions_json).filter((text) => text.trim().length > 0);
    if (occasions.length === 0) return null;
    const ref: SmartDeckRef = {
      groupId: null,
      sortOrder: 0,
      surah,
      ayah,
      surahNameAr: row.name_arabic,
      surahNameEn: row.name_english,
      tail5: null,
      textUthmani: row.text_uthmani,
      textClean: row.text_clean,
      textQcf2: row.text_qcf2,
      v2Page: row.v2_page,
    };
    return {
      kind: "asbab",
      cue: `${surah}:${ayah}`,
      targetRef: ref,
      refs: [ref],
      asbabOccasions: occasions,
      asbabGroup: parseStringArray(row.ayah_group),
      asbabSource: row.source ?? undefined,
    };
  }
  return null;
}

async function getMutashabihatCardContent(
  db: SQLiteDatabase,
  groupId: string,
  targetSortOrder: number,
  kind: "mutashabihat" | "similarTail"
): Promise<SmartCardContent | null> {
  const rows = await db.getAllAsync<{
    cue: string;
    group_id: string;
    ref_sort_order: number;
    ref_surah: number;
    ref_ayah: number;
    surah_name_ar: string | null;
    tail_5: string | null;
    text_uthmani: string;
    text_clean: string;
    text_qcf2: string;
    v2_page: number;
    name_arabic: string;
    name_english: string;
    pre_text: string | null;
    similar_text: string | null;
    post_text: string | null;
  }>(
    `SELECT g.cue, g.id AS group_id, r.sort_order AS ref_sort_order,
            r.surah AS ref_surah, r.ayah AS ref_ayah, r.surah_name_ar, r.tail_5,
            r.pre_text, r.similar_text, r.post_text,
            qt.text_uthmani, qt.text_clean, qt.text_qcf2, qt.v2_page, s.name_arabic, s.name_english
       FROM mutashabihat_groups g
       JOIN mutashabihat_refs r ON r.group_id = g.id
       JOIN quran_text qt ON qt.surah = r.surah AND qt.ayah = r.ayah
       JOIN surahs s ON s.number = r.surah
      WHERE g.id = ?
      ORDER BY r.sort_order`,
    [groupId]
  );
  if (rows.length === 0) return null;
  const refs: SmartDeckRef[] = rows.map((row) => ({
      groupId: row.group_id,
      sortOrder: row.ref_sort_order,
      surah: row.ref_surah,
      ayah: row.ref_ayah,
      surahNameAr: row.surah_name_ar ?? row.name_arabic,
      surahNameEn: row.name_english,
      tail5: row.tail_5,
      textUthmani: row.text_uthmani,
      textClean: row.text_clean,
      textQcf2: row.text_qcf2,
      v2Page: row.v2_page,
      preText: row.pre_text,
      similarText: row.similar_text,
      postText: row.post_text,
  }));
  const targetRef = refs.find((ref) => ref.sortOrder === targetSortOrder);
  if (!targetRef) return null;

  if (kind === "similarTail") {
    const prompt = buildTailPrompt(rows[0].cue, targetRef);
    if (!prompt) return null;
    return {
      kind,
      cue: rows[0].cue,
      targetRef,
      refs,
      ...prompt,
    };
  }

  return {
    kind,
    cue: rows[0].cue,
    targetRef,
    refs,
    ...buildMutashabihatPrompt(targetRef, refs),
  };
}

function parseMutashabihatCardId(
  cardId: string,
  prefix: "mutashabihat:" | "similar-tail:"
): { groupId: string; sortOrder: number } | null {
  const body = cardId.slice(prefix.length);
  const separator = body.lastIndexOf(":");
  if (separator <= 0) return null;
  const groupId = body.slice(0, separator);
  const sortOrder = parseInt(body.slice(separator + 1), 10);
  if (!groupId || !Number.isFinite(sortOrder)) return null;
  return { groupId, sortOrder };
}

function hasVisibleTailPrompt(
  cue: string,
  tail5: string | null,
  textClean: string,
  textQcf2: string
): boolean {
  const wordCount = splitQuranWords(textClean).length || Math.max(0, splitQcf2Words(textQcf2).length - 1);
  if (wordCount === 0) return false;
  const hiddenCount = inferTailWordCount(cue, tail5, textClean);
  return wordCount - hiddenCount > 0;
}

function buildTailPrompt(
  cue: string,
  targetRef: SmartDeckRef
): Pick<SmartCardContent, "promptQcf2" | "promptUthmani" | "hiddenAnswerQcf2" | "hiddenAnswerUthmani" | "prefixWordCount"> | null {
  const qcf2Tokens = splitQcf2Words(targetRef.textQcf2);
  const uthmaniWords = splitQuranWords(targetRef.textUthmani);
  const wordCount = splitQuranWords(targetRef.textClean).length || Math.max(0, qcf2Tokens.length - 1);
  if (wordCount === 0) return null;

  const hiddenCount = Math.min(inferTailWordCount(cue, targetRef.tail5, targetRef.textClean), wordCount);
  const prefixWordCount = wordCount - hiddenCount;
  if (prefixWordCount <= 0) return null;

  return {
    promptQcf2: qcf2Tokens.slice(0, prefixWordCount).join(" "),
    promptUthmani: uthmaniWords.slice(0, prefixWordCount).join(" "),
    hiddenAnswerQcf2: qcf2Tokens.slice(prefixWordCount).join(" "),
    hiddenAnswerUthmani: uthmaniWords.slice(prefixWordCount).join(" "),
    prefixWordCount,
  };
}

function buildMutashabihatPrompt(
  targetRef: SmartDeckRef,
  refs: SmartDeckRef[]
): Pick<SmartCardContent, "promptQcf2" | "promptUthmani" | "prefixWordCount" | "needsExplicitRefLabel"> {
  const segmentedPrompt = buildSegmentedMutashabihatPrompt(targetRef, refs);
  if (segmentedPrompt) return segmentedPrompt;

  const qcf2Tokens = splitQcf2Words(targetRef.textQcf2);
  const uthmaniWords = splitQuranWords(targetRef.textUthmani);
  const targetWords = normalizeArabicWords(targetRef.textClean);
  const fallbackCount = qcf2Tokens.length || uthmaniWords.length || targetWords.length;
  let prefixWordCount = fallbackCount;
  let needsExplicitRefLabel = true;

  if (targetWords.length > 0) {
    const normalizedRefs = refs.map((ref) => ({
      ref,
      words: normalizeArabicWords(ref.textClean),
    }));

    for (let count = 1; count <= targetWords.length; count++) {
      const targetPrefix = targetWords.slice(0, count).join(" ");
      const matches = normalizedRefs.filter((item) => item.words.slice(0, count).join(" ") === targetPrefix);
      if (matches.length === 1 && matches[0].ref.sortOrder === targetRef.sortOrder) {
        prefixWordCount = count;
        needsExplicitRefLabel = false;
        break;
      }
    }
  }

  const safePrefixCount = Math.max(0, Math.min(prefixWordCount, qcf2Tokens.length || prefixWordCount));
  return {
    promptQcf2: qcf2Tokens.slice(0, safePrefixCount).join(" "),
    promptUthmani: uthmaniWords.slice(0, safePrefixCount).join(" "),
    prefixWordCount: safePrefixCount,
    needsExplicitRefLabel,
  };
}

function buildSegmentedMutashabihatPrompt(
  targetRef: SmartDeckRef,
  refs: SmartDeckRef[]
): Pick<SmartCardContent, "promptQcf2" | "promptUthmani" | "prefixWordCount" | "needsExplicitRefLabel"> | null {
  const similarWords = normalizeArabicWords(targetRef.similarText ?? "");
  if (similarWords.length === 0) return null;

  const targetWords = normalizeArabicWords(targetRef.textClean);
  if (targetWords.length === 0) return null;

  const promptWordCount = findSegmentPromptWordCount(targetWords, targetRef.preText ?? "", similarWords);
  if (promptWordCount <= 0) return null;

  const qcf2Tokens = splitQcf2Words(targetRef.textQcf2);
  const uthmaniWords = splitQuranWords(targetRef.textUthmani);
  const safePrefixCount = Math.max(0, Math.min(promptWordCount, targetWords.length, qcf2Tokens.length || promptWordCount));
  if (safePrefixCount <= 0) return null;

  const normalizedRefs = refs.map((ref) => ({
    ref,
    words: normalizeArabicWords(ref.textClean),
  }));
  const targetPrefix = targetWords.slice(0, safePrefixCount).join(" ");
  const matches = normalizedRefs.filter((item) => item.words.slice(0, safePrefixCount).join(" ") === targetPrefix);
  const needsExplicitRefLabel = !(matches.length === 1 && matches[0].ref.sortOrder === targetRef.sortOrder);

  return {
    promptQcf2: qcf2Tokens.slice(0, safePrefixCount).join(" "),
    promptUthmani: uthmaniWords.slice(0, safePrefixCount).join(" "),
    prefixWordCount: safePrefixCount,
    needsExplicitRefLabel,
  };
}

function findSegmentPromptWordCount(
  targetWords: string[],
  preText: string,
  similarWords: string[]
): number {
  const preWords = normalizeArabicWords(preText);
  if (preWords.length > 0) {
    const combinedWords = [...preWords, ...similarWords];
    const combinedStart = findSubsequenceStart(targetWords, combinedWords);
    if (combinedStart >= 0) return combinedStart + combinedWords.length;
  }

  const similarStart = findSubsequenceStart(targetWords, similarWords);
  if (similarStart >= 0) return similarStart + similarWords.length;

  return 0;
}

function findSubsequenceStart(words: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > words.length) return -1;
  for (let start = 0; start <= words.length - needle.length; start++) {
    let matched = true;
    for (let i = 0; i < needle.length; i++) {
      if (words[start + i] !== needle[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }
  return -1;
}

function inferTailWordCount(cue: string, tail5: string | null, textClean: string): number {
  const ayahWords = normalizeArabicWords(textClean);
  if (ayahWords.length === 0) return 0;

  const cueWords = normalizeArabicWords(cue);
  const tail5Words = normalizeArabicWords(tail5 ?? "");
  const cueMatch = suffixMatchCount(ayahWords, cueWords);
  if (cueMatch > 0) return cueMatch;

  const tail5Match = suffixMatchCount(ayahWords, tail5Words);
  if (tail5Match > 0) return tail5Match;

  const fallback = cueWords.length || tail5Words.length || 1;
  return Math.min(fallback, ayahWords.length);
}

function suffixMatchCount(words: string[], suffix: string[]): number {
  if (suffix.length === 0 || suffix.length > words.length) return 0;
  const start = words.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    if (words[start + i] !== suffix[i]) return 0;
  }
  return suffix.length;
}

function splitQcf2Words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function splitQuranWords(text: string): string[] {
  return text
    .replace(/[۞۩﴿﴾0-9٠-٩]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function normalizeArabicWords(text: string): string[] {
  const normalized = text
    .replace(/\(و\)/g, " ")
    .replace(/لا(?=[\u0621-\u064A])/g, "لا ")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/[^\u0621-\u064A\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.split(" ") : [];
}

async function getSmartDeckDueRows(
  db: SQLiteDatabase,
  deckId: SmartDeckId,
  dueUntil: string,
  now: string
): Promise<StudyCardRow[]> {
  if (deckId === SMART_DECK_IDS.retention) {
    await migrateLegacyRetentionDecks(db);
  }
  const ids = await getSmartDeckCandidateCardIds(db, deckId);
  if (ids.length === 0) return [];
  const rows: StudyCardRow[] = [];
  for (const chunk of chunks(ids, SQLITE_PARAM_BATCH)) {
    const placeholders = chunk.map(() => "?").join(",");
    rows.push(...await db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards
        WHERE deck_id = ? AND due <= ? AND ${REVIEWABLE_CARD_SQL} AND id IN (${placeholders})
        ORDER BY due`,
      [deckId, dueUntil, now, ...chunk]
    ));
  }
  return rows.sort((a, b) => a.due.localeCompare(b.due));
}

async function getStudyCardsByIds(
  db: SQLiteDatabase,
  ids: string[],
  deckId: SmartDeckId
): Promise<StudyCardRow[]> {
  const rows: StudyCardRow[] = [];
  for (const chunk of chunks(ids, SQLITE_PARAM_BATCH)) {
    const placeholders = chunk.map(() => "?").join(",");
    rows.push(...await db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`,
      [deckId, ...chunk]
    ));
  }
  return rows;
}

function buildFilterClause(alias: string, filter: BuiltInDeckFilter, params: any[]): string {
  const normalized = normalizeSmartDeckFilter(filter);
  if (normalized.type === "surah") {
    const ranges = normalized.ranges ?? [];
    if (ranges.length === 0) {
      params.push(...normalized.surahs);
      return `${alias}.surah IN (${normalized.surahs.map(() => "?").join(",")})`;
    }
    const rangeSurahs = new Set(ranges.map((range) => range.surah));
    const wholeSurahs = normalized.surahs.filter((surah) => !rangeSurahs.has(surah));
    const clauses: string[] = [];
    if (wholeSurahs.length > 0) {
      params.push(...wholeSurahs);
      clauses.push(`${alias}.surah IN (${wholeSurahs.map(() => "?").join(",")})`);
    }
    for (const range of ranges) {
      params.push(range.surah, range.ayahStart, range.ayahEnd);
      clauses.push(`(${alias}.surah = ? AND ${alias}.ayah BETWEEN ? AND ?)`);
    }
    return `(${clauses.join(" OR ")})`;
  }
  if (normalized.type === "juz") {
    params.push(...normalized.juzNumbers);
    return `EXISTS (
      SELECT 1 FROM juz_map jm
       WHERE jm.juz IN (${normalized.juzNumbers.map(() => "?").join(",")})
         AND jm.surah = ${alias}.surah
         AND ${alias}.ayah BETWEEN jm.ayah_start AND jm.ayah_end
    )`;
  }
  return "";
}

function normalizeNumbers(values: unknown[], min: number, max: number): number[] {
  return Array.from(new Set(
    values
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= min && value <= max)
  )).sort((a, b) => a - b);
}

function normalizeRanges(values: unknown[], surahs: number[]): SurahAyahRange[] {
  const selected = new Set(surahs);
  const ranges = values
    .map((value) => {
      const range = value as Partial<SurahAyahRange>;
      return {
        surah: Number(range?.surah),
        ayahStart: Number(range?.ayahStart),
        ayahEnd: Number(range?.ayahEnd),
      };
    })
    .filter((range) =>
      selected.has(range.surah) &&
      Number.isInteger(range.ayahStart) &&
      Number.isInteger(range.ayahEnd) &&
      range.ayahStart >= 1 &&
      range.ayahEnd <= 286 &&
      range.ayahStart <= range.ayahEnd
    );
  const bySurah = new Map<number, SurahAyahRange>();
  for (const range of ranges) bySurah.set(range.surah, range);
  return Array.from(bySurah.values()).sort((a, b) => a.surah - b.surah);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
