import fs from "node:fs";
import path from "node:path";
import { addDays, type LocalDate } from "@/lib/habit/dates";
import type { DayStatus, HabitDay, HabitPause } from "@/lib/habit/types";
import type { DayClock } from "@/lib/notifications/clock";
import { buildDayTimes } from "@/lib/notifications/day-times";
import type { DayPrayerTimes } from "@/lib/prayer/times";
import type { WidgetPlanFacts } from "@/lib/widget/copy";
import { WIDGET_PALETTES } from "@/lib/widget/palette";
import { serializeWidgetTimeline, utf8Length } from "@/lib/widget/schema";
import { buildWidgetTimeline, selectWidgetEntry, type WidgetBuildInput } from "@/lib/widget/timeline";
import {
  WIDGET_MAX_BYTES,
  WIDGET_MAX_ENTRIES,
  WIDGET_MAX_SPAN_MS,
  type WidgetEntry,
  type WidgetTimeline,
} from "@/lib/widget/types";

/** A fixed UTC+3 clock (Asia/Riyadh has no daylight saving), so results do not depend on the machine's zone. */
const OFFSET_MS = 3 * 60 * 60_000;
const CLOCK: DayClock = {
  at: (date, minutes) => new Date(Date.parse(`${date}T00:00:00Z`) + minutes * 60_000 - OFFSET_MS),
  dateOf: (at) => new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10),
  minutesOf: (at) => {
    const local = new Date(at.getTime() + OFFSET_MS);
    return local.getUTCHours() * 60 + local.getUTCMinutes();
  },
  weekdayOf: (date) => new Date(`${date}T00:00:00Z`).getUTCDay(),
};

/** As in notifications-planner.test.ts: wall-clock conversions for a named zone. */
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
      utcOfWall: Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second),
      ),
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

/** Monday 2026-11-23. */
const D: LocalDate = "2026-11-23";

/** As in notifications-projection.test.ts: Dhuhr moves a little each day, so cutoffs differ from 12:30. */
function prayerTimes(date: LocalDate): DayPrayerTimes {
  const drift = Number(date.slice(8, 10)) % 7;
  const at = (minutes: number) => CLOCK.at(date, minutes + drift);
  return { fajr: at(290), sunrise: at(370), dhuhr: at(705), asr: at(890), maghrib: at(1020), isha: at(1110) };
}

function days(status: DayStatus, from: LocalDate, to: LocalDate): HabitDay[] {
  const list: HabitDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) list.push({ localDate: date, status, fullMet: false });
  return list;
}

function noPlan(date: LocalDate = D): WidgetPlanFacts {
  return { date, plan: "none", reviewLeft: false, pagesLeft: 0, minutesLeft: 0, moreDueAt: null };
}

type Options = Partial<Omit<WidgetBuildInput, "habit" | "eveningStartsAt">> & {
  days?: readonly HabitDay[];
  pause?: HabitPause | null;
};

function input(options: Options = {}): WidgetBuildInput {
  const clock = options.clock ?? CLOCK;
  const prayers = options.prayers ?? (() => null);
  return {
    now: options.now ?? clock.at(D, 9 * 60),
    clock,
    timeZone: options.timeZone ?? "Asia/Riyadh",
    habit: { days: options.days ?? [], pause: options.pause ?? null },
    prayers,
    eveningStartsAt: (date) =>
      buildDayTimes(
        { clock, prayers, anchor: { kind: "clock", minutes: 6 * 60 }, ramadanAnchor: null, isRamadan: () => false },
        date,
      ).atRiskAt,
    plan: options.plan ?? noPlan(clock.dateOf(options.now ?? clock.at(D, 9 * 60))),
    language: options.language ?? "en",
    appearance: options.appearance ?? { colorMode: "fixed", colors: WIDGET_PALETTES.white },
    showZayt: options.showZayt ?? true,
    showNumbers: options.showNumbers ?? true,
    todayFinishedAt: options.todayFinishedAt ?? null,
  };
}

function at(timeline: WidgetTimeline, instant: Date): WidgetEntry {
  const selection = selectWidgetEntry(timeline, instant.getTime(), true);
  if (selection.kind !== "entry") throw new Error(`No entry at ${instant.toISOString()}: ${selection.reason}`);
  return selection.entry;
}

const entryTexts = (entry: WidgetEntry) =>
  [entry.count, entry.line, entry.note, entry.contentDescription].filter((value): value is string => value !== null);

/** Spec 7.3: Monday 09:00 in Asia/Riyadh, a 12-day streak, a page plan with 3 pages left, one grace day held. */
function exampleInput(): WidgetBuildInput {
  return input({
    days: [
      ...days("done", "2026-11-11", "2026-11-14"),
      ...days("grace", "2026-11-15", "2026-11-15"),
      ...days("done", "2026-11-16", "2026-11-22"),
    ],
    plan: { date: D, plan: "pages", reviewLeft: true, pagesLeft: 3, minutesLeft: 15, moreDueAt: null },
  });
}

const FIXTURES = path.resolve(__dirname, "../fixtures/widget");

describe("widget timeline example (spec 7.3)", () => {
  it("matches the checked-in fixture byte for byte", () => {
    const timeline = buildWidgetTimeline(exampleInput());
    const fixture = fs.readFileSync(path.join(FIXTURES, "timeline-v2-valid.json"), "utf8");
    expect(fixture).toBe(`${JSON.stringify(timeline, null, 2)}\n`);
    expect(serializeWidgetTimeline(timeline)).toBe(JSON.stringify(JSON.parse(fixture)));
  });

  it("starts with the calm, steady, nudge and urgent entries of an open day", () => {
    const timeline = buildWidgetTimeline(exampleInput());
    expect(timeline).toMatchObject({
      version: 2,
      generatedAt: 1795413600000,
      expiresAt: 1795986000000,
      timeZone: "Asia/Riyadh",
      language: "en",
      direction: "ltr",
      colorMode: "fixed",
      colors: {
        surface: "#F8FAFC",
        textPrimary: "#2D2D2D",
        textSecondary: "#3F3F46",
        accent: "#0D9488",
        accentText: "#0F766E",
      },
    });
    // Recited on each of the six days before today; today is still open.
    expect(timeline.entries[0].week.map((day) => day.mark).join(" ")).toBe("lit lit lit lit lit lit open");
    expect(timeline.entries[0].week.map((day) => day.label).join("")).toBe("TWTFSSM");
    expect(timeline.entries.slice(0, 4).map(({ week: _week, ...entry }) => entry)).toEqual([
      {
        startsAt: 1795413600000,
        state: "open_day",
        urgency: "calm",
        scene: "morning",
        pose: "rest",
        flame: "unlit",
        tier: 1,
        count: "12",
        line: "Today's wird awaits",
        note: "3 pages left, about 15 minutes",
        contentDescription:
          "Hafiz. Streak: 12 days. Today's wird awaits. A short review today keeps your streak. 3 pages left, about 15 minutes.",
        tap: "wird",
      },
      {
        startsAt: 1795424400000,
        state: "open_day",
        urgency: "steady",
        scene: "day",
        pose: "eager",
        flame: "unlit",
        tier: 1,
        count: "12",
        line: "Keep it going",
        note: "3 pages left, about 15 minutes",
        contentDescription:
          "Hafiz. Streak: 12 days. Keep it going. A short review today keeps your streak. 3 pages left, about 15 minutes.",
        tap: "wird",
      },
      {
        startsAt: 1795438800000,
        state: "open_day",
        urgency: "nudge",
        scene: "golden",
        pose: "impatient",
        flame: "unlit",
        tier: 1,
        count: "12",
        line: "Keep your 12\u00A0days",
        note: "3 pages left, about 15 minutes",
        contentDescription:
          "Hafiz. Streak: 12 days. Keep your 12\u00A0days. A short review today keeps your streak. 3 pages left, about 15 minutes.",
        tap: "wird",
      },
      {
        startsAt: 1795453200000,
        state: "open_day",
        urgency: "urgent",
        scene: "dusk",
        pose: "fretful",
        flame: "unlit",
        tier: 1,
        count: "12",
        line: "Save your 12\u00A0days",
        note: "3 pages left, about 15 minutes",
        contentDescription:
          "Hafiz. Streak: 12 days. Save your 12\u00A0days. A short review today keeps your streak. 3 pages left, about 15 minutes.",
        tap: "wird",
      },
    ]);
  });
});

describe("buildWidgetTimeline (spec 7.2)", () => {
  it("1. rolls over: done, then open at midnight, the evening band, make-up, and a grace day at the cutoff", () => {
    const timeline = buildWidgetTimeline(input({ days: days("done", "2026-11-19", D), now: CLOCK.at(D, 15 * 60) }));
    const next = addDays(D, 1);
    const after = addDays(D, 2);
    expect(at(timeline, CLOCK.at(D, 15 * 60))).toMatchObject({
      state: "done",
      count: "5",
      tap: "wird",
      pose: "shimmer",
    });
    expect(at(timeline, CLOCK.at(next, 0))).toMatchObject({ state: "open_day", count: "5" });
    expect(timeline.entries.some((entry) => entry.startsAt === CLOCK.at(next, 0).getTime())).toBe(true);
    expect(at(timeline, CLOCK.at(next, 21 * 60))).toMatchObject({ state: "open_evening", count: "5" });
    expect(at(timeline, CLOCK.at(after, 0))).toMatchObject({
      state: "make_up",
      count: "5",
      line: "Make up by 12:30\u00A0PM",
    });
    expect(at(timeline, CLOCK.at(after, 12 * 60 + 30))).toMatchObject({
      state: "open_day",
      count: "6",
      note: "A grace day kept your streak",
    });
  });

  it("2. closes the make-up window at that day's Dhuhr with prayer times, in Arabic digits", () => {
    const timeline = buildWidgetTimeline(
      input({ days: days("done", "2026-11-19", "2026-11-22"), prayers: prayerTimes, language: "ar" }),
    );
    const next = addDays(D, 1);
    const dhuhr = prayerTimes(next).dhuhr.getTime();
    expect(dhuhr).not.toBe(CLOCK.at(next, 12 * 60 + 30).getTime());
    const makeUp = at(timeline, CLOCK.at(next, 0));
    expect(makeUp.state).toBe("make_up");
    expect(makeUp.line).toMatch(/[٠-٩]/);
    expect(makeUp.line).not.toMatch(/[0-9]/);
    expect(timeline.entries.some((entry) => entry.startsAt === dhuhr && entry.state === "open_day")).toBe(true);
    expect(at(timeline, new Date(dhuhr - 1)).state).toBe("make_up");
    expect(at(timeline, new Date(dhuhr)).state).toBe("open_day");
  });

  it("3. settles the cutoff with a fresh start when no grace is held, and with a grace day when one is", () => {
    const cutoff = CLOCK.at(addDays(D, 1), 12 * 60 + 30);
    const without = buildWidgetTimeline(input({ days: days("done", "2026-11-21", "2026-11-22") }));
    expect(at(without, cutoff)).toMatchObject({
      state: "fresh_start",
      count: "0",
      flame: "out",
      note: "Longest: 2 days",
      tap: "wird",
    });
    const withGrace = buildWidgetTimeline(input({ days: days("done", "2026-11-19", "2026-11-22") }));
    expect(at(withGrace, cutoff)).toMatchObject({
      state: "open_day",
      count: "5",
      note: "A grace day kept your streak",
    });
  });

  it("4. shows a pause until it ends, one entry a day as the week row moves, then the same count", () => {
    const timeline = buildWidgetTimeline(
      input({ days: days("done", "2026-11-20", "2026-11-22"), pause: { start: D, end: "2026-11-25" } }),
    );
    const thursday = CLOCK.at("2026-11-26", 0).getTime();
    const paused = timeline.entries.filter((entry) => entry.startsAt < thursday);
    // Monday to Wednesday: the line and count stay; only the week row gains a kept day.
    expect(paused).toHaveLength(3);
    expect(paused[2].week.slice(4).map((day) => day.mark)).toEqual(["kept", "kept", "kept"]);
    expect(paused[0]).toMatchObject({
      state: "paused",
      scene: "calm",
      count: "3",
      line: "Paused until Nov 25",
      pose: "sit",
      tap: "home",
    });
    expect(timeline.entries.find((entry) => entry.startsAt === thursday)).toMatchObject({
      state: "open_day",
      count: "3",
    });

    const arabic = buildWidgetTimeline(
      input({ days: days("done", "2026-11-20", "2026-11-22"), pause: { start: D, end: "2026-11-25" }, language: "ar" }),
    );
    expect(arabic.entries[0].line).toMatch(/^متوقفة حتى ٢٥ /);
  });

  it("5. shows an excuse stored for tomorrow as a kept day, never named", () => {
    for (const language of ["en", "ar"] as const) {
      const timeline = buildWidgetTimeline(
        input({ days: [...days("done", "2026-11-20", D), ...days("excused", "2026-11-24", "2026-11-24")], language }),
      );
      expect(at(timeline, CLOCK.at("2026-11-24", 9 * 60))).toMatchObject({
        state: "kept",
        scene: "calm",
        pose: "sit",
        flame: "lit",
        tap: "home",
      });
      for (const entry of timeline.entries) {
        for (const text of entryTexts(entry)) expect(text).not.toMatch(/excus|عذر|معذور|travel|illness|menstruation/i);
      }
    }
  });

  it("6. follows an earn-back: days done, today counted, a window that can no longer succeed, and plain copy", () => {
    const broken = [
      ...days("done", "2026-11-11", "2026-11-18"),
      ...days("grace", "2026-11-19", "2026-11-19"),
      ...days("done", "2026-11-20", "2026-11-20"),
    ];
    const open = buildWidgetTimeline(input({ days: [...broken, ...days("done", "2026-11-22", "2026-11-22")] }));
    expect(open.entries[0]).toMatchObject({
      state: "earn_back_open",
      flame: "unlit",
      count: "1",
      line: "Earning back: 1 of 3",
      tap: "wird",
    });
    expect(open.entries[0].contentDescription).toContain("Recite today to keep earning back your 10-day streak.");

    const counted = buildWidgetTimeline(input({ days: [...broken, ...days("done", "2026-11-22", D)] }));
    expect(counted.entries[0]).toMatchObject({
      state: "earn_back_done",
      scene: "sunrise",
      pose: "open",
      flame: "lit",
      count: "2",
      line: "Today counts: 2 of 3",
      tap: "wird",
    });

    const lost = buildWidgetTimeline(input({ days: broken }));
    expect(lost.entries[0].state).toBe("earn_back_open");
    expect(at(lost, CLOCK.at("2026-11-24", 9 * 60)).state).toBe("fresh_start");

    const plain = buildWidgetTimeline(
      input({ days: [...broken, ...days("done", "2026-11-22", "2026-11-22")], showNumbers: false }),
    );
    expect(plain.entries[0]).toMatchObject({ state: "earn_back_open", count: null, line: "Bring your streak back" });
    expect(plain.entries[0].contentDescription).toContain("Recite on 3 days to bring your streak back.");
  });

  it("7. marks a milestone with its own scene and stage, and keeps a line without numbers", () => {
    const streak = days("done", "2026-11-17", D);
    const milestone = buildWidgetTimeline(input({ days: streak })).entries[0];
    expect(milestone).toMatchObject({
      state: "milestone",
      scene: "milestone",
      pose: "milestone",
      flame: "lit",
      tier: 1,
      count: "7",
      line: null,
      tap: "wird",
    });
    expect(milestone.contentDescription).toBe(
      "Hafiz. Streak: 7 days. 7 days of wird. Wird done for today. Grace days: 1.",
    );
    const plain = buildWidgetTimeline(input({ days: streak, showNumbers: false })).entries[0];
    expect(plain).toMatchObject({ state: "milestone", pose: "milestone", count: null, line: "Done today" });
    expect(plain.contentDescription).toBe("Hafiz. Done today. See you tomorrow, in sha' Allah.");
  });

  it("8. starts the evening band at the streak-at-risk time", () => {
    const streak = days("done", "2026-11-19", "2026-11-22");
    const plain = buildWidgetTimeline(input({ days: streak }));
    expect(at(plain, CLOCK.at(D, 20 * 60 + 59)).state).toBe("open_day");
    expect(at(plain, CLOCK.at(D, 21 * 60)).state).toBe("open_evening");

    const withPrayers = buildWidgetTimeline(input({ days: streak, prayers: prayerTimes }));
    const evening = prayerTimes(D).isha.getTime() + 20 * 60_000;
    expect(at(withPrayers, new Date(evening - 1)).state).toBe("open_day");
    expect(at(withPrayers, new Date(evening)).state).toBe("open_evening");

    const lateIsha = (date: LocalDate): DayPrayerTimes => ({ ...prayerTimes(date), isha: CLOCK.at(date, 23 * 60) });
    const late = buildWidgetTimeline(input({ days: streak, prayers: lateIsha }));
    expect(at(late, CLOCK.at(D, 22 * 60 + 44)).state).toBe("open_day");
    expect(at(late, CLOCK.at(D, 22 * 60 + 45)).state).toBe("open_evening");
  });

  it("9. uses today's plan facts until more review comes due, and only for page plans", () => {
    const streak = days("done", "2026-11-19", "2026-11-22");
    const moreDueAt = CLOCK.at(D, 16 * 60);
    const pages: WidgetPlanFacts = {
      date: D,
      plan: "pages",
      reviewLeft: true,
      pagesLeft: 3,
      minutesLeft: 15,
      moreDueAt,
    };
    const open = buildWidgetTimeline(input({ days: streak, plan: pages }));
    expect(at(open, CLOCK.at(D, 15 * 60 + 59)).note).toBe("3 pages left, about 15 minutes");
    expect(at(open, moreDueAt).note).toBe("Grace days: 1");
    expect(open.entries.some((entry) => entry.startsAt === moreDueAt.getTime())).toBe(true);
    expect(at(open, CLOCK.at(addDays(D, 1), 12 * 60 + 31)).note).not.toBe("3 pages left, about 15 minutes");

    const finished: WidgetPlanFacts = {
      date: D,
      plan: "pages",
      reviewLeft: false,
      pagesLeft: 0,
      minutesLeft: 0,
      moreDueAt,
    };
    const done = buildWidgetTimeline(input({ days: days("done", "2026-11-19", D), plan: finished }));
    expect(at(done, CLOCK.at(D, 9 * 60))).toMatchObject({ state: "done", tap: "wird" });
    expect(at(done, moreDueAt)).toMatchObject({
      state: "safe",
      line: "Review left today",
      tap: "wird",
      note: "Grace days: 1",
    });

    const left: WidgetPlanFacts = {
      date: D,
      plan: "pages",
      reviewLeft: true,
      pagesLeft: 2,
      minutesLeft: 10,
      moreDueAt: null,
    };
    expect(buildWidgetTimeline(input({ days: days("done", "2026-11-19", D), plan: left })).entries[0]).toMatchObject({
      state: "safe",
      note: "2 pages left, about 10 minutes",
    });

    const ayah: WidgetPlanFacts = {
      date: D,
      plan: "ayah",
      reviewLeft: true,
      pagesLeft: 0,
      minutesLeft: 0,
      moreDueAt: null,
    };
    const ayahTimeline = buildWidgetTimeline(input({ days: streak, plan: ayah }));
    for (const entry of ayahTimeline.entries) expect(entry.note ?? "").not.toMatch(/left, about/);
  });

  it("10. leaves out Zayt and every figure when those settings are off", () => {
    const history = [...days("done", "2026-11-10", "2026-11-14"), ...days("done", "2026-11-19", "2026-11-22")];
    const plan: WidgetPlanFacts = {
      date: D,
      plan: "pages",
      reviewLeft: true,
      pagesLeft: 3,
      minutesLeft: 15,
      moreDueAt: null,
    };
    const noZayt = buildWidgetTimeline(input({ days: history, plan, showZayt: false }));
    for (const entry of noZayt.entries) expect(entry.pose).toBeNull();

    const hidden = buildWidgetTimeline(input({ days: history, plan, showNumbers: false }));
    for (const entry of hidden.entries) {
      expect(entry.count).toBeNull();
      expect(entry.note ?? "").not.toMatch(/left, about|Grace days|Longest/);
      expect(entry.contentDescription).not.toMatch(/Streak: |\d+ days?/);
    }
  });

  it("11. runs out at local midnight 7 days ahead", () => {
    const timeline = buildWidgetTimeline(input({ days: days("done", "2026-11-19", "2026-11-22") }));
    expect(timeline.expiresAt).toBe(CLOCK.at("2026-11-30", 0).getTime());
    expect(selectWidgetEntry(timeline, timeline.expiresAt - 1, true)).toMatchObject({
      kind: "entry",
      entry: timeline.entries[timeline.entries.length - 1],
      nextBoundary: timeline.expiresAt,
    });
    expect(selectWidgetEntry(timeline, timeline.expiresAt, true)).toEqual({ kind: "neutral", reason: "expired" });
  });

  it("12. keeps the build zone and goes neutral in another zone or before its first entry", () => {
    const timeline = buildWidgetTimeline(input({ timeZone: "Asia/Riyadh" }));
    expect(timeline.timeZone).toBe("Asia/Riyadh");
    expect(selectWidgetEntry(timeline, timeline.generatedAt, false)).toEqual({ kind: "neutral", reason: "zone" });
    expect(selectWidgetEntry(timeline, timeline.generatedAt - 1, true)).toEqual({ kind: "neutral", reason: "early" });
  });

  it("13. puts midnight entries on local midnights across a daylight-saving change", () => {
    const berlin = zonedClock("Europe/Berlin");
    const today = "2026-10-22";
    const timeline = buildWidgetTimeline(
      input({
        clock: berlin,
        now: berlin.at(today, 9 * 60),
        timeZone: "Europe/Berlin",
        days: [...days("done", "2026-10-19", today), ...days("excused", "2026-10-23", "2026-10-28")],
      }),
    );
    const midnights = timeline.entries.filter((entry) => berlin.minutesOf(new Date(entry.startsAt)) === 0);
    expect(midnights.map((entry) => berlin.dateOf(new Date(entry.startsAt)))).toEqual([
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
    ]);
    expect(midnights.map((entry) => entry.count)).toEqual(["5", "6", "7", "8", "9", "10"]);
    expect(timeline.expiresAt).toBe(berlin.at("2026-10-29", 0).getTime());
    expect(timeline.expiresAt - timeline.generatedAt).toBeLessThanOrEqual(WIDGET_MAX_SPAN_MS);
    expect(() => serializeWidgetTimeline(timeline)).not.toThrow();
  });

  it("14. stays within 64 entries and 65,536 bytes in the worst case", () => {
    const today = D;
    const timeline = buildWidgetTimeline(
      input({
        language: "ar",
        prayers: prayerTimes,
        days: [
          ...days("done", addDays(today, -9998), addDays(today, -1)),
          ...days("excused", addDays(today, 1), addDays(today, 6)),
        ],
        plan: {
          date: today,
          plan: "pages",
          reviewLeft: true,
          pagesLeft: 604,
          minutesLeft: 9999,
          moreDueAt: CLOCK.at(today, 16 * 60),
        },
      }),
    );
    // Six sky bands a day, the make-up cutoff and the review coming due.
    expect(timeline.entries.length).toBeLessThanOrEqual(52);
    expect(timeline.entries.length).toBeLessThanOrEqual(WIDGET_MAX_ENTRIES);
    expect(timeline.entries.some((entry) => entry.count === "٩٩٩٩")).toBe(true);
    expect(utf8Length(serializeWidgetTimeline(timeline))).toBeLessThanOrEqual(WIDGET_MAX_BYTES);
  });

  it("15. shows a new person 0 with an unlit flame, by dawn and after dusk, opening the study step", () => {
    const timeline = buildWidgetTimeline(input({ days: [] }));
    expect(new Set(timeline.entries.map((entry) => entry.state))).toEqual(new Set(["begin"]));
    expect(timeline.entries[0]).toMatchObject({
      scene: "dawn",
      pose: "wave",
      flame: "out",
      count: "0",
      line: "Start your streak",
      tap: "wird",
    });
    expect(at(timeline, CLOCK.at(D, 21 * 60))).toMatchObject({ scene: "night", pose: "glow_halo", count: "0" });
    expect(at(timeline, CLOCK.at(addDays(D, 1), 9 * 60))).toMatchObject({ scene: "dawn", count: "0" });
  });

  it("16. writes Arabic right to left with Arabic-Indic digits only", () => {
    const timeline = buildWidgetTimeline(
      input({
        language: "ar",
        days: days("done", "2026-11-11", "2026-11-22"),
        plan: { date: D, plan: "pages", reviewLeft: true, pagesLeft: 3, minutesLeft: 15, moreDueAt: null },
      }),
    );
    expect(timeline.direction).toBe("rtl");
    for (const entry of timeline.entries) {
      for (const text of entryTexts(entry)) expect(text).not.toMatch(/[0-9]/);
    }
    expect(timeline.entries[0].contentDescription).toBe(
      "حافظ. السلسلة: ١٢ يومًا. وِرد اليوم بانتظارك. مراجعة قصيرة اليوم تحفظ سلسلتك. بقي ٣ صفحات، نحو ١٥ دقيقة.",
    );
  });
});
