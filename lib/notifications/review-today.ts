import type { AppDatabase } from "@/lib/database/types";
import { loadReviewLeft } from "@/lib/hifz/review-left";
import { deviceClock, type DayClock } from "@/lib/notifications/clock";
import { buildDayTimes, reviewFitsDay } from "@/lib/notifications/day-times";
import { isRamadan } from "@/lib/notifications/ramadan";
import { readReminderPrefs } from "@/lib/notifications/settings";
import type { ReminderAnchor } from "@/lib/notifications/types";
import { readPrayerLocation } from "@/lib/prayer/settings";
import { createPrayerTimesLookup } from "@/lib/prayer/times";

/**
 * The second sitting still ahead today (REMIND-07, STR-20): it is on, review is left, and its time is
 * later today and after today's main sitting, the Ramadan time included. Null otherwise, so the
 * session-end commitment names tomorrow's main sitting as before.
 */
export async function loadReviewSittingAhead(
  db: AppDatabase,
  { now = new Date(), clock = deviceClock }: { now?: Date; clock?: DayClock } = {},
): Promise<ReminderAnchor | null> {
  const prefs = await readReminderPrefs(db);
  const review = prefs.reviewAnchor;
  if (!review) return null;
  const [location, left] = await Promise.all([readPrayerLocation(db), loadReviewLeft(db, now)]);
  if (!left.left) return null;
  const date = clock.dateOf(now);
  const times = buildDayTimes(
    {
      clock,
      prayers: createPrayerTimesLookup(location),
      anchor: prefs.anchor,
      reviewAnchor: review,
      ramadanAnchor: prefs.ramadanAnchor,
      isRamadan,
    },
    date,
  );
  const at = times.reviewAt;
  if (!at || at.getTime() <= now.getTime() || !reviewFitsDay(clock, date, times.anchorAt, at)) return null;
  return review;
}
