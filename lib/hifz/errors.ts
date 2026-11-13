import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { enqueueSync } from "@/lib/database/sync-queue";
import { addDays, type LocalDate } from "@/lib/habit/dates";
import { createId } from "@/lib/id";

/** ERR-01 error types. */
export const ERROR_TYPES = [
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

export const CORRECTIONS = ["self", "tanbih", "fath", "none"] as const;
export type Correction = (typeof CORRECTIONS)[number];
export type Severity = "jali" | "khafi";

/** Tajweed errors (lahn khafi) are a separate track and never affect hifz scheduling (4.2.1). */
export function severityOf(type: RecitationErrorType): Severity {
  return type === "tajweed" ? "khafi" : "jali";
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
export const INBOX_CLEAN_DAYS_TO_RESOLVE = 2;
/** ERR-03: items expire after 28 days, Duolingo's window for path mistakes. */
export const INBOX_EXPIRY_DAYS = 28;
/** ERR-04: at most this many inbox items join one wird review. */
export const INBOX_ITEMS_PER_REVIEW = 6;

/**
 * ERR-03: the inbox holds uncorrected clear errors and every error that needed a peek or the text.
 * Self-corrected slips, hesitations and tajweed notes are logged but stay out of it.
 */
export function belongsInInbox(type: RecitationErrorType, corrected: Correction): boolean {
  if (type === "tajweed" || type === "hesitation") return false;
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

export async function countMistakeInbox(db: DatabaseExecutor, today: LocalDate): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM recitation_errors
      WHERE resolved_at IS NULL AND deleted_at IS NULL AND local_date >= ?`,
    [addDays(today, -INBOX_EXPIRY_DAYS)],
  );
  return row?.count ?? 0;
}

/** ERR-06: a location wrong in this many separate sessions is a weak spot. */
export const WEAK_SPOT_SESSIONS = 3;

export async function readWeakSpots(db: DatabaseExecutor): Promise<{ surah: number; ayah: number; word: number | null }[]> {
  return db.getAllAsync<{ surah: number; ayah: number; word: number | null }>(
    `SELECT surah, ayah, word FROM recitation_errors
      WHERE deleted_at IS NULL AND ayah IS NOT NULL AND type NOT IN ('tajweed', 'hesitation') AND corrected != 'self'
      GROUP BY surah, ayah, word
     HAVING COUNT(DISTINCT COALESCE(session_id, id)) >= ?`,
    [WEAK_SPOT_SESSIONS],
  );
}

/** Remove one inbox item by hand, for an error logged by mistake. */
export async function dismissInboxItem(database: AppDatabase, { id, now = new Date() }: { id: string; now?: Date }): Promise<void> {
  const at = now.toISOString();
  await database.withTransactionAsync(async (db) => {
    const row = await db.getFirstAsync<RecitationErrorRow>(`SELECT ${ERROR_COLUMNS} FROM recitation_errors WHERE id = ?`, [id]);
    if (!row || row.deleted_at !== null) return;
    await writeError(db, { ...row, deleted_at: at, updated_at: at });
  });
}
