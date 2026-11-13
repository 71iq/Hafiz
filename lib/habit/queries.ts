import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { enqueueSync } from "@/lib/database/sync-queue";
import { compareSyncTimestamps } from "@/lib/database/sync-timestamps";
import { makeUpCutoffFor, type DhuhrResolver } from "@/lib/habit/cutoff";
import { readDhuhrResolver } from "@/lib/prayer/settings";
import { addDays, datesBetween, deviceTimeZone, diffDays, localDateOf, type LocalDate } from "@/lib/habit/dates";
import { findEarnBack } from "@/lib/habit/earn-back";
import { mergeHabitDays } from "@/lib/habit/merge";
import { DAY_TALLY_SQL, meetsMinimum, minimumProgress, tallyReviews, type WirdTally } from "@/lib/habit/minimum";
import { readHabitSettings, MAX_PAUSE_DAYS, HABIT_SETTING_KEYS, type HabitSettings } from "@/lib/habit/settings";
import { planSettlement, type SettlementWrite } from "@/lib/habit/settle";
import { buildHabitSnapshot, type HabitSnapshot } from "@/lib/habit/snapshot";
import { computeStreak, toDayMap } from "@/lib/habit/streak";
import { toHabitDay, type EarnedStatus, type ExcuseReason, type HabitDay, type HabitDayRow } from "@/lib/habit/types";
import { putUserSetting, removeUserSetting } from "@/lib/database/user-settings";

const HABIT_DAY_COLUMNS =
  "local_date, status, earned_status, reason, excuse_updated_at, minimum_met, full_met, manzil_cycle_completed, source_session_id, credited_through, tz, created_at, updated_at";

/** The upload payload. Flags go up as booleans, which is what the server columns hold. */
export function habitDaySyncData(row: HabitDayRow): Record<string, unknown> {
  return {
    local_date: row.local_date,
    status: row.status,
    earned_status: row.earned_status,
    reason: row.reason,
    excuse_updated_at: row.excuse_updated_at,
    minimum_met: row.minimum_met === 1,
    full_met: row.full_met === 1,
    manzil_cycle_completed: row.manzil_cycle_completed === 1,
    source_session_id: row.source_session_id,
    credited_through: row.credited_through,
    tz: row.tz,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function readHabitDayRow(db: DatabaseExecutor, localDate: LocalDate): Promise<HabitDayRow | null> {
  return db.getFirstAsync<HabitDayRow>(`SELECT ${HABIT_DAY_COLUMNS} FROM habit_days WHERE local_date = ?`, [localDate]);
}

/** Covered days, in date order. */
export async function readHabitDays(db: DatabaseExecutor): Promise<HabitDay[]> {
  const rows = await db.getAllAsync<HabitDayRow>(
    `SELECT ${HABIT_DAY_COLUMNS} FROM habit_days WHERE status IS NOT NULL ORDER BY local_date`,
  );
  return rows.flatMap((row) => toHabitDay(row) ?? []);
}

async function writeHabitDayRow(db: DatabaseExecutor, row: HabitDayRow): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO habit_days (${HABIT_DAY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.local_date,
      row.status,
      row.earned_status,
      row.reason,
      row.excuse_updated_at,
      row.minimum_met,
      row.full_met,
      row.manzil_cycle_completed,
      row.source_session_id,
      row.credited_through,
      row.tz,
      row.created_at,
      row.updated_at,
    ],
  );
}

function sameRow(a: HabitDayRow, b: HabitDayRow): boolean {
  return (Object.keys(a) as (keyof HabitDayRow)[]).every((key) => a[key] === b[key]);
}

/**
 * Merge a local change into the stored day (DB-02) and queue the merged row for upload, with the
 * caller's executor. Pass a transaction when the write belongs to a larger change.
 */
export async function putHabitDay(db: DatabaseExecutor, incoming: HabitDayRow): Promise<HabitDayRow> {
  const existing = await readHabitDayRow(db, incoming.local_date);
  const merged = existing ? mergeHabitDays(existing, incoming) : incoming;
  if (existing && sameRow(existing, merged)) return merged;
  await writeHabitDayRow(db, merged);
  await enqueueSync(db, "habit_days", "UPDATE", merged.local_date, habitDaySyncData(merged));
  return merged;
}

/** Apply a pulled or restored row. It merges like a local change but is not uploaded again. */
export async function applyRemoteHabitDay(db: DatabaseExecutor, remote: HabitDayRow): Promise<void> {
  const existing = await readHabitDayRow(db, remote.local_date);
  const merged = existing ? mergeHabitDays(existing, remote) : remote;
  if (existing && sameRow(existing, merged)) return;
  await writeHabitDayRow(db, merged);
}

/** A recorded day: the app's own status, with no excuse change. */
function earnedDay(
  localDate: LocalDate,
  earned: EarnedStatus,
  at: string,
  extra: Partial<Pick<HabitDayRow, "minimum_met" | "full_met" | "source_session_id" | "credited_through">> = {},
): HabitDayRow {
  return {
    local_date: localDate,
    status: earned,
    earned_status: earned,
    reason: null,
    excuse_updated_at: null,
    minimum_met: extra.minimum_met ?? 0,
    full_met: extra.full_met ?? 0,
    manzil_cycle_completed: 0,
    source_session_id: extra.source_session_id ?? null,
    credited_through: extra.credited_through ?? null,
    tz: deviceTimeZone(),
    created_at: at,
    updated_at: at,
  };
}

/** An excuse set (reason) or withdrawn (null) at `at`. The earned part is left to the merge. */
function excuseChange(localDate: LocalDate, reason: ExcuseReason | null, at: string): HabitDayRow {
  return {
    local_date: localDate,
    status: reason === null ? null : "excused",
    earned_status: null,
    reason,
    excuse_updated_at: at,
    minimum_met: 0,
    full_met: 0,
    manzil_cycle_completed: 0,
    source_session_id: null,
    credited_through: null,
    tz: null,
    created_at: at,
    updated_at: at,
  };
}

type DayReview = { card_id: string; duration_ms: number | null; reviewed_at: string; grader: string | null };

async function readDayReviews(db: DatabaseExecutor, localDate: LocalDate): Promise<DayReview[]> {
  return db.getAllAsync<DayReview>(
    "SELECT card_id, duration_ms, reviewed_at, grader FROM study_log WHERE local_date = ? ORDER BY reviewed_at",
    [localDate],
  );
}

function reviewsAfter(reviews: DayReview[], creditedThrough: string | null): DayReview[] {
  if (!creditedThrough) return reviews;
  return reviews.filter((review) => compareSyncTimestamps(review.reviewed_at, creditedThrough) > 0);
}

function tally(reviews: DayReview[], settings: HabitSettings): WirdTally {
  return tallyReviews(
    reviews.map((review) => ({ cardId: review.card_id, durationMs: review.duration_ms })),
    { studyCounts: settings.studyCountsTowardMinimum },
  );
}

export type WirdProgressEvent =
  | { kind: "none" }
  | { kind: "made_up"; madeUpDay: LocalDate; length: number }
  | { kind: "minimum_met"; length: number }
  | { kind: "earned_back"; length: number; restoredDays: number };

export type WirdProgressContext = Readonly<{
  now: Date;
  sessionId: string | null;
  dhuhr?: DhuhrResolver;
}>;

async function readDayTally(
  db: DatabaseExecutor,
  localDate: LocalDate,
  creditedThrough: string | null,
  settings: HabitSettings,
): Promise<WirdTally> {
  // A made-up day's credited reviews are filtered by instant, which SQL text order cannot do
  // reliably across timestamp spellings, so that rare day tallies in JavaScript.
  if (creditedThrough) return tally(reviewsAfter(await readDayReviews(db, localDate), creditedThrough), settings);
  const row = await db.getFirstAsync<{ page_units: number; counted_ms: number }>(DAY_TALLY_SQL, [
    settings.studyCountsTowardMinimum ? 1 : 0,
    localDate,
  ]);
  return { pageUnits: Number(row?.page_units ?? 0), countedMs: Number(row?.counted_ms ?? 0) };
}

/** Write earned_back for the missed days of a successful earn-back. Returns how many were restored. */
async function restoreEarnBack(db: DatabaseExecutor, today: LocalDate, at: string): Promise<{ restored: number; length: number } | null> {
  const dayMap = toDayMap(await readHabitDays(db));
  const earnBack = findEarnBack(dayMap, today, { makeUpOpen: false });
  if (!earnBack?.succeeded || earnBack.restoreDays.length === 0) return null;
  for (const date of earnBack.restoreDays) {
    await putHabitDay(db, earnedDay(date, "earned_back", at));
    dayMap.set(date, { localDate: date, status: "earned_back", fullMet: false });
  }
  return { restored: earnBack.restoreDays.length, length: computeStreak(dayMap, today, { makeUpOpen: false }).length };
}

async function streakLength(db: DatabaseExecutor, today: LocalDate): Promise<number> {
  return computeStreak(toDayMap(await readHabitDays(db)), today, { makeUpOpen: false }).length;
}

/**
 * Record wird progress after a graded review, inside the grade transaction (DB-01).
 *
 * STR-07, STR-08: when yesterday was missed and its make-up window is open, the first minimum wird
 * today makes up yesterday. The reviews that did it are credited to yesterday only, whatever status
 * yesterday later merges to; later reviews count for today. Otherwise the first minimum wird today
 * marks today done, and a successful earn-back restores the missed days.
 *
 * A grade reads three days and one aggregate row until the minimum is met; the full history is read
 * once, on the review that meets it.
 */
export async function recordWirdProgress(db: DatabaseExecutor, context: WirdProgressContext): Promise<WirdProgressEvent> {
  const { now, sessionId } = context;
  const dhuhr = context.dhuhr ?? (await readDhuhrResolver(db));
  const today = localDateOf(now);
  const yesterday = addDays(today, -1);
  const dayBefore = addDays(today, -2);
  const at = now.toISOString();
  const rows = await db.getAllAsync<HabitDayRow>(
    `SELECT ${HABIT_DAY_COLUMNS} FROM habit_days WHERE local_date IN (?, ?, ?)`,
    [today, yesterday, dayBefore],
  );
  const byDate = new Map(rows.map((row) => [row.local_date, row]));
  if (byDate.get(today)?.status === "done") return { kind: "none" };
  const covered = (date: LocalDate) => (byDate.get(date)?.status ?? null) !== null;
  const settings = await readHabitSettings(db);
  const makeUpOpen = now.getTime() < makeUpCutoffFor(yesterday, dhuhr).getTime();
  const canMakeUp = makeUpOpen && !covered(yesterday) && covered(dayBefore);

  if (canMakeUp) {
    // Rare and short-lived, so this path reads the day's rows: credited_through must be the latest
    // instant, compared as instants because pulled rows can spell timestamps differently.
    const reviews = await readDayReviews(db, today);
    if (!meetsMinimum(tally(reviews, settings), settings.minimum)) return { kind: "none" };
    const latest = reviews.reduce<string | null>(
      (max, review) => (max === null || compareSyncTimestamps(review.reviewed_at, max) > 0 ? review.reviewed_at : max),
      null,
    );
    await putHabitDay(
      db,
      earnedDay(yesterday, "made_up", at, { minimum_met: 1, source_session_id: sessionId, credited_through: latest ?? at }),
    );
    return { kind: "made_up", madeUpDay: yesterday, length: await streakLength(db, today) };
  }

  const credited = byDate.get(yesterday)?.credited_through ?? null;
  if (!meetsMinimum(await readDayTally(db, today, credited, settings), settings.minimum)) return { kind: "none" };

  await putHabitDay(db, earnedDay(today, "done", at, { minimum_met: 1, source_session_id: sessionId }));
  const restored = await restoreEarnBack(db, today, at);
  if (restored) return { kind: "earned_back", length: restored.length, restoredDays: restored.restored };
  return { kind: "minimum_met", length: await streakLength(db, today) };
}

/**
 * GOAL-04: once the minimum is met and nothing is left in today's plan, mark the full wird. A second
 * full wird inside an earn-back window can complete it, so the restore runs in the same transaction.
 * Returns true when this call marked it.
 */
export async function markFullWirdIfComplete(
  database: AppDatabase,
  { now, remaining }: { now: Date; remaining: number },
): Promise<boolean> {
  if (remaining > 0) return false;
  const today = localDateOf(now);
  const at = now.toISOString();
  let marked = false;
  await database.withTransactionAsync(async (db) => {
    const row = await readHabitDayRow(db, today);
    if (!row || row.status !== "done" || row.full_met === 1) return;
    await putHabitDay(db, { ...row, full_met: 1, updated_at: at });
    await restoreEarnBack(db, today, at);
    marked = true;
  });
  return marked;
}

/** Run the idempotent settle pass (8.4) and return what it recorded. */
export async function settleHabitDays(
  database: AppDatabase,
  { now = new Date(), dhuhr: given }: { now?: Date; dhuhr?: DhuhrResolver } = {},
): Promise<SettlementWrite[]> {
  let writes: SettlementWrite[] = [];
  await database.withTransactionAsync(async (db) => {
    const dhuhr = given ?? (await readDhuhrResolver(db));
    const [settings, days] = await Promise.all([readHabitSettings(db), readHabitDays(db)]);
    writes = planSettlement({
      days,
      today: localDateOf(now),
      now,
      makeUpCutoffFor: (missed) => makeUpCutoffFor(missed, dhuhr),
      pause: settings.pause,
    });
    const at = now.toISOString();
    for (const write of writes) await putHabitDay(db, earnedDay(write.localDate, write.status, at));
  });
  return writes;
}

export type HabitOverview = HabitSnapshot & {
  settings: HabitSettings;
  /** Every covered day, in date order, for the calendar. */
  days: readonly HabitDay[];
  /** Progress toward today's minimum, 0 to 1, from reviews not credited to a make-up. */
  minimumProgressToday: number;
};

export async function loadHabitOverview(
  db: DatabaseExecutor,
  { now = new Date(), dhuhr: given }: { now?: Date; dhuhr?: DhuhrResolver } = {},
): Promise<HabitOverview> {
  const today = localDateOf(now);
  const yesterday = addDays(today, -1);
  const [dhuhr, settings, days, reviews, yesterdayRow] = await Promise.all([
    given ?? readDhuhrResolver(db),
    readHabitSettings(db),
    readHabitDays(db),
    readDayReviews(db, today),
    readHabitDayRow(db, yesterday),
  ]);
  const credited = yesterdayRow?.credited_through ?? null;
  const snapshot = buildHabitSnapshot({
    days,
    today,
    now,
    makeUpCutoff: makeUpCutoffFor(yesterday, dhuhr),
    pause: settings.pause,
    goal: settings.goal,
  });
  const ownTally = tally(reviewsAfter(reviews, credited), settings);
  return {
    ...snapshot,
    settings,
    days,
    minimumProgressToday: snapshot.streak.doneToday ? 1 : minimumProgress(ownTally, settings.minimum),
  };
}

/** STR-11: excused days can be marked up to 3 days back and 30 days ahead. */
export const EXCUSE_DAYS_BACK = 3;
export const EXCUSE_DAYS_AHEAD = 30;

function canExcuse(date: LocalDate, today: LocalDate): boolean {
  const offset = diffDays(today, date);
  return offset >= -EXCUSE_DAYS_BACK && offset <= EXCUSE_DAYS_AHEAD;
}

export async function markExcusedDays(
  database: AppDatabase,
  { from, to, reason, now = new Date() }: { from: LocalDate; to: LocalDate; reason: ExcuseReason; now?: Date },
): Promise<void> {
  const today = localDateOf(now);
  const dates = datesBetween(from, to);
  if (dates.length === 0 || !dates.every((date) => canExcuse(date, today))) {
    throw new RangeError("Excused days must be within 3 days back and 30 days ahead");
  }
  const at = now.toISOString();
  await database.withTransactionAsync(async (db) => {
    for (const date of dates) await putHabitDay(db, excuseChange(date, reason, at));
  });
}

/** Withdraw an excuse. Only the excuse goes; a day recited or earned another way stays covered. */
export async function clearExcusedDay(
  database: AppDatabase,
  { date, now = new Date() }: { date: LocalDate; now?: Date },
): Promise<void> {
  const at = now.toISOString();
  await database.withTransactionAsync(async (db) => {
    const row = await readHabitDayRow(db, date);
    if (!row || row.reason === null) return;
    await putHabitDay(db, excuseChange(date, null, at));
  });
}

export async function setHabitPause(
  database: AppDatabase,
  { start, end, now = new Date() }: { start: LocalDate; end: LocalDate; now?: Date },
): Promise<void> {
  const today = localDateOf(now);
  if (start < today || end < start || diffDays(start, end) + 1 > MAX_PAUSE_DAYS) {
    throw new RangeError("A pause starts today or later and lasts at most 60 days");
  }
  await database.withTransactionAsync(async (db) => {
    await putUserSetting(db, HABIT_SETTING_KEYS.pause, JSON.stringify({ start, end }));
  });
  await settleHabitDays(database, { now });
}

/** End a pause now. Days already paused stay in the history. */
export async function endHabitPause(database: AppDatabase): Promise<void> {
  await database.withTransactionAsync((db) => removeUserSetting(db, HABIT_SETTING_KEYS.pause));
}

export async function setStreakGoal(
  database: AppDatabase,
  { target, now = new Date() }: { target: number | null; now?: Date },
): Promise<void> {
  await database.withTransactionAsync(async (db) => {
    if (target === null) await removeUserSetting(db, HABIT_SETTING_KEYS.goal);
    else await putUserSetting(db, HABIT_SETTING_KEYS.goal, JSON.stringify({ target, start: localDateOf(now) }));
  });
}

export type ExcusedDay = Readonly<{ localDate: LocalDate; reason: ExcuseReason; covered: boolean }>;

/** Excused days in a range, for the break sheet. `covered` is false when another status shows instead. */
export async function readExcusedDays(db: DatabaseExecutor, from: LocalDate, to: LocalDate): Promise<ExcusedDay[]> {
  const rows = await db.getAllAsync<{ local_date: LocalDate; reason: ExcuseReason; status: string | null }>(
    "SELECT local_date, reason, status FROM habit_days WHERE reason IS NOT NULL AND local_date >= ? AND local_date <= ? ORDER BY local_date",
    [from, to],
  );
  return rows.map((row) => ({ localDate: row.local_date, reason: row.reason, covered: row.status === "excused" }));
}
