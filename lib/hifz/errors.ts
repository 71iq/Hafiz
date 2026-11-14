import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { enqueueSync } from "@/lib/database/sync-queue";
import { addDays, localDateOf, type LocalDate } from "@/lib/habit/dates";
import { similarPair, type SimilarPair } from "@/lib/hifz/similar";
import { removeClearedWeakSpotCards, WEAK_SPOT_ERROR_SQL, WEAK_SPOT_SESSIONS } from "@/lib/hifz/weak-spots";
import { createId } from "@/lib/id";

/** ERR-01 error types. */
const ERROR_TYPES = [
  "skip_word",
  "wrong_word",
  "added_word",
  "harakah",
  "skip_ayah",
  "seam",
  "mutashabih_drift",
  "hesitation",
  "tajweed",
  "waqf_ibtida",
] as const;
export type RecitationErrorType = (typeof ERROR_TYPES)[number];

const CORRECTIONS = ["self", "tanbih", "fath", "none"] as const;
export type Correction = (typeof CORRECTIONS)[number];
export type Severity = "jali" | "khafi";

/** Tajweed errors (lahn khafi) are a separate track and never affect hifz scheduling (4.2.1). */
function severityOf(type: RecitationErrorType): Severity {
  return type === "tajweed" ? "khafi" : "jali";
}

export type VerseKey = Readonly<{ surah: number; ayah: number }>;

/** ERR-01 `sibling_ref`: the verse a drift went into, as 's:a'. */
export function verseRef({ surah, ayah }: VerseKey): string {
  return `${surah}:${ayah}`;
}

/** Read a stored `sibling_ref`. It syncs as free text, so anything other than 's:a' reads as none. */
export function parseVerseRef(ref: string | null): VerseKey | null {
  const match = ref ? /^(\d+):(\d+)$/.exec(ref) : null;
  return match ? { surah: Number(match[1]), ayah: Number(match[2]) } : null;
}

export type RecitationErrorInput = Readonly<{
  type: RecitationErrorType;
  corrected: Correction;
  surah: number;
  ayah: number | null;
  word: number | null;
  siblingRef?: string | null;
}>;

export type RecitationErrorRow = {
  id: string;
  card_id: string;
  session_id: string | null;
  surah: number;
  ayah: number | null;
  word: number | null;
  type: RecitationErrorType;
  severity: Severity;
  corrected: Correction;
  sibling_ref: string | null;
  local_date: LocalDate;
  clean_count: number;
  last_clean_date: LocalDate | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/** ERR-03: items leave the inbox after this many clean recitations on different days. */
const INBOX_CLEAN_DAYS_TO_RESOLVE = 2;
/** ERR-03: items expire after 28 days, Duolingo's window for path mistakes. */
const INBOX_EXPIRY_DAYS = 28;
/** ERR-04: at most this many inbox items join one wird review. */
export const INBOX_ITEMS_PER_REVIEW = 6;

/**
 * ERR-03: the inbox holds uncorrected clear errors and every error that needed a peek or the text.
 * Self-corrected slips, hesitations and tajweed notes are logged but stay out of it.
 */
function belongsInInbox(type: RecitationErrorType, corrected: Correction): boolean {
  if (type === "tajweed" || type === "hesitation") return false;
  // A stumble between pages relearns as its seam card (SCH-06), not as an ayah drill.
  if (type === "seam") return false;
  return corrected !== "self";
}

const ERROR_COLUMNS =
  "id, card_id, session_id, surah, ayah, word, type, severity, corrected, sibling_ref, local_date, clean_count, last_clean_date, resolved_at, created_at, updated_at, deleted_at";

function errorSyncData(row: RecitationErrorRow): Record<string, unknown> {
  return { ...row };
}

async function writeError(db: DatabaseExecutor, row: RecitationErrorRow): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO recitation_errors (${ERROR_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.card_id,
      row.session_id,
      row.surah,
      row.ayah,
      row.word,
      row.type,
      row.severity,
      row.corrected,
      row.sibling_ref,
      row.local_date,
      row.clean_count,
      row.last_clean_date,
      row.resolved_at,
      row.created_at,
      row.updated_at,
      row.deleted_at,
    ],
  );
  await enqueueSync(db, "recitation_errors", "UPDATE", row.id, errorSyncData(row));
}

/** Log the errors of one graded attempt, inside the grade transaction (DB-01). */
export async function insertRecitationErrors(
  db: DatabaseExecutor,
  {
    cardId,
    sessionId,
    errors,
    at,
    localDate,
  }: { cardId: string; sessionId: string | null; errors: readonly RecitationErrorInput[]; at: string; localDate: LocalDate },
): Promise<RecitationErrorRow[]> {
  const rows: RecitationErrorRow[] = errors.map((error) => ({
    id: createId("err"),
    card_id: cardId,
    session_id: sessionId,
    surah: error.surah,
    ayah: error.ayah,
    word: error.word,
    type: error.type,
    severity: severityOf(error.type),
    corrected: error.corrected,
    sibling_ref: error.siblingRef ?? null,
    local_date: localDate,
    clean_count: 0,
    last_clean_date: null,
    resolved_at: belongsInInbox(error.type, error.corrected) ? null : at,
    created_at: at,
    updated_at: at,
    deleted_at: null,
  }));
  for (const row of rows) await writeError(db, row);
  return rows;
}

/**
 * ERR-03: a clean recall of a card (Good or Easy at the hidden level, with no new errors) counts
 * once per day toward resolving that card's open inbox items. The second clean day resolves them.
 */
export async function recordCleanRecitation(
  db: DatabaseExecutor,
  { cardId, at, localDate }: { cardId: string; at: string; localDate: LocalDate },
): Promise<number> {
  const open = await db.getAllAsync<RecitationErrorRow>(
    `SELECT ${ERROR_COLUMNS} FROM recitation_errors
      WHERE card_id = ? AND resolved_at IS NULL AND deleted_at IS NULL AND local_date < ?`,
    [cardId, localDate],
  );
  let resolved = 0;
  for (const row of open) {
    if (row.last_clean_date === localDate) continue;
    const cleanCount = row.clean_count + 1;
    const done = cleanCount >= INBOX_CLEAN_DAYS_TO_RESOLVE;
    if (done) resolved += 1;
    await writeError(db, {
      ...row,
      clean_count: cleanCount,
      last_clean_date: localDate,
      resolved_at: done ? at : null,
      updated_at: at,
    });
  }
  return resolved;
}

export type InboxItem = Readonly<{
  id: string;
  cardId: string;
  surah: number;
  ayah: number | null;
  word: number | null;
  type: RecitationErrorType;
  corrected: Correction;
  siblingRef: string | null;
  localDate: LocalDate;
  cleanCount: number;
}>;

/** Open inbox items, oldest first, that have not expired (ERR-03, ERR-04). */
export async function readMistakeInbox(db: DatabaseExecutor, today: LocalDate, limit?: number): Promise<InboxItem[]> {
  const rows = await db.getAllAsync<RecitationErrorRow>(
    `SELECT ${ERROR_COLUMNS} FROM recitation_errors
      WHERE resolved_at IS NULL AND deleted_at IS NULL AND local_date >= ?
      ORDER BY created_at ASC${limit ? " LIMIT ?" : ""}`,
    limit ? [addDays(today, -INBOX_EXPIRY_DAYS), limit] : [addDays(today, -INBOX_EXPIRY_DAYS)],
  );
  return rows.map((row) => ({
    id: row.id,
    cardId: row.card_id,
    surah: row.surah,
    ayah: row.ayah,
    word: row.word,
    type: row.type,
    corrected: row.corrected,
    siblingRef: row.sibling_ref,
    localDate: row.local_date,
    cleanCount: row.clean_count,
  }));
}

/** MUT-04: a drift's pair is drilled in this many sessions after it; SCH-07: its sibling page in the first. */
export const DRIFT_FOLLOW_UP_SESSIONS = 3;

/**
 * A logged drift into a known sibling whose follow-up sessions are not used up. `sessionsSince`
 * counts the review sessions that build a drill list (wird, mistakes, welcome back), on any device,
 * started after the drift was logged. A session has a row once it grades something, so one opened and
 * left without a grade does not use up a follow-up.
 */
export type DriftFollowUp = Readonly<{ id: string; surah: number; ayah: number; sibling: VerseKey; sessionsSince: number }>;

/**
 * MUT-04, SCH-07: the drifts the next sessions still drill, oldest first. A drift dismissed as not a
 * mistake has none, and one older than the inbox window (ERR-03) has expired. Whether its inbox item is
 * still open does not matter: the pair is drilled for its three sessions either way.
 */
export async function readDriftFollowUps(db: DatabaseExecutor, today: LocalDate): Promise<DriftFollowUp[]> {
  // Times compare through julianday, since synced rows can carry an offset instead of Z.
  const rows = await db.getAllAsync<{ id: string; surah: number; ayah: number; sibling_ref: string; sessions_since: number }>(
    `SELECT e.id, e.surah, e.ayah, e.sibling_ref,
            (SELECT COUNT(*) FROM review_sessions s
              WHERE s.deleted_at IS NULL AND s.kind IN ('wird', 'mistakes', 'welcome_back')
                AND julianday(s.started_at) > julianday(e.created_at)) AS sessions_since
       FROM recitation_errors e
      WHERE e.type = 'mutashabih_drift' AND e.sibling_ref IS NOT NULL AND e.ayah IS NOT NULL
        AND e.deleted_at IS NULL AND e.local_date >= ?
      ORDER BY e.created_at ASC`,
    [addDays(today, -INBOX_EXPIRY_DAYS)],
  );
  return rows.flatMap((row) => {
    const sibling = parseVerseRef(row.sibling_ref);
    if (!sibling || row.sessions_since >= DRIFT_FOLLOW_UP_SESSIONS) return [];
    return [{ id: row.id, surah: row.surah, ayah: row.ayah, sibling, sessionsSince: row.sessions_since }];
  });
}

/** What one drift adds to the next session's drill list (SCH-07, MUT-04). */
export type DriftDrill = Readonly<{
  errorId: string;
  pair: SimilarPair;
  /** SCH-07: the sibling's page, in the first session after the drift only. */
  siblingPage: number | null;
  /** Sessions since the latest drift into this pair: 0 for the first after it, up to 2. */
  sessionsSince: number;
}>;

/**
 * SCH-07, MUT-04: the drill list a new session adds for recent drifts, oldest first: each pair's
 * discrimination prompt for 3 sessions, and the sibling's page in the first. Drifts into the same pair
 * share one prompt, taken from the latest of them, which has had the fewest sessions since.
 */
export async function loadDriftDrills(db: DatabaseExecutor, today: LocalDate): Promise<DriftDrill[]> {
  const drills = new Map<string, DriftDrill>();
  for (const followUp of await readDriftFollowUps(db, today)) {
    const pair = await similarPair(db, followUp, followUp.sibling);
    if (!pair) continue;
    const key = [verseRef(pair.self), verseRef(pair.sibling)].sort().join("|");
    const { sessionsSince } = followUp;
    drills.set(key, { errorId: followUp.id, pair, siblingPage: sessionsSince === 0 ? pair.sibling.page : null, sessionsSince });
  }
  return [...drills.values()];
}

export async function countMistakeInbox(db: DatabaseExecutor, today: LocalDate): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM recitation_errors
      WHERE resolved_at IS NULL AND deleted_at IS NULL AND local_date >= ?`,
    [addDays(today, -INBOX_EXPIRY_DAYS)],
  );
  return row?.count ?? 0;
}

export type WeakSpot = Readonly<{ surah: number; ayah: number; word: number | null }>;

export async function readWeakSpots(db: DatabaseExecutor): Promise<WeakSpot[]> {
  return db.getAllAsync<WeakSpot>(
    `SELECT surah, ayah, word FROM recitation_errors
      WHERE ${WEAK_SPOT_ERROR_SQL} AND ayah IS NOT NULL
      GROUP BY surah, ayah, word
     HAVING COUNT(DISTINCT COALESCE(session_id, id)) >= ?`,
    [WEAK_SPOT_SESSIONS],
  );
}

/**
 * Remove one inbox item by hand, for an error logged by mistake. When that leaves its word wrong in
 * fewer than 3 sessions, the weak spot's cloze card is deleted in the same transaction (ERR-06).
 * Callers refresh the reader's weak-spot markers afterwards.
 */
export async function dismissInboxItem(database: AppDatabase, { id, now = new Date() }: { id: string; now?: Date }): Promise<void> {
  const at = now.toISOString();
  await database.withTransactionAsync(async (db) => {
    const row = await db.getFirstAsync<RecitationErrorRow>(`SELECT ${ERROR_COLUMNS} FROM recitation_errors WHERE id = ?`, [id]);
    if (!row || row.deleted_at !== null) return;
    await writeError(db, { ...row, deleted_at: at, updated_at: at });
    await removeClearedWeakSpotCards(db, [row]);
  });
}

/**
 * ERR-02, ERR-05: the result of a quick drill of one inbox item. A clean recall counts once per day
 * toward resolving it (two clean days resolve it); a miss keeps it open.
 */
export async function recordDrillResult(
  database: AppDatabase,
  { id, clean, now = new Date() }: { id: string; clean: boolean; now?: Date },
): Promise<{ resolved: boolean }> {
  const at = now.toISOString();
  const localDate = localDateOf(now);
  let resolved = false;
  await database.withTransactionAsync(async (db) => {
    const row = await db.getFirstAsync<RecitationErrorRow>(`SELECT ${ERROR_COLUMNS} FROM recitation_errors WHERE id = ?`, [id]);
    if (!row || row.deleted_at !== null || row.resolved_at !== null) return;
    if (!clean || row.last_clean_date === localDate || row.local_date === localDate) return;
    const cleanCount = row.clean_count + 1;
    resolved = cleanCount >= INBOX_CLEAN_DAYS_TO_RESOLVE;
    await writeError(db, {
      ...row,
      clean_count: cleanCount,
      last_clean_date: localDate,
      resolved_at: resolved ? at : null,
      updated_at: at,
    });
  });
  return { resolved };
}
