import type { DatabaseExecutor } from "@/lib/database/types";
import { compareSyncTimestamps } from "@/lib/database/sync-timestamps";
import { deviceTimeZone, localDateOf, type LocalDate } from "@/lib/habit/dates";
import { meetsMinimum, tallyReviews } from "@/lib/habit/minimum";
import { putHabitDay } from "@/lib/habit/queries";
import { readHabitSettings } from "@/lib/habit/settings";
import type { HabitDayRow } from "@/lib/habit/types";

type LoggedReview = {
  local_date: LocalDate;
  card_id: string;
  rating: number;
  duration_ms: number | null;
  reviewed_at: string;
  grader: string | null;
  makeup_for: LocalDate | null;
};

const EARNED_RANK: Readonly<Record<string, number>> = { done: 6, made_up: 5 };

function rowFor(date: LocalDate, status: "done" | "made_up", at: string, creditedThrough: string | null): HabitDayRow {
  return {
    local_date: date,
    status,
    earned_status: status,
    reason: null,
    excuse_updated_at: null,
    minimum_met: 1,
    full_met: 0,
    manzil_cycle_completed: 0,
    source_session_id: null,
    credited_through: creditedThrough,
    tz: deviceTimeZone(),
    created_at: at,
    updated_at: at,
  };
}

/**
 * Record wird days that the review log proves but no habit row records: reviews saved by app versions
 * before wird days existed, reviews from several devices that meet a minimum only together, and
 * restored accounts whose old devices never uploaded wird days.
 *
 * Each review counts once, for the day stored on it (STR-08): a review graded toward a make-up
 * (makeup_for) counts only for that missed day, which becomes made up when those reviews meet the
 * minimum; every other review counts for its own local date. A review without a grader comes from
 * an older version, and its day counts if it has any review, the rule those versions showed. It only
 * raises days; merging never lowers a status.
 */
export async function reconcileHabitDaysFromLogs(
  db: DatabaseExecutor,
  { now, dates }: { now: Date; dates?: ReadonlySet<LocalDate> },
): Promise<number> {
  const today = localDateOf(now);
  // After an incremental pull only the pulled reviews' days can change, so only those are read.
  const only = dates ? [...dates] : null;
  const marks = only ? only.map(() => "?").join(", ") : "";
  const [settings, logs, habitRows, firstPasses] = await Promise.all([
    readHabitSettings(db),
    db.getAllAsync<LoggedReview>(
      only
        ? `SELECT local_date, card_id, rating, duration_ms, reviewed_at, grader, makeup_for FROM study_log
            WHERE local_date IN (${marks}) OR makeup_for IN (${marks})`
        : "SELECT local_date, card_id, rating, duration_ms, reviewed_at, grader, makeup_for FROM study_log WHERE local_date IS NOT NULL",
      only ? [...only, ...only] : [],
    ),
    db.getAllAsync<HabitDayRow>("SELECT * FROM habit_days WHERE status IS NOT NULL"),
    // The day each sabaq chunk first passed: its completed step 6 (STR-01), as DAY_TALLY_SQL reads it.
    db.getAllAsync<{ card_id: string; first: LocalDate }>(
      "SELECT card_id, MIN(local_date) AS first FROM study_log WHERE card_id LIKE 'chunk:%' AND rating >= 3 AND local_date IS NOT NULL GROUP BY card_id",
    ),
  ]);
  const firstPassOn = new Map(firstPasses.map((row) => [row.card_id, row.first]));
  const days = new Map(habitRows.map((row) => [row.local_date, row]));
  const own = new Map<LocalDate, LoggedReview[]>();
  const makeUps = new Map<LocalDate, LoggedReview[]>();
  for (const log of logs) {
    const [bucket, day] = log.makeup_for ? [makeUps, log.makeup_for] : [own, log.local_date];
    if (day > today) continue;
    const list = bucket.get(day) ?? [];
    list.push(log);
    bucket.set(day, list);
  }
  const meets = (reviews: LoggedReview[]) =>
    meetsMinimum(
      tallyReviews(
        reviews.map((review) => ({
          cardId: review.card_id,
          durationMs: review.duration_ms,
          sabaqStep: review.rating >= 3 && firstPassOn.get(review.card_id) === review.local_date,
        })),
        { studyCounts: settings.studyCountsTowardMinimum },
      ),
      settings.minimum,
    );
  const rank = (date: LocalDate) => EARNED_RANK[days.get(date)?.earned_status ?? ""] ?? 0;

  let written = 0;
  const at = now.toISOString();
  const allDates = [...new Set([...own.keys(), ...makeUps.keys()])].sort();
  for (const date of allDates) {
    const ownReviews = own.get(date) ?? [];
    if (rank(date) < EARNED_RANK.done && ownReviews.length > 0) {
      if (ownReviews.some((review) => review.grader === null) || meets(ownReviews)) {
        days.set(date, await putHabitDay(db, rowFor(date, "done", at, null)));
        written += 1;
        continue;
      }
    }
    const makeUpReviews = makeUps.get(date) ?? [];
    if (rank(date) < EARNED_RANK.made_up && makeUpReviews.length > 0 && meets(makeUpReviews)) {
      const latest = makeUpReviews.reduce<string>(
        (max, review) => (compareSyncTimestamps(review.reviewed_at, max) > 0 ? review.reviewed_at : max),
        makeUpReviews[0].reviewed_at,
      );
      days.set(date, await putHabitDay(db, rowFor(date, "made_up", at, latest)));
      written += 1;
    }
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
