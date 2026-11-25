import type { AppDatabase } from "@/lib/database/types";
import { getNextEligibleReviewDate } from "@/lib/fsrs/queries";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { REVIEW_LEARN_AHEAD_MS } from "@/lib/fsrs/review-transition";
import { addDays, deviceTimeZone, type LocalDate } from "@/lib/habit/dates";
import { readHabitDayRow, readHabitDays } from "@/lib/habit/queries";
import { readHabitSettings } from "@/lib/habit/settings";
import { loadTodayWird, reviewLeftToday, type TodayWird } from "@/lib/hifz/pages";
import { countDueRemediation, nextRemediationAt } from "@/lib/hifz/remediation";
import { deviceClock, type DayClock } from "@/lib/notifications/clock";
import { buildDayTimes } from "@/lib/notifications/day-times";
import { isRamadan } from "@/lib/notifications/ramadan";
import { readReminderPrefs } from "@/lib/notifications/settings";
import { readPrayerLocation } from "@/lib/prayer/settings";
import { createPrayerTimesLookup } from "@/lib/prayer/times";
import type { ThemeMode, ThemePalette } from "@/lib/settings/context";
import type { WidgetPlanFacts } from "@/lib/widget/copy";
import { widgetAppearance } from "@/lib/widget/palette";
import { readWidgetShowNumbers } from "@/lib/widget/settings";
import { countAyahReviewsDue } from "@/lib/study/daily-queue";
import type { WidgetBuildInput } from "@/lib/widget/timeline";

export type { WidgetBuildInput } from "@/lib/widget/timeline";

export type WidgetLoadOptions = Readonly<{
  now: Date;
  language: "en" | "ar";
  themeMode: ThemeMode;
  effectiveTheme: ThemePalette;
  clock?: DayClock;
}>;

function earliest(dates: readonly (Date | null)[]): Date | null {
  let first: Date | null = null;
  for (const date of dates) if (date && (!first || date.getTime() < first.getTime())) first = date;
  return first;
}

/** Spec 4.4: today's plan facts, matching Home's wirdLeft rule (GOAL-04) and useTodayWird's refresh times. */
async function planFacts(
  db: AppDatabase,
  input: Readonly<{
    now: Date;
    clock: DayClock;
    wird: TodayWird | null;
    remediationDue: number;
    nextRemediation: Date | null;
  }>,
): Promise<WidgetPlanFacts> {
  const { now, clock, wird, remediationDue, nextRemediation } = input;
  const date = clock.dateOf(now);
  const midnight = clock.at(addDays(date, 1), 0).getTime();
  const today = (at: Date | null) => (at && at.getTime() < midnight ? at : null);
  if (!wird) return { date, plan: "none", reviewLeft: false, pagesLeft: 0, minutesLeft: 0, moreDueAt: null };
  if (wird.plan.unit === "ayah") {
    const [ayahReviewsDue, nextEligible] = await Promise.all([
      countAyahReviewsDue(db),
      // The widget follows plan work: for an ayah plan that is Retention's reviews (SPEC 3.5).
      getNextEligibleReviewDate(db, [SMART_DECK_IDS.retention]),
    ]);
    const nextReview = nextEligible ? new Date(nextEligible) : null;
    const later = nextReview && nextReview.getTime() > now.getTime() ? nextReview : null;
    return {
      date,
      plan: "ayah",
      reviewLeft: reviewLeftToday(wird, { remediationDue, ayahReviewsDue }),
      pagesLeft: 0,
      minutesLeft: 0,
      moreDueAt: today(earliest([nextRemediation, later])),
    };
  }
  const pagesLeft = wird.todo.length;
  const nextStep = wird.nextStepAt ? new Date(wird.nextStepAt.getTime() - REVIEW_LEARN_AHEAD_MS) : null;
  return {
    date,
    plan: "pages",
    reviewLeft: reviewLeftToday(wird, { remediationDue, ayahReviewsDue: 0 }),
    pagesLeft,
    minutesLeft: pagesLeft > 0 ? Math.max(1, Math.round(wird.remainingMinutes)) : 0,
    moreDueAt: today(earliest([nextStep, nextRemediation])),
  };
}

/**
 * When today's wird was finished, or null when today is not done or the time is unknown. Today's row
 * is created when the wird is done, so its creation time says when, merged across devices to the
 * earliest. An excuse set first creates the row earlier; then the review session that earned the
 * day says when.
 */
export async function todayFinishedAt(db: AppDatabase, today: LocalDate): Promise<Date | null> {
  const row = await readHabitDayRow(db, today);
  if (row?.earned_status !== "done") return null;
  if (row.excuse_updated_at === null) return new Date(row.created_at);
  if (row.source_session_id === null) return null;
  const session = await db.getFirstAsync<{ updated_at: string }>(
    "SELECT updated_at FROM review_sessions WHERE id = ?",
    [row.source_session_id],
  );
  return session ? new Date(session.updated_at) : null;
}

/**
 * Spec 6.3: everything the widget timeline needs, read from the local database. loadTodayWird fixes
 * today's page list the first time it runs each day, the same write Home makes on its first load.
 * Nothing else is written; the projection settles the habit virtually.
 */
export async function loadWidgetInput(db: AppDatabase, options: WidgetLoadOptions): Promise<WidgetBuildInput> {
  const { now, language } = options;
  const clock = options.clock ?? deviceClock;
  const [days, habitSettings, location, prefs, showNumbers, wird, remediationDue, nextRemediation, finishedAt] =
    await Promise.all([
      readHabitDays(db),
      readHabitSettings(db),
      readPrayerLocation(db),
      readReminderPrefs(db),
      readWidgetShowNumbers(db),
      loadTodayWird(db, now),
      countDueRemediation(db, now),
      nextRemediationAt(db, now),
      todayFinishedAt(db, clock.dateOf(now)),
    ]);
  const prayers = createPrayerTimesLookup(location);
  const plan = await planFacts(db, { now, clock, wird, remediationDue, nextRemediation });
  const dayTimes = { clock, prayers, anchor: prefs.anchor, ramadanAnchor: prefs.ramadanAnchor, isRamadan };
  return {
    now,
    clock,
    timeZone: deviceTimeZone(now),
    habit: { days, pause: habitSettings.pause },
    prayers,
    eveningStartsAt: (date) => buildDayTimes(dayTimes, date).atRiskAt,
    plan,
    language,
    appearance: widgetAppearance(options.themeMode, options.effectiveTheme),
    showZayt: habitSettings.showZayt,
    showNumbers,
    todayFinishedAt: finishedAt,
  };
}
