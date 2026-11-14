import type { DatabaseExecutor } from "@/lib/database/types";
import type { NotificationLogRow, NotificationType } from "@/lib/notifications/types";

/**
 * "Ignored" means no session started within 2 hours of delivery (8.11). The same window marks a
 * conversion. An alarm can show hours after its time (Doze, inexact alarms), so the window runs from
 * the scheduled time to 2 hours after the delivery this device recorded (responseWindowOf).
 */
const CONVERSION_WINDOW_MS = 2 * 60 * 60 * 1000;
/** Rows older than this are pruned. Never-fired rows are removed when they are replaced. */
const LOG_RETENTION_DAYS = 90;

const LOG_COLUMNS =
  "id, type, template_id, local_date, scheduled_for, os_id, delivered_at, opened_at, converted, cancelled_at";

/** Reminders that ask for a session. Kahf and halaqa messages are not counted as ignored. */
const COUNTED_FOR_BACKOFF: ReadonlySet<string> = new Set<NotificationType>([
  "wird_reminder",
  "streak_at_risk",
  "remind_later",
  "late_reminder",
  "makeup_window",
  "grace_used",
  "earnback_open",
  "comeback",
]);

type FiredFields = Pick<NotificationLogRow, "scheduled_for" | "cancelled_at"> &
  Partial<Pick<NotificationLogRow, "id" | "delivered_at">>;

/**
 * A reminder fired when the OS showed it, or when its time passed and the OS no longer holds it. One
 * the OS still lists after its time is late, not delivered: pass the log ids the OS still has
 * scheduled as `stillScheduled`. Without that list (previews), a past reminder counts as fired. A
 * cancelled reminder never counts as delivered, unless the OS had already shown it.
 */
export function isFired(row: FiredFields, now: Date, stillScheduled?: ReadonlySet<string>): boolean {
  if (row.delivered_at) return true;
  if (row.cancelled_at !== null || Date.parse(row.scheduled_for) > now.getTime()) return false;
  return !(row.id !== undefined && stillScheduled?.has(row.id));
}

/**
 * When a session counts as the response to a fired reminder. The reminder showed somewhere between
 * its scheduled time and `delivered_at`, the moment this device first saw it shown, opened or no
 * longer held by the OS (markDelivered, markOpened, markInferredDelivered). Any session within 2
 * hours of the real delivery falls between the scheduled time and 2 hours after `delivered_at`. A row
 * with no recorded delivery (previews) falls back to its scheduled time.
 */
export function responseWindowOf(row: FiredFields): { start: number; end: number } {
  const start = Date.parse(row.scheduled_for);
  const delivered = row.delivered_at ? Date.parse(row.delivered_at) : Number.NaN;
  return { start, end: Math.max(start, Number.isFinite(delivered) ? delivered : start) + CONVERSION_WINDOW_MS };
}

/** A position in the log, in time order with the id breaking ties. */
export type LogCursor = Readonly<{ at: string; id: string }>;

/**
 * NOT-09: reminders ignored since the latest session (`since`, null before any). `cursor` is the last
 * row already looked at, so each run adds only rows after it and pruning old rows never lowers the
 * count.
 */
export type IgnoredTally = Readonly<{ count: number; since: string | null; cursor: LogCursor | null }>;

type TallyRow = Pick<NotificationLogRow, "id" | "type"> & FiredFields;

function afterCursor(row: TallyRow, cursor: LogCursor | null): boolean {
  if (cursor === null) return true;
  const at = Date.parse(row.scheduled_for);
  const cursorAt = Date.parse(cursor.at);
  return at > cursorAt || (at === cursorAt && row.id > cursor.id);
}

/**
 * Adds the reminders ignored after the tally's cursor. A reminder is ignored once it fired and its
 * response window (responseWindowOf) closed with no session, so only rows after the latest session
 * count; a new session starts the tally over. Rows are taken in scheduled order and the cursor stops at
 * the first one that has not settled (its window still open, a late delivery included, or the OS
 * still holds it), so a row that settles early never moves the cursor past an earlier one still
 * open, and none is skipped or counted twice. The cursor never passes a time within the last 2 hours,
 * so a reminder scheduled later always sorts after it.
 */
export function advanceIgnoredTally(
  previous: IgnoredTally | null,
  rows: readonly TallyRow[],
  latestSession: string | null,
  now: Date,
  stillScheduled?: ReadonlySet<string>,
): IgnoredTally {
  const sameSession = previous !== null && previous.since === latestSession;
  let count = sameSession ? previous.count : 0;
  let cursor = sameSession ? previous.cursor : null;
  const sessionAt = latestSession === null ? -Infinity : Date.parse(latestSession);
  const ordered = rows
    .filter((row) => Date.parse(row.scheduled_for) > sessionAt && afterCursor(row, cursor))
    .sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const row of ordered) {
    const fired = isFired(row, now, stillScheduled);
    if (!fired && row.cancelled_at === null) break;
    // A cancelled reminder that never showed waits out the same 2 hours, so the cursor stays behind.
    const settlesAt = fired ? responseWindowOf(row).end : Date.parse(row.scheduled_for) + CONVERSION_WINDOW_MS;
    if (!(settlesAt <= now.getTime())) break;
    if (fired && COUNTED_FOR_BACKOFF.has(row.type)) count += 1;
    cursor = { at: row.scheduled_for, id: row.id };
  }
  return { count, since: latestSession, cursor };
}

/** Fired rows not yet marked converted with a session start inside their response window. */
export function findConversions(
  rows: readonly (Pick<NotificationLogRow, "id" | "converted"> & FiredFields)[],
  sessionStarts: readonly string[],
  now: Date,
  stillScheduled?: ReadonlySet<string>,
): string[] {
  const starts = sessionStarts.map((start) => Date.parse(start)).filter(Number.isFinite);
  return rows
    .filter((row) => row.converted === 0 && isFired(row, now, stillScheduled))
    .filter((row) => {
      const window = responseWindowOf(row);
      return starts.some((start) => start >= window.start && start <= window.end);
    })
    .map((row) => row.id);
}

export async function readLogSince(db: DatabaseExecutor, since: Date): Promise<NotificationLogRow[]> {
  return db.getAllAsync<NotificationLogRow>(
    `SELECT ${LOG_COLUMNS} FROM notification_log WHERE scheduled_for >= ? ORDER BY scheduled_for`,
    [since.toISOString()],
  );
}

export async function readSessionStartsSince(db: DatabaseExecutor, since: Date): Promise<string[]> {
  const rows = await db.getAllAsync<{ started_at: string }>(
    "SELECT started_at FROM review_sessions WHERE started_at >= ? AND deleted_at IS NULL",
    [since.toISOString()],
  );
  return rows.map((row) => row.started_at);
}

/**
 * The latest session on this device or synced to it, however long ago: a session row, or a review in
 * study_log for reviews without one. Back-off counts from here (8.11).
 */
export async function readLatestSessionAt(db: DatabaseExecutor): Promise<string | null> {
  const row = await db.getFirstAsync<{ session: string | null; review: string | null }>(
    `SELECT (SELECT MAX(started_at) FROM review_sessions WHERE deleted_at IS NULL) AS session,
            (SELECT MAX(reviewed_at) FROM study_log) AS review`,
  );
  const candidates = [row?.session, row?.review].filter(
    (value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest));
}

/** Rows the ignored tally has not looked at yet: from `from` (inclusive) on, in time order. */
export async function readBackoffRows(
  db: DatabaseExecutor,
  from: string | null,
): Promise<Pick<NotificationLogRow, "id" | "type" | "scheduled_for" | "cancelled_at" | "delivered_at">[]> {
  return db.getAllAsync(
    `SELECT id, type, scheduled_for, cancelled_at, delivered_at FROM notification_log WHERE scheduled_for >= ?
      ORDER BY scheduled_for, id`,
    [from === null ? "" : new Date(from).toISOString()],
  );
}

export async function readLogRow(db: DatabaseExecutor, id: string): Promise<NotificationLogRow | null> {
  return db.getFirstAsync<NotificationLogRow>(`SELECT ${LOG_COLUMNS} FROM notification_log WHERE id = ?`, [id]);
}

export async function insertLogRow(db: DatabaseExecutor, row: NotificationLogRow): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO notification_log (${LOG_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.type,
      row.template_id,
      row.local_date,
      row.scheduled_for,
      row.os_id,
      row.delivered_at,
      row.opened_at,
      row.converted,
      row.cancelled_at,
    ],
  );
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/** Remove rows for notifications that never fired. They carry no signal for the guardrail metrics. */
export async function deleteLogRows(db: DatabaseExecutor, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.runAsync(`DELETE FROM notification_log WHERE id IN (${placeholders(ids.length)})`, [...ids]);
}

/** Record reminders cancelled just before their time, so they never count as delivered. */
export async function markCancelled(db: DatabaseExecutor, ids: readonly string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await db.runAsync(
    `UPDATE notification_log SET cancelled_at = COALESCE(cancelled_at, ?) WHERE id IN (${placeholders(ids.length)})`,
    [at.toISOString(), ...ids],
  );
}

export async function markConverted(db: DatabaseExecutor, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.runAsync(`UPDATE notification_log SET converted = 1 WHERE id IN (${placeholders(ids.length)})`, [...ids]);
}

export async function markDelivered(db: DatabaseExecutor, ids: readonly string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await db.runAsync(
    `UPDATE notification_log SET delivered_at = COALESCE(delivered_at, ?) WHERE id IN (${placeholders(ids.length)})`,
    [at.toISOString(), ...ids],
  );
}

/**
 * Records a delivery this device inferred rather than saw: the reminder is past its time, was not
 * cancelled, and the OS no longer holds it. It showed at some point before `at`, the first moment this
 * device knew; taking `at` as its delivery is the latest it can have been, so its response window is
 * never closed early.
 */
export async function markInferredDelivered(db: DatabaseExecutor, held: ReadonlySet<string>, at: Date): Promise<void> {
  const ids = [...held];
  const stamp = at.toISOString();
  await db.runAsync(
    `UPDATE notification_log SET delivered_at = ?
      WHERE delivered_at IS NULL AND cancelled_at IS NULL AND scheduled_for <= ?${
        ids.length > 0 ? ` AND id NOT IN (${placeholders(ids.length)})` : ""
      }`,
    [stamp, stamp, ...ids],
  );
}

export async function markOpened(db: DatabaseExecutor, id: string, at: Date): Promise<void> {
  await db.runAsync(
    "UPDATE notification_log SET opened_at = COALESCE(opened_at, ?), delivered_at = COALESCE(delivered_at, ?) WHERE id = ?",
    [at.toISOString(), at.toISOString(), id],
  );
}

export async function pruneLog(db: DatabaseExecutor, now: Date): Promise<void> {
  const before = new Date(now.getTime() - LOG_RETENTION_DAYS * 86_400_000);
  await db.runAsync("DELETE FROM notification_log WHERE scheduled_for < ?", [before.toISOString()]);
}
