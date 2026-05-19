import type { SQLiteDatabase } from "expo-sqlite";
import { enqueueSync } from "@/lib/database/sync-queue";
import { createEmptyCard } from "./scheduler";
import type { StudyCardRow } from "./types";

export const SMART_DECK_IDS = {
  mutashabihat: "default-mutashabihat",
  similarTails: "default-similar-tails",
  qiraat: "default-qiraat",
} as const;

export type SmartDeckId = (typeof SMART_DECK_IDS)[keyof typeof SMART_DECK_IDS];

export type BuiltInDeckFilter =
  | { type: "all" }
  | { type: "surah"; surahs: number[] }
  | { type: "juz"; juzNumbers: number[] };

export type SmartCardKind = "mutashabihat" | "similarTail" | "qiraat";

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
};

export type SmartDeckStats = {
  total: number;
  due: number;
  newCount: number;
};

const SMART_DECK_ID_LIST: SmartDeckId[] = [
  SMART_DECK_IDS.mutashabihat,
  SMART_DECK_IDS.similarTails,
  SMART_DECK_IDS.qiraat,
];

const SMART_CARD_PREFIXES = ["mutashabihat:", "similar-tail:", "qiraat:"];
const SQLITE_PARAM_BATCH = 800;
const INSERT_BATCH = 500;

export function isSmartDeckId(deckId: string | undefined | null): deckId is SmartDeckId {
  return !!deckId && (SMART_DECK_ID_LIST as string[]).includes(deckId);
}

export function isSmartCardId(cardId: string): boolean {
  return SMART_CARD_PREFIXES.some((prefix) => cardId.startsWith(prefix));
}

export function smartDeckFilterKey(deckId: SmartDeckId): string {
  return `smart_deck_filter_${deckId}`;
}

export function normalizeSmartDeckFilter(filter: unknown): BuiltInDeckFilter {
  if (!filter || typeof filter !== "object") return { type: "all" };
  const raw = filter as Partial<BuiltInDeckFilter>;
  if (raw.type === "surah") {
    const surahs = Array.isArray((raw as any).surahs)
      ? normalizeNumbers((raw as any).surahs, 1, 114)
      : [];
    return surahs.length > 0 ? { type: "surah", surahs } : { type: "all" };
  }
  if (raw.type === "juz") {
    const juzNumbers = Array.isArray((raw as any).juzNumbers)
      ? normalizeNumbers((raw as any).juzNumbers, 1, 30)
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
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
    [smartDeckFilterKey(deckId), JSON.stringify(normalized)]
  );
}

export async function getSmartDeckCandidateCardIds(
  db: SQLiteDatabase,
  deckId: SmartDeckId,
  filter?: BuiltInDeckFilter
): Promise<string[]> {
  const activeFilter = filter ?? await readSmartDeckFilter(db, deckId);
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

export async function getSmartDeckStats(
  db: SQLiteDatabase,
  deckId: SmartDeckId
): Promise<SmartDeckStats> {
  const ids = await getSmartDeckCandidateCardIds(db, deckId);
  if (ids.length === 0) return { total: 0, due: 0, newCount: 0 };

  const now = new Date().toISOString();
  const rows = await getStudyCardsByIds(db, ids, deckId);
  const existing = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !existing.has(id)).length;
  return {
    total: ids.length,
    due: rows.filter((row) => row.due <= now).length + missing,
    newCount: rows.filter((row) => row.state === 0).length + missing,
  };
}

export async function materializeSmartDeckCards(
  db: SQLiteDatabase,
  deckId: SmartDeckId,
  limit?: number
): Promise<number> {
  const ids = await getSmartDeckCandidateCardIds(db, deckId);
  if (ids.length === 0) return 0;

  const nowIso = new Date().toISOString();
  const rows = await getStudyCardsByIds(db, ids, deckId);
  const existing = new Set(rows.map((row) => row.id));
  const existingDueCount = rows.filter((row) => row.due <= nowIso).length;
  const targetDueCount = limit && limit > 0 ? Math.min(limit, ids.length) : ids.length;
  const createCount = Math.max(0, targetDueCount - existingDueCount);
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
    created_at: nowIso,
    updated_at: nowIso,
  }));

  await db.withTransactionAsync(async () => {
    for (let i = 0; i < createdRows.length; i += INSERT_BATCH) {
      const batch = createdRows.slice(i, i + INSERT_BATCH);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
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
          row.created_at,
          row.updated_at
        );
      }
      await db.runAsync(
        `INSERT OR IGNORE INTO study_cards
          (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, created_at, updated_at)
         VALUES ${placeholders}`,
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
  limit?: number
): Promise<StudyCardRow[]> {
  const now = new Date().toISOString();
  const safeLimit = limit && limit > 0 ? limit : undefined;

  if (isSmartDeckId(deckId)) {
    const rows = await getSmartDeckDueRows(db, deckId, now);
    return safeLimit ? rows.slice(0, safeLimit) : rows;
  }

  if (deckId) {
    const limitClause = safeLimit ? ` LIMIT ${safeLimit}` : "";
    return db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE deck_id = ? AND due <= ? ORDER BY due${limitClause}`,
      [deckId, now]
    );
  }

  const rows = await db.getAllAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE due <= ? ORDER BY due",
    [now]
  );
  const matchingSmartIds = await getAllMatchingSmartCardIdSet(db);
  const filtered = rows.filter((row) => !isSmartDeckId(row.deck_id) || matchingSmartIds.has(row.id));
  return safeLimit ? filtered.slice(0, safeLimit) : filtered;
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
  }>(
    `SELECT g.cue, g.id AS group_id, r.sort_order AS ref_sort_order,
            r.surah AS ref_surah, r.ayah AS ref_ayah, r.surah_name_ar, r.tail_5,
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
  now: string
): Promise<StudyCardRow[]> {
  const ids = await getSmartDeckCandidateCardIds(db, deckId);
  if (ids.length === 0) return [];
  const rows: StudyCardRow[] = [];
  for (const chunk of chunks(ids, SQLITE_PARAM_BATCH)) {
    const placeholders = chunk.map(() => "?").join(",");
    rows.push(...await db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards
        WHERE deck_id = ? AND due <= ? AND id IN (${placeholders})
        ORDER BY due`,
      [deckId, now, ...chunk]
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
      `SELECT * FROM study_cards WHERE deck_id = ? AND id IN (${placeholders})`,
      [deckId, ...chunk]
    ));
  }
  return rows;
}

function buildFilterClause(alias: string, filter: BuiltInDeckFilter, params: any[]): string {
  const normalized = normalizeSmartDeckFilter(filter);
  if (normalized.type === "surah") {
    params.push(...normalized.surahs);
    return `${alias}.surah IN (${normalized.surahs.map(() => "?").join(",")})`;
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
