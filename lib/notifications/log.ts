import type { DatabaseExecutor } from "@/lib/database/types";
import type { NotificationLogRow, NotificationType } from "@/lib/notifications/types";

/** "Ignored" means no session started within 2 hours of delivery (8.11). The same window marks a conversion. */
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

type FiredFields = Pick<NotificationLogRow, "scheduled_for" | "cancelled_at"> & Partial<Pick<NotificationLogRow, "delivered_at">>;

/**
 * A reminder fired when the OS showed it, or when its time passed without it being cancelled. A
 * cancelled reminder never counts as delivered, unless the OS had already shown it.
 */
export function isFired(row: FiredFields, now: Date): boolean {
  if (row.delivered_at) return true;
  return row.cancelled_at === null && Date.parse(row.scheduled_for) <= now.getTime();
}

/**
 * NOT-09: reminders delivered since the latest session whose 2-hour window has passed. Any session
 * resets the count to 0, so only reminders after the latest session start can be ignored ones.
 */
export function countConsecutiveIgnored(
  rows: readonly (Pick<NotificationLogRow, "type"> & FiredFields)[],
  sessionStarts: readonly string[],
  now: Date,
): number {
  const lastSession = sessionStarts.reduce((latest, start) => Math.max(latest, Date.parse(start)), -Infinity);
  const settledBefore = now.getTime() - CONVERSION_WINDOW_MS;
  return rows.filter((row) => {
    if (!COUNTED_FOR_BACKOFF.has(row.type) || !isFired(row, now)) return false;
    const at = Date.parse(row.scheduled_for);
    return at <= settledBefore && at > lastSession;
  }).length;
}

/** Fired rows not yet marked converted that had a session start within 2 hours. */
export function findConversions(
  rows: readonly (Pick<NotificationLogRow, "id" | "converted"> & FiredFields)[],
  sessionStarts: readonly string[],
  now: Date,
): string[] {
  const starts = sessionStarts.map((start) => Date.parse(start)).filter(Number.isFinite);
  return rows
    .filter((row) => row.converted === 0 && isFired(row, now))
    .filter((row) => {
      const at = Date.parse(row.scheduled_for);
      return starts.some((start) => start >= at && start - at <= CONVERSION_WINDOW_MS);
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

/** Rows that can count as ignored reminders: everything scheduled after the latest session. */
export async function readBackoffRows(
  db: DatabaseExecutor,
  after: string | null,
): Promise<Pick<NotificationLogRow, "type" | "scheduled_for" | "cancelled_at" | "delivered_at">[]> {
  return db.getAllAsync(
    `SELECT type, scheduled_for, cancelled_at, delivered_at FROM notification_log WHERE scheduled_for > ?`,
    [after === null ? "" : new Date(after).toISOString()],
  );
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
