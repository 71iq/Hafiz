import type { DatabaseExecutor } from "@/lib/database/types";
import { COUNTED_FOR_BACKOFF, type NotificationLogRow } from "@/lib/notifications/types";

const CONVERSION_WINDOW_MS = 2 * 60 * 60 * 1000;
const LOG_RETENTION_DAYS = 90;

const LOG_COLUMNS =
  "id, type, template_id, local_date, scheduled_for, os_id, delivered_at, opened_at, converted, cancelled_at";


type FiredFields = Pick<NotificationLogRow, "scheduled_for" | "cancelled_at"> &
  Partial<Pick<NotificationLogRow, "id" | "delivered_at">>;

export function isFired(row: FiredFields, now: Date, stillScheduled?: ReadonlySet<string>): boolean {
  if (row.delivered_at) return true;
  if (row.cancelled_at !== null || Date.parse(row.scheduled_for) > now.getTime()) return false;
  return !(row.id !== undefined && stillScheduled?.has(row.id));
}

export function responseWindowOf(row: FiredFields): { start: number; end: number } {
  const start = Date.parse(row.scheduled_for);
  const delivered = row.delivered_at ? Date.parse(row.delivered_at) : Number.NaN;
  return { start, end: Math.max(start, Number.isFinite(delivered) ? delivered : start) + CONVERSION_WINDOW_MS };
}

export type LogCursor = Readonly<{ at: string; id: string }>;

export type IgnoredTally = Readonly<{ count: number; since: string | null; cursor: LogCursor | null }>;

type TallyRow = Pick<NotificationLogRow, "id" | "type"> & FiredFields;

function afterCursor(row: TallyRow, cursor: LogCursor | null): boolean {
  if (cursor === null) return true;
  const at = Date.parse(row.scheduled_for);
  const cursorAt = Date.parse(cursor.at);
  return at > cursorAt || (at === cursorAt && row.id > cursor.id);
}

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
    const settlesAt = fired ? responseWindowOf(row).end : Date.parse(row.scheduled_for) + CONVERSION_WINDOW_MS;
    if (!(settlesAt <= now.getTime())) break;
    if (fired && (COUNTED_FOR_BACKOFF as ReadonlySet<string>).has(row.type)) count += 1;
    cursor = { at: row.scheduled_for, id: row.id };
  }
  return { count, since: latestSession, cursor };
}

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

export async function deleteLogRows(db: DatabaseExecutor, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.runAsync(`DELETE FROM notification_log WHERE id IN (${placeholders(ids.length)})`, [...ids]);
}

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
