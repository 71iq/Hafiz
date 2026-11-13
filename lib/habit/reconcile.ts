import type { DatabaseExecutor } from "@/lib/database/types";
import { compareSyncTimestamps } from "@/lib/database/sync-timestamps";
import { addDays, deviceTimeZone, localDateOf, type LocalDate } from "@/lib/habit/dates";
import { meetsMinimum, tallyReviews } from "@/lib/habit/minimum";
import { putHabitDay } from "@/lib/habit/queries";
import { readHabitSettings } from "@/lib/habit/settings";
import type { HabitDayRow } from "@/lib/habit/types";

type LoggedReview = {
  local_date: LocalDate;
  card_id: string;
  duration_ms: number | null;
  reviewed_at: string;
  grader: string | null;
};

/**
 * Record wird days that the review log proves but no habit row records: reviews saved by app versions
 * before wird days existed, and restored accounts whose old devices never uploaded wird days.
 *
 * A review without a grader comes from such an older version. Its day counts if it has any review,
 * which is the rule those versions showed the user. Newer reviews must meet the minimum wird.
 * Reviews credited to a made-up day never count again for their own day (STR-08).
 * It only raises days to done; merging never lowers a status.
 */
export async function reconcileHabitDaysFromLogs(
  db: DatabaseExecutor,
  { now, dates }: { now: Date; dates?: ReadonlySet<LocalDate> },
): Promise<number> {
  const today = localDateOf(now);
  // After an incremental pull only the pulled reviews' days can change, so only those are read.
  const only = dates ? [...dates] : null;
  const [settings, logs, habitRows] = await Promise.all([
    readHabitSettings(db),
    db.getAllAsync<LoggedReview>(
      only
        ? `SELECT local_date, card_id, duration_ms, reviewed_at, grader FROM study_log
            WHERE local_date IN (${only.map(() => "?").join(", ")}) ORDER BY reviewed_at`
        : "SELECT local_date, card_id, duration_ms, reviewed_at, grader FROM study_log WHERE local_date IS NOT NULL ORDER BY reviewed_at",
      only ?? [],
    ),
    db.getAllAsync<HabitDayRow>("SELECT * FROM habit_days WHERE status IS NOT NULL"),
  ]);
  const days = new Map(habitRows.map((row) => [row.local_date, row]));
  const byDate = new Map<LocalDate, LoggedReview[]>();
  for (const log of logs) {
    if (log.local_date > today) continue;
    const list = byDate.get(log.local_date) ?? [];
    list.push(log);
    byDate.set(log.local_date, list);
  }

  let written = 0;
  const at = now.toISOString();
  for (const [date, reviews] of [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    // A day already earned by recitation needs nothing. A lower status (grace, excused, paused, made
    // up or earned back) is raised to done when its own reviews prove it; the merge keeps any
    // make-up reservation on the row.
    if (days.get(date)?.earned_status === "done") continue;
    const previous = days.get(addDays(date, -1));
    const credited = previous?.credited_through ?? null;
    const own = credited ? reviews.filter((review) => compareSyncTimestamps(review.reviewed_at, credited) > 0) : reviews;
    if (own.length === 0) continue;
    const legacy = own.some((review) => review.grader === null);
    const met =
      legacy ||
      meetsMinimum(
        tallyReviews(
          own.map((review) => ({ cardId: review.card_id, durationMs: review.duration_ms })),
          { studyCounts: settings.studyCountsTowardMinimum },
        ),
        settings.minimum,
      );
    if (!met) continue;
    const row: HabitDayRow = {
      local_date: date,
      status: "done",
      earned_status: "done",
      reason: null,
      excuse_updated_at: null,
      minimum_met: 1,
      full_met: 0,
      manzil_cycle_completed: 0,
      source_session_id: null,
      credited_through: null,
      tz: deviceTimeZone(),
      created_at: at,
      updated_at: at,
    };
    days.set(date, await putHabitDay(db, row));
    written += 1;
  }
  return written;
}

const LEGACY_RECONCILE_KEY = "device_habit_legacy_reconciled_v1";

/** Run the reconcile once on this device, for reviews saved before wird days were recorded. */
export async function reconcileLegacyHabitDaysOnce(db: DatabaseExecutor, now = new Date()): Promise<void> {
  const done = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [
    LEGACY_RECONCILE_KEY,
  ]);
  if (done?.value === "true") return;
  await reconcileHabitDaysFromLogs(db, { now });
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [LEGACY_RECONCILE_KEY, now.toISOString()],
  );
}
