import { addDays, diffDays, type LocalDate } from "@/lib/habit/dates";
import type { HabitSnapshot } from "@/lib/habit/snapshot";
import type { HabitDay, HabitPause } from "@/lib/habit/types";
import { userState } from "@/lib/habit/user-state";
import type { DayPrayerTimes } from "@/lib/prayer/times";
import type { DayClock } from "@/lib/notifications/clock";
import { buildDayTimes, isQuietAt, makeUpCutoff, type DayTimesInput, type ReminderDayTimes } from "@/lib/notifications/day-times";
import { createHabitProjector, type HabitProjector } from "@/lib/notifications/habit-projection";
import type { GroupPending, RemindLaterPending } from "@/lib/notifications/settings";
import { chooseTemplate, type TemplateUse, type TemplateVars } from "@/lib/notifications/templates";
import { COUNTED_FOR_BACKOFF, type NotificationType, type PlannedSlot, type ReminderPrefs, type ReminderRoute } from "@/lib/notifications/types";

/** NOT-04: individual dated notifications for the next 7 days. */
export const PLAN_HORIZON_DAYS = 7;
/** NOT-07: 2 a day, or 3 on an at-risk day with the late reminder enabled. */
const DAILY_CAP = 2;
const LATE_DAY_CAP = 3;
/** 6.3: dormant users get one message a week for 4 weeks, then monthly until 6 months. */
const DORMANT_WEEKLY_DAYS: readonly number[] = [30, 37, 44, 51];
const DORMANT_MONTHLY_UNTIL_DAYS = 183;
const MAKE_UP_LEAD_MINUTES = 90;
const GROUP_BATCH_MINUTES = 30;
const MINUTE = 60_000;
/** A Monday. Every-other-day back-off counts from here, so the days stay put across replans. */
const BACKOFF_EPOCH: LocalDate = "2026-01-05";

/** NOT-09, spec 8.11. */
export type BackoffLevel = 0 | 1 | 2;

export function backoffLevel(consecutiveIgnored: number): BackoffLevel {
  return consecutiveIgnored >= 14 ? 2 : consecutiveIgnored >= 7 ? 1 : 0;
}

export type HabitInput = Readonly<{ days: readonly HabitDay[]; pause: HabitPause | null }>;

/** Values the copy can mention for a date. The hifz plan can fill pages, minutes, range and manzil later. */
export type ReminderFactValues = Readonly<{
  surah?: number;
  pages?: number;
  minutes?: number;
  range?: string;
  manzil?: number;
}>;

/** A notification that already fired on this device. Cancelled ones are never included. */
export type DeliveredReminder = Readonly<{ type: string; templateId: string; localDate: LocalDate; at: Date }>;

export type PlannerInput = Readonly<{
  now: Date;
  clock: DayClock;
  prefs: ReminderPrefs;
  prayers: (date: LocalDate) => DayPrayerTimes | null;
  isRamadan: (date: LocalDate) => boolean;
  /** The first day of Ramadan, for the one dormant-user invitation (6.3). */
  isRamadanStart: (date: LocalDate) => boolean;
  habit: HabitInput;
  /** The user's minimum wird, so "one page is enough" copy stays true. */
  minimum: Readonly<{ pages: number; minutes: number }>;
  /** 0 is Sunday. Weekly back-off reminds on this day. */
  weekStart: number;
  backoff: BackoffLevel;
  /**
   * The ignored reminders in a row behind `backoff` (NOT-09). With it, the plan projects the tally
   * through the batch: each planned reminder that counts toward back-off is taken as ignored before
   * the next one, since any session reschedules with the tally reset. Without it, `backoff` holds
   * for every day.
   */
  ignoredCount?: number;
  delivered: readonly DeliveredReminder[];
  /**
   * Reminders whose time passed that the OS still holds. They are not delivered yet, but will show, so
   * they count toward their day's cap (NOT-07).
   */
  late?: readonly DeliveredReminder[];
  remindLater: RemindLaterPending | null;
  groupPending: GroupPending | null;
  facts: (date: LocalDate) => ReminderFactValues;
  /** Templates already chosen for a `type|localDate`, kept when still eligible so replans are stable. */
  preferredTemplates?: ReadonlyMap<string, string>;
  random?: () => number;
  horizonDays?: number;
}>;

export type SkipReason =
  | "past"
  | "expired"
  | "quiet"
  | "backoff"
  | "cap"
  | "no_template"
  | "state_changed"
  | "sent";
export type SkippedSlot = Readonly<{ type: NotificationType; localDate: LocalDate; at: Date; reason: SkipReason }>;
export type PlanResult = Readonly<{ slots: PlannedSlot[]; skipped: SkippedSlot[] }>;

type Candidate = {
  type: NotificationType;
  localDate: LocalDate;
  at: Date;
  vars: TemplateVars;
  route: ReminderRoute;
  /** Lower keeps its place first when the daily cap is reached. */
  priority: number;
  exemptQuiet: boolean;
  backoff: boolean;
  late: boolean;
  times: ReminderDayTimes;
  /** See PlannedSlot.existingOnly. */
  existingOnly?: boolean;
};

/** NOT-05b: the streak state a remind-later follow-up was scheduled under. */
export function streakFingerprint(snapshot: HabitSnapshot): string {
  return `${snapshot.streak.length}|${snapshot.graceHeld}|${snapshot.headline.kind}`;
}

const COVERED_TODAY = new Set(["done_today", "excused_today", "paused"]);

/**
 * Today already has its wird, an excuse or a pause. The headline alone is not enough: an open
 * earn-back leads the headline even on a day that is already done.
 */
export function isCoveredToday(snapshot: HabitSnapshot): boolean {
  return snapshot.streak.todayStatus !== null || COVERED_TODAY.has(snapshot.headline.kind);
}

/**
 * Today is excused or paused: the user set the day aside, so nothing presses them to recite. A day
 * already done is not set aside; yesterday's open make-up can still be reminded then (STR-07).
 */
function isSetAsideToday(snapshot: HabitSnapshot, pause: HabitPause | null, date: LocalDate): boolean {
  const status = snapshot.streak.todayStatus;
  return status === "excused" || status === "paused" || (pause !== null && pause.start <= date && date <= pause.end);
}

function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

function keptByBackoff(level: BackoffLevel, date: LocalDate, weekday: number, weekStart: number): boolean {
  if (level === 0) return true;
  if (level === 1) return mod(diffDays(BACKOFF_EPOCH, date), 2) === 0;
  return weekday === weekStart;
}

function minutesBefore(at: Date, minutes: number): Date {
  return new Date(at.getTime() - minutes * MINUTE);
}

/**
 * Spec 8.9. Plans every reminder for the next 7 local days from habit state, preferences and what
 * already fired. Pure: the platform adapter schedules the result.
 *
 * Rules: nothing on a day already done, excused or paused (NOT-05); quiet hours except the opt-in
 * late reminder and a Ramadan anchor the user chose (NOT-08, NOT-10); every slot inside its own
 * date (NOT-06); back-off (NOT-09); the daily cap with follow-ups and group messages counted
 * (NOT-07); follow-up skip rules (NOT-05b); random template choice without repeats (NOT-12).
 */
export function planNotifications(input: PlannerInput): PlanResult {
  const { now, clock, prefs } = input;
  if (!prefs.enabled) return { slots: [], skipped: [] };
  const today = clock.dateOf(now);
  const horizon = input.horizonDays ?? PLAN_HORIZON_DAYS;
  const dayTimesInput: DayTimesInput = {
    clock,
    prayers: input.prayers,
    anchor: prefs.anchor,
    ramadanAnchor: prefs.ramadanAnchor,
    isRamadan: input.isRamadan,
  };
  const timesCache = new Map<LocalDate, ReminderDayTimes>();
  const timesFor = (date: LocalDate) => {
    if (!timesCache.has(date)) timesCache.set(date, buildDayTimes(dayTimesInput, date));
    return timesCache.get(date)!;
  };
  // The history is settled once; every slot below projects from that summary.
  const project = createHabitProjector(input, today);
  const sharedVars = (date: LocalDate): TemplateVars => {
    const facts = input.facts(date);
    return {
      ...facts,
      onePage: input.minimum.pages <= 1 ? 1 : undefined,
      fiveMinutes: input.minimum.minutes <= 5 ? 1 : undefined,
    };
  };

  const candidates: Candidate[] = [];
  const skipped: SkippedSlot[] = [];
  const once = (type: NotificationType, from: LocalDate, to: LocalDate) =>
    input.delivered.some((item) => item.type === type && item.localDate >= from && item.localDate <= to) ||
    candidates.some((item) => item.type === type && item.localDate >= from && item.localDate <= to);

  for (let offset = 0; offset < horizon; offset += 1) {
    const date = addDays(today, offset);
    const times = timesFor(date);
    const weekday = clock.weekdayOf(date);
    const base = sharedVars(date);
    const add = (candidate: Omit<Candidate, "localDate" | "times">) => candidates.push({ ...candidate, localDate: date, times });

    // Morning slot: one of make-up, earn-back, grace note, wird reminder or comeback.
    const morning = project(date, times.anchorAt);
    const headline = morning.snapshot.headline;
    const length = morning.snapshot.streak.length;
    const prayerVar = prefs.anchor.kind === "prayer" && !times.ramadanAnchor ? prefs.anchor.prayer : undefined;
    const wirdVars: TemplateVars = {
      ...base,
      n: length >= 2 ? length : undefined,
      next: length >= 1 ? length + 1 : undefined,
      prayer: prayerVar,
    };
    // Slots at the anchor come at the time the user chose for reminders (3.3), so quiet hours, which
    // keep unasked-for messages out of the night, do not apply to them. Otherwise an anchor such as
    // 90 minutes after Isha could never fire.
    const wirdCandidate = () =>
      add({
        type: "wird_reminder",
        at: times.anchorAt,
        vars: wirdVars,
        route: "wird",
        priority: 1,
        exemptQuiet: true,
        backoff: true,
        late: false,
      });

    // 8.9: the make-up reminder comes at the anchor, or 90 minutes before the cutoff when that is earlier.
    const cutoffAt = makeUpCutoff(input, addDays(date, -1));
    const leadAt = minutesBefore(cutoffAt, MAKE_UP_LEAD_MINUTES);
    const makeUpAt = leadAt.getTime() < times.anchorAt.getTime() ? leadAt : times.anchorAt;
    const makeUp = project(date, makeUpAt).snapshot;

    // Home shows yesterday's open make-up even on an excused or paused day, but a reminder to recite
    // today would press on a day the user set aside, so it is not sent then. A day already done is
    // not set aside: another device may have recorded it while yesterday is still makeable here.
    // Once the cutoff has passed nothing can be made up, so a make-up alarm the OS delivers late is
    // not kept as a slot whose time merely passed (reconcileReminders); the projection at the slot's
    // own time still shows the window open.
    if (
      makeUp.headline.kind === "make_up_open" &&
      input.now.getTime() < cutoffAt.getTime() &&
      !isSetAsideToday(makeUp, input.habit.pause, date) &&
      prefs.types.makeup_window
    ) {
      add({
        type: "makeup_window",
        at: makeUpAt,
        vars: {
          ...base,
          n: makeUp.streak.length >= 1 ? makeUp.streak.length : undefined,
          cutoff: times.prayerTimesSet ? "dhuhr" : "12:30",
        },
        route: "wird",
        priority: 1,
        exemptQuiet: false,
        backoff: true,
        late: false,
      });
    } else if (!isCoveredToday(morning.snapshot)) {
      if (
        headline.kind === "earn_back" &&
        prefs.types.earnback_open &&
        !once("earnback_open", headline.earnBack.windowStart, headline.earnBack.windowEnd)
      ) {
        add({
          type: "earnback_open",
          at: times.anchorAt,
          vars: { ...base, n: headline.earnBack.brokenLength },
          route: "home",
          priority: 1,
          exemptQuiet: true,
          backoff: false,
          late: false,
        });
      } else if (
        headline.kind === "at_risk" &&
        morning.snapshot.recentGraceDay !== null &&
        prefs.types.grace_used &&
        !once("grace_used", addDays(morning.snapshot.recentGraceDay, 1), addDays(morning.snapshot.recentGraceDay, 2))
      ) {
        add({
          type: "grace_used",
          at: times.anchorAt,
          vars: { ...base, n: length, g: morning.snapshot.graceHeld },
          route: "home",
          priority: 1,
          exemptQuiet: true,
          backoff: false,
          late: false,
        });
      } else if (headline.kind === "at_risk" || headline.kind === "empty" || headline.kind === "make_up_open") {
        if (prefs.types.wird_reminder) wirdCandidate();
      } else if (prefs.types.comeback) {
        const comeback = comebackCadence(morning.days, date, weekday, input.isRamadanStart(date));
        if (comeback) {
          add({
            type: "comeback",
            at: times.anchorAt,
            vars: { ...base, ramadan: comeback.ramadan ? 1 : undefined },
            route: "wird",
            priority: 1,
            exemptQuiet: true,
            backoff: comeback.backoff,
            late: false,
          });
        }
      }
    }

    // Evening: streak at risk (5.8.2), only with a streak of 2 or more and no wird yet.
    if (prefs.types.streak_at_risk) {
      const evening = project(date, times.atRiskAt).snapshot;
      if (evening.headline.kind === "at_risk" && evening.streak.length >= 2) {
        add({
          type: "streak_at_risk",
          at: times.atRiskAt,
          vars: { ...base, n: evening.streak.length, next: evening.streak.length + 1 },
          route: "wird",
          priority: 2,
          exemptQuiet: false,
          backoff: true,
          late: false,
        });
      }
    }

    // Late reminder: opt-in and exempt from quiet hours. Planning at 23:00 or later schedules no new
    // one for today, but keeps one already set, so a replan late in the evening does not cancel it.
    if (prefs.types.late_reminder) {
      const lateDay = project(date, times.lateAt).snapshot;
      if (lateDay.headline.kind === "at_risk" && lateDay.streak.length >= 2) {
        const lateHour = date === today && clock.minutesOf(now) >= 23 * 60;
        add({
          existingOnly: lateHour || undefined,
          type: "late_reminder",
          at: times.lateAt,
          vars: {
            ...base,
            n: lateDay.streak.length,
            cutoff: input.prayers(addDays(date, 1)) ? "dhuhr" : "12:30",
          },
          route: "wird",
          priority: 5,
          exemptQuiet: true,
          backoff: true,
          late: true,
        });
      }
    }

    // Friday al-Kahf: opt-in, independent of the wird, stopped only by a pause (STR-13).
    if (prefs.types.friday_kahf && weekday === 5 && project(date, times.kahfAt).snapshot.headline.kind !== "paused") {
      add({
        type: "friday_kahf",
        at: times.kahfAt,
        vars: {},
        route: "kahf",
        priority: 3,
        exemptQuiet: false,
        backoff: false,
        late: false,
      });
    }
  }

  const remindLater = remindLaterCandidate(input, today, timesFor, project, sharedVars, skipped);
  if (remindLater) candidates.push(remindLater);
  const group = groupCandidate(input, timesFor, today, horizon);
  if (group) candidates.push(group);

  // Timing filters. A reminder that already fired is not sent again that day, even at a new time;
  // each "Remind me in 1 hour" request is its own follow-up.
  const sent = (candidate: Candidate) =>
    candidate.type !== "remind_later" &&
    input.delivered.some((item) => item.type === candidate.type && item.localDate === candidate.localDate);
  // NOT-07 caps per date, counting everything that already fired that day, follow-ups and group
  // messages included. A follow-up ranks first, so it takes the place of the lowest-ranked later
  // reminder of its day only when the cap would otherwise be exceeded.
  const capDate = (date: LocalDate, list: readonly Candidate[]) => {
    const kept: Candidate[] = [];
    const dropped: Candidate[] = [];
    let used =
      input.delivered.filter((item) => item.localDate === date && item.at.getTime() <= now.getTime()).length +
      (input.late ?? []).filter((item) => item.localDate === date).length;
    const ordered = [...list].sort((a, b) => a.priority - b.priority || a.at.getTime() - b.at.getTime());
    for (const candidate of ordered.filter((item) => !item.late)) {
      if (used < DAILY_CAP) {
        kept.push(candidate);
        used += 1;
      } else dropped.push(candidate);
    }
    for (const candidate of ordered.filter((item) => item.late)) {
      if (used < LATE_DAY_CAP) {
        kept.push(candidate);
        used += 1;
      } else dropped.push(candidate);
    }
    return { kept, dropped };
  };

  // Day by day in date order: the timing filters, then the cap. A reminder sent and left unanswered
  // until a session, which replans, counts as ignored for the reminders after it (NOT-09), but only
  // one the cap keeps is sent. So within a day the timing runs again counting only the reminders the
  // first pass kept, and the next day starts from the kept ones.
  const accepted: Candidate[] = [];
  let projectedIgnored = input.ignoredCount ?? null;
  const byDate = new Map<LocalDate, Candidate[]>();
  for (const candidate of [...candidates].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    byDate.set(candidate.localDate, [...(byDate.get(candidate.localDate) ?? []), candidate]);
  }
  for (const date of [...byDate.keys()].sort()) {
    const list = byDate.get(date)!;
    const dayStart = projectedIgnored;
    const timeDate = (counts: (candidate: Candidate) => boolean) => {
      const timed: Candidate[] = [];
      const late: SkippedSlot[] = [];
      let projected = dayStart;
      for (const candidate of list) {
        const level = projected === null ? input.backoff : backoffLevel(projected);
        const reason = timingProblem(candidate, now, level, input.weekStart, clock) ?? (sent(candidate) ? "sent" : null);
        if (reason) late.push({ type: candidate.type, localDate: candidate.localDate, at: candidate.at, reason });
        else {
          timed.push(candidate);
          if (projected !== null && COUNTED_FOR_BACKOFF.has(candidate.type) && counts(candidate)) projected += 1;
        }
      }
      return { timed, skippedHere: late, ...capDate(date, timed) };
    };
    const first = timeDate(() => true);
    const firstKept = new Set(first.kept);
    const final = first.dropped.length === 0 ? first : timeDate((candidate) => firstKept.has(candidate));
    skipped.push(...final.skippedHere);
    for (const candidate of final.dropped) skipped.push({ type: candidate.type, localDate: date, at: candidate.at, reason: "cap" });
    accepted.push(...final.kept);
    if (dayStart !== null) projectedIgnored = dayStart + final.kept.filter((candidate) => COUNTED_FOR_BACKOFF.has(candidate.type)).length;
  }

  // Templates, in time order so earlier slots count toward later no-repeat and citation checks.
  const random = input.random ?? Math.random;
  const history: TemplateUse[] = input.delivered.map((item) => ({ templateId: item.templateId, at: item.at }));
  const slots: PlannedSlot[] = [];
  for (const candidate of accepted.sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const template = chooseTemplate({
      type: candidate.type,
      at: candidate.at,
      vars: candidate.vars,
      history,
      random,
      preferredId: input.preferredTemplates?.get(`${candidate.type}|${candidate.localDate}`) ?? null,
    });
    if (!template) {
      skipped.push({ type: candidate.type, localDate: candidate.localDate, at: candidate.at, reason: "no_template" });
      continue;
    }
    history.push({ templateId: template.id, at: candidate.at });
    const vars: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(candidate.vars)) if (value !== undefined) vars[key] = value;
    slots.push({
      type: candidate.type,
      localDate: candidate.localDate,
      at: candidate.at,
      templateId: template.id,
      vars,
      route: candidate.route,
      ...(candidate.existingOnly ? { existingOnly: true } : {}),
    });
  }
  return { slots, skipped };
}

function timingProblem(
  candidate: Candidate,
  now: Date,
  level: BackoffLevel,
  weekStart: number,
  clock: DayClock,
): SkipReason | null {
  const at = candidate.at.getTime();
  if (at <= now.getTime()) return "past";
  if (at >= candidate.times.endsAt.getTime() || clock.dateOf(candidate.at) !== candidate.localDate) return "expired";
  if (!candidate.exemptQuiet && isQuietAt(candidate.times, candidate.at)) return "quiet";
  if (candidate.backoff && !keptByBackoff(level, candidate.localDate, clock.weekdayOf(candidate.localDate), weekStart)) {
    return "backoff";
  }
  return null;
}

/**
 * 6.3 cadence for a user without a live streak. At-risk weekly: daily. At-risk monthly: Fridays,
 * Mondays and the 1st of the month (fresh starts). Dormant: weekly for 4 weeks, then the 1st of
 * each month until 6 months, then stop, except one invitation on the first day of Ramadan.
 */
export function comebackCadence(
  days: readonly HabitDay[],
  date: LocalDate,
  weekday: number,
  ramadanStart: boolean,
): { backoff: boolean; ramadan: boolean } | null {
  const past = days.filter((day) => day.localDate < date).map((day) => day.localDate);
  if (past.length === 0) return null;
  const active = new Set(days.filter((day) => day.localDate <= date).map((day) => day.localDate));
  const firstDate = past.reduce((min, value) => (value < min ? value : min));
  const lastActive = past.reduce((max, value) => (value > max ? value : max));
  const state = userState(active, firstDate, date);
  const firstOfMonth = date.endsWith("-01");
  if (state === "at_risk_weekly") return { backoff: true, ramadan: false };
  if (state === "at_risk_monthly") {
    return weekday === 5 || weekday === 1 || firstOfMonth ? { backoff: true, ramadan: false } : null;
  }
  if (state === "dormant") {
    if (ramadanStart) return { backoff: false, ramadan: true };
    const since = diffDays(lastActive, date);
    if (DORMANT_WEEKLY_DAYS.includes(since)) return { backoff: false, ramadan: false };
    if (since <= DORMANT_MONTHLY_UNTIL_DAYS && firstOfMonth && since > DORMANT_WEEKLY_DAYS[DORMANT_WEEKLY_DAYS.length - 1]) {
      return { backoff: false, ramadan: false };
    }
  }
  return null;
}

function remindLaterCandidate(
  input: PlannerInput,
  today: LocalDate,
  timesFor: (date: LocalDate) => ReminderDayTimes,
  project: HabitProjector,
  sharedVars: (date: LocalDate) => TemplateVars,
  skipped: SkippedSlot[],
): Candidate | null {
  const pending = input.remindLater;
  if (!pending || !input.prefs.types.remind_later) return null;
  const at = new Date(pending.at);
  const date = pending.local_date;
  if (!Number.isFinite(at.getTime())) return null;
  const skip = (reason: SkipReason) => {
    skipped.push({ type: "remind_later", localDate: date, at, reason });
    return null;
  };
  if (date < today || input.clock.dateOf(at) !== date) return skip("expired");
  // Coverage and the streak state come before "past": a follow-up past its time that the OS still
  // holds is kept only while it is still due (reconcileReminders), so a day completed, excused or
  // paused since then cancels it.
  const state = project(date, at).snapshot;
  if (isCoveredToday(state)) return skip("state_changed");
  if (streakFingerprint(project(today, input.now).snapshot) !== pending.fingerprint) return skip("state_changed");
  if (at.getTime() <= input.now.getTime()) return skip("past");
  const length = state.streak.length;
  return {
    type: "remind_later",
    localDate: date,
    at,
    vars: { ...sharedVars(date), next: length >= 1 ? length + 1 : undefined },
    route: "wird",
    priority: 0,
    exemptQuiet: false,
    backoff: false,
    late: false,
    times: timesFor(date),
  };
}

function groupCandidate(
  input: PlannerInput,
  timesFor: (date: LocalDate) => ReminderDayTimes,
  today: LocalDate,
  horizon: number,
): Candidate | null {
  const pending = input.groupPending;
  if (!pending || !input.prefs.types.group_encouragement) return null;
  const { clock } = input;
  const first = new Date(pending.first_received_at);
  if (!Number.isFinite(first.getTime())) return null;
  let at = new Date(Math.max(first.getTime() + GROUP_BATCH_MINUTES * MINUTE, input.now.getTime() + MINUTE));
  let date = clock.dateOf(at);
  const sentOn = (day: LocalDate) =>
    input.delivered.some((item) => item.type === "group_encouragement" && item.localDate === day);
  const morningOf = (day: LocalDate) => clock.at(day, 9 * 60);
  if (at.getTime() < timesFor(date).quietEndsAt.getTime()) at = morningOf(date);
  if (isQuietAt(timesFor(date), at) || sentOn(date)) {
    date = addDays(date, 1);
    at = morningOf(date);
  }
  if (date < today || date >= addDays(today, horizon)) return null;
  return {
    type: "group_encouragement",
    localDate: date,
    at,
    vars: { count: pending.count },
    route: "home",
    priority: 4,
    exemptQuiet: false,
    backoff: false,
    late: false,
    times: timesFor(date),
  };
}
