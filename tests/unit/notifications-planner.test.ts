import * as fc from "fast-check";
import { addDays, type LocalDate } from "@/lib/habit/dates";
import type { DayStatus, HabitDay } from "@/lib/habit/types";
import type { DayClock } from "@/lib/notifications/clock";
import { buildDayTimes, isQuietAt } from "@/lib/notifications/day-times";
import { projectHabit } from "@/lib/notifications/habit-projection";
import {
  backoffLevel,
  comebackCadence,
  planNotifications,
  streakFingerprint,
  type PlannerInput,
} from "@/lib/notifications/planner";
import { templateById } from "@/lib/notifications/templates";
import { DEFAULT_REMINDER_PREFS, WIRD_TYPES, type NotificationType, type ReminderPrefs } from "@/lib/notifications/types";
import type { DayPrayerTimes } from "@/lib/prayer/times";

/** A clock for a named IANA zone, independent of the machine running the tests. */
function zonedClock(timeZone: string): DayClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wall = (at: Date) => {
    const values = Object.fromEntries(parts.formatToParts(at).map((part) => [part.type, part.value]));
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      minutes: Number(values.hour) * 60 + Number(values.minute),
      utcOfWall: Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second)),
    };
  };
  const offsetAt = (ms: number) => wall(new Date(ms)).utcOfWall - Math.floor(ms / 1000) * 1000;
  return {
    at: (date, minutes) => {
      const [year, month, day] = date.split("-").map(Number);
      const guess = Date.UTC(year, month - 1, day, 0, minutes);
      let instant = guess - offsetAt(guess);
      instant = guess - offsetAt(instant);
      return new Date(instant);
    },
    dateOf: (at) => wall(at).date,
    minutesOf: (at) => wall(at).minutes,
    weekdayOf: (date) => {
      const [year, month, day] = date.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    },
  };
}

const RIYADH = zonedClock("Asia/Riyadh");
const LONDON = zonedClock("Europe/London");
const NEW_YORK = zonedClock("America/New_York");

/** 2026-11-12 is a Thursday. */
const TODAY: LocalDate = "2026-11-12";

function days(statuses: Record<LocalDate, DayStatus>): HabitDay[] {
  return Object.entries(statuses)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([localDate, status]) => ({ localDate, status, fullMet: false }));
}

/** `count` done days ending `endOffset` days from TODAY. */
function streak(count: number, endOffset = -1, status: DayStatus = "done"): Record<LocalDate, DayStatus> {
  const result: Record<LocalDate, DayStatus> = {};
  for (let i = 0; i < count; i += 1) result[addDays(TODAY, endOffset - i)] = status;
  return result;
}

function prefsWith(overrides: Omit<Partial<ReminderPrefs>, "types"> & { types?: Partial<ReminderPrefs["types"]> } = {}): ReminderPrefs {
  return {
    ...DEFAULT_REMINDER_PREFS,
    ...overrides,
    types: { ...DEFAULT_REMINDER_PREFS.types, ...(overrides.types ?? {}) },
  };
}

function input(overrides: Partial<PlannerInput> = {}): PlannerInput {
  const clock = overrides.clock ?? RIYADH;
  return {
    now: clock.at(TODAY, 3 * 60),
    clock,
    prefs: DEFAULT_REMINDER_PREFS,
    prayers: () => null,
    isRamadan: () => false,
    isRamadanStart: () => false,
    habit: { days: days(streak(5)), pause: null },
    minimum: { pages: 1, minutes: 5 },
    weekStart: 1,
    backoff: 0,
    delivered: [],
    remindLater: null,
    groupPending: null,
    facts: () => ({}),
    random: () => 0,
    ...overrides,
  };
}

function summary(result: ReturnType<typeof planNotifications>, clock: DayClock = RIYADH) {
  return result.slots.map((slot) => `${slot.localDate} ${String(Math.floor(clock.minutesOf(slot.at) / 60)).padStart(2, "0")}:${String(clock.minutesOf(slot.at) % 60).padStart(2, "0")} ${slot.type}`);
}

function prayerTimes(clock: DayClock, minutes: Record<"fajr" | "sunrise" | "dhuhr" | "asr" | "maghrib" | "isha", number>) {
  return (date: LocalDate): DayPrayerTimes => ({
    fajr: clock.at(date, minutes.fajr),
    sunrise: clock.at(date, minutes.sunrise),
    dhuhr: clock.at(date, minutes.dhuhr),
    asr: clock.at(date, minutes.asr),
    maghrib: clock.at(date, minutes.maghrib),
    isha: clock.at(date, minutes.isha),
  });
}

const WINTER = { fajr: 4 * 60 + 50, sunrise: 6 * 60 + 10, dhuhr: 11 * 60 + 45, asr: 14 * 60 + 50, maghrib: 17 * 60, isha: 18 * 60 + 30 };

describe("planNotifications", () => {
  it("plans the wird reminder after Fajr and the evening at-risk reminder on an open day", () => {
    const result = planNotifications(input());
    expect(summary(result).slice(0, 2)).toEqual([`${TODAY} 05:20 wird_reminder`, `${TODAY} 21:00 streak_at_risk`]);
  });

  it("follows a missed day with the make-up reminder, then keeps the streak through a grace day", () => {
    const result = planNotifications(input());
    const tomorrow = addDays(TODAY, 1);
    expect(summary(result).filter((line) => line.startsWith(tomorrow))).toEqual([
      `${tomorrow} 05:20 makeup_window`,
      `${tomorrow} 21:00 streak_at_risk`,
    ]);
  });

  it("sends nothing about the wird on a day already done, excused or paused (NOT-05)", () => {
    for (const status of ["done", "excused", "paused"] as const) {
      const habit = { days: days({ ...streak(5), [TODAY]: status }), pause: null };
      const result = planNotifications(input({ habit }));
      expect(result.slots.filter((slot) => slot.localDate === TODAY && WIRD_TYPES.has(slot.type))).toEqual([]);
    }
  });

  it("puts the make-up reminder 90 minutes before the cutoff when the anchor is later", () => {
    const prefs = prefsWith({ anchor: { kind: "clock", minutes: 20 * 60 } });
    const habit = { days: days(streak(5, -2)), pause: null };
    const result = planNotifications(input({ prefs, habit }));
    expect(summary(result)[0]).toBe(`${TODAY} 11:00 makeup_window`);
  });

  it("uses prayer times for the anchor, Dhuhr cutoff and at-risk time", () => {
    const prayers = prayerTimes(RIYADH, { ...WINTER, isha: 21 * 60 + 30 });
    const habit = { days: days(streak(5, -2)), pause: null };
    const result = planNotifications(input({ prayers, habit }));
    const lines = summary(result).filter((line) => line.startsWith(TODAY));
    expect(lines).toEqual([`${TODAY} 05:10 makeup_window`, `${TODAY} 21:50 streak_at_risk`]);
    expect(result.slots[0].vars.cutoff).toBe("dhuhr");
  });

  it("sends the at-risk reminder after Isha, before quiet hours start an hour after Isha (NOT-08)", () => {
    const prayers = prayerTimes(RIYADH, WINTER);
    const result = planNotifications(input({ prayers }));
    expect(summary(result)).toContain(`${TODAY} 18:50 streak_at_risk`);
    expect(summary(result)).not.toContain(`${TODAY} 21:00 streak_at_risk`);

    // Isha is 18:30, so 20:00 is in quiet hours with prayer times, but the user chose that time for
    // the wird reminder, so it is sent either way.
    const evening = prefsWith({ anchor: { kind: "clock", minutes: 20 * 60 } });
    expect(summary(planNotifications(input({ prefs: evening, prayers })))).toContain(`${TODAY} 20:00 wird_reminder`);
    expect(summary(planNotifications(input({ prefs: evening })))).toContain(`${TODAY} 20:00 wird_reminder`);
  });

  it("ends quiet hours 30 minutes before Fajr, and uses 05:00 only without prayer times (NOT-08)", () => {
    const prayers = prayerTimes(RIYADH, WINTER);
    // Fajr is 04:50, so quiet hours end at 04:20 with prayer times and at 05:00 without them. The
    // at-risk reminder is not chosen by the user, so it follows the window.
    const times = (prayersFor: typeof prayers | (() => null)) =>
      buildDayTimes({ clock: RIYADH, prayers: prayersFor, anchor: DEFAULT_REMINDER_PREFS.anchor, ramadanAnchor: null, isRamadan: () => false }, TODAY);
    expect(isQuietAt(times(prayers), RIYADH.at(TODAY, 4 * 60 + 30))).toBe(false);
    expect(isQuietAt(times(() => null), RIYADH.at(TODAY, 4 * 60 + 30))).toBe(true);
    // The wird reminder at a chosen 04:30 is sent in both cases.
    const early = prefsWith({ anchor: { kind: "clock", minutes: 4 * 60 + 30 } });
    const now = RIYADH.at(TODAY, 0);
    expect(summary(planNotifications(input({ prefs: early, prayers, now })))).toContain(`${TODAY} 04:30 wird_reminder`);
    expect(summary(planNotifications(input({ prefs: early, now })))).toContain(`${TODAY} 04:30 wird_reminder`);
  });

  it("builds the quiet window from prayer times, with clock fallbacks only without them", () => {
    const times = buildDayTimes(
      { clock: RIYADH, prayers: prayerTimes(RIYADH, WINTER), anchor: DEFAULT_REMINDER_PREFS.anchor, ramadanAnchor: null, isRamadan: () => false },
      TODAY,
    );
    expect([times.quietEndsAt, times.atRiskAt, times.quietStartsAt].map((at) => RIYADH.minutesOf(at))).toEqual([
      4 * 60 + 20,
      18 * 60 + 50,
      19 * 60 + 30,
    ]);
    const fallback = buildDayTimes(
      { clock: RIYADH, prayers: () => null, anchor: DEFAULT_REMINDER_PREFS.anchor, ramadanAnchor: null, isRamadan: () => false },
      TODAY,
    );
    expect([fallback.quietEndsAt, fallback.atRiskAt, fallback.quietStartsAt].map((at) => RIYADH.minutesOf(at))).toEqual([
      5 * 60,
      21 * 60,
      23 * 60,
    ]);
  });

  it("does not send the at-risk reminder for a 1-day streak", () => {
    const habit = { days: days(streak(1)), pause: null };
    const result = planNotifications(input({ habit }));
    expect(result.slots.filter((slot) => slot.localDate === TODAY).map((slot) => slot.type)).toEqual(["wird_reminder"]);
  });

  it("adds the opt-in late reminder at 23:15 inside quiet hours, up to a cap of 3", () => {
    const prefs = prefsWith({ types: { late_reminder: true } });
    const result = planNotifications(input({ prefs }));
    expect(summary(result).filter((line) => line.startsWith(TODAY))).toEqual([
      `${TODAY} 05:20 wird_reminder`,
      `${TODAY} 21:00 streak_at_risk`,
      `${TODAY} 23:15 late_reminder`,
    ]);
  });

  it("skips the late reminder when planning at 23:00 or later", () => {
    const prefs = prefsWith({ types: { late_reminder: true } });
    const result = planNotifications(input({ prefs, now: RIYADH.at(TODAY, 23 * 60 + 5) }));
    expect(result.slots.some((slot) => slot.localDate === TODAY)).toBe(false);
    expect(result.skipped).toContainEqual(expect.objectContaining({ type: "late_reminder", localDate: TODAY, reason: "late_hour" }));
  });

  it("counts reminders that already fired toward the daily cap (NOT-07)", () => {
    const prefs = prefsWith({ types: { friday_kahf: true } });
    const friday = addDays(TODAY, 1);
    const now = RIYADH.at(friday, 8 * 60);
    const habit = { days: days(streak(6, 0)), pause: null };
    const delivered = [
      { type: "makeup_window", templateId: "makeup_window.1", localDate: friday, at: RIYADH.at(friday, 5 * 60 + 20) },
    ];
    const result = planNotifications(input({ prefs, now, habit, delivered }));
    const fridaySlots = result.slots.filter((slot) => slot.localDate === friday).map((slot) => slot.type);
    expect(fridaySlots).toEqual(["streak_at_risk"]);
    expect(result.skipped).toContainEqual(expect.objectContaining({ type: "friday_kahf", localDate: friday, reason: "cap" }));
  });

  it("counts follow-ups toward the daily cap, and lets one displace a later reminder (NOT-07)", () => {
    const now = RIYADH.at(TODAY, 5 * 60 + 30);
    const wird = { type: "wird_reminder", templateId: "wird_reminder.1", localDate: TODAY, at: RIYADH.at(TODAY, 5 * 60 + 20) };
    const base = input({ now, delivered: [wird] });
    const fingerprint = streakFingerprint(projectHabit(base, TODAY, now).snapshot);
    const remindLater = { at: RIYADH.at(TODAY, 6 * 60 + 30).toISOString(), local_date: TODAY, fingerprint };

    // One reminder fired: the follow-up takes the second place and the evening reminder gives way.
    const displaced = planNotifications({ ...base, remindLater });
    expect(summary(displaced).filter((line) => line.startsWith(TODAY))).toEqual([`${TODAY} 06:30 remind_later`]);
    expect(displaced.skipped).toContainEqual(expect.objectContaining({ type: "streak_at_risk", localDate: TODAY, reason: "cap" }));

    // Two fired, one of them a follow-up: no more follow-ups, and the late reminder is the third.
    const later = RIYADH.at(TODAY, 10 * 60);
    const fired = [wird, { type: "remind_later", templateId: "remind_later.1", localDate: TODAY, at: RIYADH.at(TODAY, 6 * 60 + 30) }];
    const capped = planNotifications({
      ...base,
      now: later,
      prefs: prefsWith({ types: { late_reminder: true } }),
      delivered: fired,
      remindLater: { ...remindLater, at: RIYADH.at(TODAY, 11 * 60).toISOString() },
    });
    expect(summary(capped).filter((line) => line.startsWith(TODAY))).toEqual([`${TODAY} 23:15 late_reminder`]);
    expect(capped.skipped).toContainEqual(expect.objectContaining({ type: "remind_later", reason: "cap" }));
  });

  it("does not send a reminder type twice on one date when its time moves after it fired", () => {
    const now = RIYADH.at(TODAY, 7 * 60);
    const delivered = [{ type: "wird_reminder", templateId: "wird_reminder.1", localDate: TODAY, at: RIYADH.at(TODAY, 5 * 60 + 20) }];
    const prefs = prefsWith({ anchor: { kind: "clock", minutes: 8 * 60 } });
    const result = planNotifications(input({ now, prefs, delivered }));
    expect(summary(result).filter((line) => line.startsWith(TODAY))).toEqual([`${TODAY} 21:00 streak_at_risk`]);
    expect(result.skipped).toContainEqual(expect.objectContaining({ type: "wird_reminder", localDate: TODAY, reason: "sent" }));
  });

  it("sends Friday al-Kahf when opted in, even after the wird is done", () => {
    const prefs = prefsWith({ types: { friday_kahf: true } });
    const friday = addDays(TODAY, 1);
    const habit = { days: days({ ...streak(5, 0), [friday]: "done" }), pause: null };
    const result = planNotifications(input({ prefs, habit, now: RIYADH.at(friday, 6 * 60) }));
    expect(summary(result).filter((line) => line.startsWith(friday))).toEqual([`${friday} 09:00 friday_kahf`]);
    expect(result.slots[0].route).toBe("kahf");
  });

  it("stops everything when the master switch is off, and one type off leaves the others", () => {
    expect(planNotifications(input({ prefs: prefsWith({ enabled: false }) })).slots).toEqual([]);
    const result = planNotifications(input({ prefs: prefsWith({ types: { streak_at_risk: false } }) }));
    expect(result.slots.some((slot) => slot.type === "streak_at_risk")).toBe(false);
    expect(result.slots.some((slot) => slot.type === "wird_reminder")).toBe(true);
  });

  it("sends a reminder at the time the user chose even inside quiet hours", () => {
    const prefs = prefsWith({ anchor: { kind: "clock", minutes: 4 * 60 } });
    const result = planNotifications(input({ prefs, now: RIYADH.at(TODAY, 60) }));
    expect(summary(result)).toContain(`${TODAY} 04:00 wird_reminder`);
  });

  it("lets a Ramadan anchor the user chose fall before Suhoor (NOT-10)", () => {
    const prefs = prefsWith({ ramadanAnchor: "before_suhoor" });
    const prayers = prayerTimes(RIYADH, WINTER);
    const result = planNotifications(input({ prefs, prayers, isRamadan: () => true, now: RIYADH.at(TODAY, 60) }));
    expect(summary(result)[0]).toBe(`${TODAY} 03:50 wird_reminder`);
  });

  it("backs off to every other day after 7 ignored and weekly after 14 (NOT-09)", () => {
    expect([0, 6, 7, 13, 14, 40].map(backoffLevel)).toEqual([0, 0, 1, 1, 2, 2]);
    const habit = { days: [], pause: null };
    const everyOther = planNotifications(input({ habit, backoff: 1 })).slots.map((slot) => slot.localDate);
    expect(new Set(everyOther).size).toBeLessThanOrEqual(4);
    const weekly = planNotifications(input({ habit, backoff: 2, weekStart: 1 })).slots;
    expect(weekly.map((slot) => RIYADH.weekdayOf(slot.localDate))).toEqual([1]);
  });

  it("sends the earn-back reminder once, when the window opens", () => {
    // Excused days count toward the streak but earn no grace, so the break is not covered.
    const habit = { days: days(streak(10, -3, "excused")), pause: null };
    const result = planNotifications(input({ habit }));
    expect(result.slots.filter((slot) => slot.type === "earnback_open").map((slot) => slot.localDate)).toEqual([TODAY]);
    const later = planNotifications(
      input({
        habit,
        now: RIYADH.at(addDays(TODAY, 1), 3 * 60),
        delivered: [{ type: "earnback_open", templateId: "earnback_open.1", localDate: TODAY, at: RIYADH.at(TODAY, 5 * 60 + 20) }],
      }),
    );
    expect(later.slots.some((slot) => slot.type === "earnback_open")).toBe(false);
  });

  it("sends no make-up reminder on an excused day, though yesterday can still be made up", () => {
    const habit = { days: days({ ...streak(6, -2), [TODAY]: "excused" }), pause: null };
    const types = { ...DEFAULT_REMINDER_PREFS.types, makeup_window: true };
    const result = planNotifications(input({ habit, prefs: prefsWith({ types }), now: RIYADH.at(TODAY, 0) }));
    expect(result.slots.filter((slot) => slot.localDate === TODAY && slot.type === "makeup_window")).toEqual([]);
  });

  it("sends no earn-back reminder on a day whose wird is already done", () => {
    // The earn-back headline leads on Home even when today is done; the planner must still see today as covered.
    const habit = { days: days({ ...streak(10, -3, "excused"), [TODAY]: "done" }), pause: null };
    const result = planNotifications(input({ habit, now: RIYADH.at(TODAY, 0) }));
    expect(result.slots.filter((slot) => slot.localDate === TODAY && WIRD_TYPES.has(slot.type))).toEqual([]);
  });

  it("notes a grace day the morning after it is used", () => {
    // Yesterday was covered by grace at 12:30 today, and today's wird is done.
    const habit = { days: days({ ...streak(6, -2), [addDays(TODAY, -1)]: "grace", [TODAY]: "done" }), pause: null };
    const result = planNotifications(input({ habit, now: RIYADH.at(TODAY, 20 * 60) }));
    const tomorrow = addDays(TODAY, 1);
    const grace = result.slots.filter((slot) => slot.type === "grace_used");
    expect(grace.map((slot) => slot.localDate)).toEqual([tomorrow]);
    expect(grace[0].vars).toEqual(expect.objectContaining({ n: 8 }));
  });

  it("keeps a remind-later follow-up only while its date, state and open day hold (NOT-05b)", () => {
    const now = RIYADH.at(TODAY, 9 * 60);
    const base = input({ now });
    const fingerprint = streakFingerprint(projectHabit(base, TODAY, now).snapshot);
    const pending = { at: RIYADH.at(TODAY, 10 * 60).toISOString(), local_date: TODAY, fingerprint };
    expect(planNotifications({ ...base, remindLater: pending }).slots.map((slot) => slot.type)).toContain("remind_later");

    const changed = planNotifications({ ...base, remindLater: { ...pending, fingerprint: "other" } });
    expect(changed.skipped).toContainEqual(expect.objectContaining({ type: "remind_later", reason: "state_changed" }));

    const past = planNotifications({ ...base, now: RIYADH.at(addDays(TODAY, 1), 3 * 60), remindLater: pending });
    expect(past.skipped).toContainEqual(expect.objectContaining({ type: "remind_later", reason: "expired" }));

    const done = { days: days({ ...streak(5), [TODAY]: "done" }), pause: null };
    expect(planNotifications({ ...base, habit: done, remindLater: pending }).slots.some((slot) => slot.type === "remind_later")).toBe(false);
  });

  it("batches halaqa encouragement into one notification, moved out of quiet hours", () => {
    const now = RIYADH.at(TODAY, 22 * 60 + 50);
    const groupPending = { first_received_at: now.toISOString(), count: 3 };
    const habit = { days: days(streak(5, 0)), pause: null };
    const prefs = prefsWith({ types: { streak_at_risk: false } });
    const result = planNotifications(input({ now, groupPending, habit, prefs }));
    const group = result.slots.filter((slot) => slot.type === "group_encouragement");
    expect(group).toHaveLength(1);
    expect(summary({ slots: group, skipped: [] })).toEqual([`${addDays(TODAY, 1)} 09:00 group_encouragement`]);
    expect(group[0].vars.count).toBe(3);

    // With the wird and at-risk reminders already planned, the encouragement waits (NOT-07).
    const capped = planNotifications(input({ now, groupPending, habit }));
    expect(capped.skipped).toContainEqual(expect.objectContaining({ type: "group_encouragement", reason: "cap" }));
  });

  it("follows the 6.3 comeback cadence", () => {
    const at = (offset: number) => addDays(TODAY, offset);
    const weekly = days(streak(3, -3));
    expect(comebackCadence(weekly, TODAY, 4, false)).toEqual({ backoff: true, ramadan: false });
    const monthly = days(streak(3, -10));
    expect(comebackCadence(monthly, TODAY, 4, false)).toBeNull();
    expect(comebackCadence(monthly, at(1), 5, false)).toEqual({ backoff: true, ramadan: false });
    const dormant = days(streak(3, -30));
    expect(comebackCadence(dormant, TODAY, 4, false)).toEqual({ backoff: false, ramadan: false });
    expect(comebackCadence(dormant, at(1), 5, false)).toBeNull();
    const longGone = days(streak(3, -200));
    expect(comebackCadence(longGone, "2026-12-01", 2, false)).toBeNull();
    expect(comebackCadence(longGone, TODAY, 4, true)).toEqual({ backoff: false, ramadan: true });
  });

  it("uses the Ramadan template for the dormant invitation", () => {
    const habit = { days: days(streak(3, -200)), pause: null };
    const result = planNotifications(input({ habit, isRamadanStart: (date) => date === TODAY }));
    expect(result.slots.map((slot) => slot.templateId)).toEqual(["comeback.11"]);
  });

  it("places reminders on the right instant across a daylight-saving change", () => {
    const springForward = "2026-03-29";
    const result = planNotifications(
      input({ clock: LONDON, now: LONDON.at(springForward, 0), habit: { days: [], pause: null }, horizonDays: 1 }),
    );
    expect(result.slots[0].at.toISOString()).toBe("2026-03-29T04:20:00.000Z");
    const fallBack = "2026-11-01";
    const ny = planNotifications(input({ clock: NEW_YORK, now: NEW_YORK.at(fallBack, 0), habit: { days: [], pause: null }, horizonDays: 1 }));
    expect(ny.slots[0].at.toISOString()).toBe("2026-11-01T10:20:00.000Z");
  });

  it("chooses templates that only mention known values, and not one page when the minimum is higher", () => {
    const result = planNotifications(input({ minimum: { pages: 2, minutes: 10 } }));
    for (const slot of result.slots) {
      const template = templateById(slot.templateId)!;
      expect(template.needs).not.toContain("onePage");
      expect(template.needs).not.toContain("fiveMinutes");
      expect(template.needs).not.toContain("surah");
    }
  });
});

describe("planNotifications properties", () => {
  const statusArb = fc.constantFrom<DayStatus | null>(null, null, "done", "done", "done", "excused", "grace", "made_up");
  const historyArb = fc.array(statusArb, { minLength: 0, maxLength: 40 });
  const typesArb = fc.record({
    late_reminder: fc.boolean(),
    friday_kahf: fc.boolean(),
    makeup_window: fc.boolean(),
    streak_at_risk: fc.boolean(),
  });
  const anchorArb = fc.oneof(
    fc.record({
      kind: fc.constant("prayer" as const),
      prayer: fc.constantFrom("fajr" as const, "dhuhr" as const, "asr" as const, "maghrib" as const, "isha" as const),
      offsetMinutes: fc.integer({ min: 0, max: 120 }),
    }),
    fc.record({ kind: fc.constant("clock" as const), minutes: fc.integer({ min: 0, max: 1439 }) }),
  );
  const scenarioArb = fc.record({
    history: historyArb,
    types: typesArb,
    anchor: anchorArb,
    nowMinutes: fc.integer({ min: 0, max: 1439 }),
    withPrayers: fc.boolean(),
    backoff: fc.constantFrom<0 | 1 | 2>(0, 1, 2),
    clock: fc.constantFrom(RIYADH, LONDON, NEW_YORK),
    group: fc.boolean(),
    deliveredToday: fc.array(fc.constantFrom<NotificationType>("wird_reminder", "remind_later", "group_encouragement", "streak_at_risk"), {
      maxLength: 3,
    }),
    followUp: fc.boolean(),
  });

  type Scenario = typeof scenarioArb extends fc.Arbitrary<infer T> ? T : never;

  function build(scenario: Scenario): PlannerInput {
    const { clock } = scenario;
    const record: Record<LocalDate, DayStatus> = {};
    scenario.history.forEach((status, index) => {
      if (status) record[addDays(TODAY, -scenario.history.length + index)] = status;
    });
    const now = clock.at(TODAY, scenario.nowMinutes);
    const base = input({
      clock,
      now,
      prefs: prefsWith({ anchor: scenario.anchor, types: scenario.types }),
      prayers: scenario.withPrayers ? prayerTimes(clock, WINTER) : () => null,
      habit: { days: days(record), pause: null },
      backoff: scenario.backoff,
      groupPending: scenario.group ? { first_received_at: now.toISOString(), count: 1 } : null,
      delivered: scenario.deliveredToday.map((type, index) => ({
        type,
        templateId: `${type}.${index + 2}`,
        localDate: TODAY,
        at: new Date(now.getTime() - (index + 1) * 60_000),
      })),
      random: () => 0.5,
    });
    const followUpAt = new Date(now.getTime() + 60 * 60_000);
    if (!scenario.followUp || clock.dateOf(followUpAt) !== TODAY) return base;
    const fingerprint = streakFingerprint(projectHabit(base, TODAY, now).snapshot);
    return { ...base, remindLater: { at: followUpAt.toISOString(), local_date: TODAY, fingerprint } };
  }

  it("never plans more than the daily cap, follow-ups included, and only the late reminder takes a third place", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const plannerInput = build(scenario);
        const result = planNotifications(plannerInput);
        const perDate = new Map<LocalDate, NotificationType[]>();
        for (const slot of result.slots) {
          perDate.set(slot.localDate, [...(perDate.get(slot.localDate) ?? []), slot.type]);
        }
        for (const [date, types] of perDate) {
          const fired = plannerInput.delivered.filter((item) => item.localDate === date).length;
          const total = fired + types.length;
          if (types.includes("late_reminder")) expect(total).toBeLessThanOrEqual(3);
          else expect(total).toBeLessThanOrEqual(2);
        }
      }),
      { numRuns: 150 },
    );
  });

  it("sends the at-risk reminder after Isha and before quiet hours when prayer times are set (5.8.2, NOT-08)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 17 * 60, max: 22 * 60 + 20 }),
        fc.integer({ min: 3 * 60, max: 6 * 60 + 30 }),
        fc.constantFrom(RIYADH, LONDON, NEW_YORK),
        (isha, fajr, clock) => {
          const prayers = prayerTimes(clock, { ...WINTER, fajr, isha });
          const times = buildDayTimes({ clock, prayers, anchor: DEFAULT_REMINDER_PREFS.anchor, ramadanAnchor: null, isRamadan: () => false }, TODAY);
          const ishaAt = prayers(TODAY).isha.getTime();
          expect(times.atRiskAt.getTime()).toBeGreaterThan(ishaAt);
          expect(times.atRiskAt.getTime()).toBeLessThan(times.quietStartsAt.getTime());
          expect(times.quietStartsAt.getTime()).toBe(ishaAt + 60 * 60_000);
          expect(times.quietEndsAt.getTime()).toBe(prayers(TODAY).fajr.getTime() - 30 * 60_000);
          expect(isQuietAt(times, times.atRiskAt)).toBe(false);
        },
      ),
    );
  });

  it("never plans inside quiet hours except the late reminder and the user's chosen time", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const plannerInput = build(scenario);
        for (const slot of planNotifications(plannerInput).slots) {
          if (slot.type === "late_reminder") continue;
          const chosen = buildDayTimes(
            {
              clock: plannerInput.clock,
              prayers: plannerInput.prayers,
              anchor: plannerInput.prefs.anchor,
              ramadanAnchor: plannerInput.prefs.ramadanAnchor,
              isRamadan: plannerInput.isRamadan,
            },
            slot.localDate,
          ).anchorAt;
          if (slot.at.getTime() === chosen.getTime()) continue;
          const times = buildDayTimes(
            {
              clock: plannerInput.clock,
              prayers: plannerInput.prayers,
              anchor: plannerInput.prefs.anchor,
              ramadanAnchor: null,
              isRamadan: () => false,
            },
            slot.localDate,
          );
          expect(isQuietAt(times, slot.at)).toBe(false);
        }
      }),
      { numRuns: 150 },
    );
  });

  it("never reminds about the wird on a day already covered, and keeps each slot in the future and on its own date", () => {
    fc.assert(
      fc.property(scenarioArb, fc.constantFrom<DayStatus>("done", "excused"), (scenario, todayStatus) => {
        const plannerInput = build(scenario);
        const habit = { days: [...plannerInput.habit.days, { localDate: TODAY, status: todayStatus, fullMet: false }], pause: null };
        const result = planNotifications({ ...plannerInput, habit });
        for (const slot of result.slots) {
          expect(slot.at.getTime()).toBeGreaterThan(plannerInput.now.getTime());
          expect(plannerInput.clock.dateOf(slot.at)).toBe(slot.localDate);
          if (slot.localDate === TODAY) expect(WIRD_TYPES.has(slot.type)).toBe(false);
        }
      }),
      { numRuns: 150 },
    );
  });

  it("is deterministic for the same input", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const first = planNotifications(build(scenario));
        const second = planNotifications(build(scenario));
        expect(second.slots).toEqual(first.slots);
      }),
      { numRuns: 50 },
    );
  });
});
