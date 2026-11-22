import { buildDayTimes, reviewFitsDay } from "@/lib/notifications/day-times";
import {
  chipAnchor,
  defaultReviewChip,
  reviewChipAllowed,
  SITTING_CHIPS,
  type SittingDay,
} from "@/lib/notifications/review-sitting";
import type { ReminderAnchor } from "@/lib/notifications/types";
import { createPrayerTimesLookup, type DayPrayerTimes, type PrayerLocation } from "@/lib/prayer/times";
import { zonedClock } from "@/tests/jest/zoned-clock";

const RIYADH = zonedClock("Asia/Riyadh");
const after = (prayer: "fajr" | "dhuhr" | "asr" | "maghrib" | "isha", offsetMinutes = 20): ReminderAnchor => ({
  kind: "prayer",
  prayer,
  offsetMinutes,
});
const at = (minutes: number): ReminderAnchor => ({ kind: "clock", minutes });

/** No saved location: prayer chips use the fallback clock times (Fajr 05:00 to Isha 20:00). */
const fallbackDay: SittingDay = { clock: RIYADH, prayers: () => null, date: "2026-11-12" };
const allowed = (day: SittingDay, main: ReminderAnchor) =>
  SITTING_CHIPS.filter((chip) => reviewChipAllowed(day, main, chip));

describe("the second sitting's picker (REMIND-07)", () => {
  it("offers only chips later than the main sitting, by the allowlist", () => {
    expect(allowed(fallbackDay, after("fajr"))).toEqual(["morning", "dhuhr", "asr", "maghrib", "evening", "isha"]);
    expect(allowed(fallbackDay, at(8 * 60))).toEqual(["dhuhr", "asr", "maghrib", "evening", "isha"]);
    expect(allowed(fallbackDay, after("dhuhr"))).toEqual(["asr", "maghrib", "evening", "isha"]);
    expect(allowed(fallbackDay, after("asr"))).toEqual(["maghrib", "evening", "isha"]);
    // 20:00 resolves after Maghrib with the fallback times, but it is not on Maghrib's row.
    expect(allowed(fallbackDay, after("maghrib"))).toEqual(["isha"]);
    expect(reviewChipAllowed(fallbackDay, after("maghrib"), "evening")).toBe(false);
    // A prayer main keeps its prayer's row whatever its offset.
    expect(allowed(fallbackDay, after("maghrib", 0))).toEqual(["isha"]);
  });

  it("has no later chip after Isha or 20:00, so the switch stays off", () => {
    expect(allowed(fallbackDay, after("isha"))).toEqual([]);
    expect(defaultReviewChip(fallbackDay, after("isha"))).toBeNull();
    expect(allowed(fallbackDay, at(20 * 60))).toEqual([]);
    expect(defaultReviewChip(fallbackDay, at(20 * 60))).toBeNull();
  });

  it("turns on after Maghrib, or after Isha for an Asr or Maghrib main", () => {
    const mains: ReminderAnchor[] = [after("fajr"), at(8 * 60), after("dhuhr"), after("asr"), after("maghrib")];
    expect(mains.map((main) => defaultReviewChip(fallbackDay, main))).toEqual([
      "maghrib",
      "maghrib",
      "maghrib",
      "isha",
      "isha",
    ]);
  });

  it("lets a Settings clock time of 14:00 be followed by Asr, Maghrib, 20:00 and Isha, starting with Asr", () => {
    expect(allowed(fallbackDay, at(14 * 60))).toEqual(["asr", "maghrib", "evening", "isha"]);
    expect(defaultReviewChip(fallbackDay, at(14 * 60))).toBe("asr");
  });

  it("checks today's prayer times: after Fajr is 08:52 in Reykjavík on 21 December, so 08:00 is not later", () => {
    const reykjavik: PrayerLocation = {
      latitude: 64.15,
      longitude: -21.94,
      method: "MuslimWorldLeague",
      madhab: "shafi",
      source: "manual",
    };
    const day: SittingDay = {
      clock: zonedClock("Atlantic/Reykjavik"),
      prayers: createPrayerTimesLookup(reykjavik),
      date: "2026-12-21",
    };
    expect(day.clock.minutesOf(day.prayers(day.date)!.fajr) + 20).toBe(8 * 60 + 52);
    expect(reviewChipAllowed(day, after("fajr"), "morning")).toBe(false);
    expect(allowed(day, after("fajr"))).toEqual(["dhuhr", "asr", "maghrib", "evening", "isha"]);
    expect(defaultReviewChip(day, after("fajr"))).toBe("maghrib");
  });

  describe("Kashgar on 21 June 2026 (Asia/Shanghai, Muslim World League, Hanafi Asr)", () => {
    const kashgar: PrayerLocation = {
      latitude: 39.47,
      longitude: 75.99,
      method: "MuslimWorldLeague",
      madhab: "hanafi",
      source: "manual",
    };
    const day: SittingDay = {
      clock: zonedClock("Asia/Shanghai"),
      prayers: createPrayerTimesLookup(kashgar),
      date: "2026-06-21",
    };

    it("leaves no later chip after Maghrib, since Isha falls after midnight, so the switch stays off", () => {
      expect(day.clock.dateOf(day.prayers(day.date)!.isha)).toBe("2026-06-22");
      expect(allowed(day, after("maghrib"))).toEqual([]);
      expect(defaultReviewChip(day, after("maghrib"))).toBeNull();
    });

    it("skips 20:00 after Asr, which resolves at 20:30, and falls back to the first chip that passes", () => {
      expect(day.clock.minutesOf(day.prayers(day.date)!.asr) + 20).toBe(20 * 60 + 30);
      expect(allowed(day, after("asr"))).toEqual(["maghrib"]);
      // Asr's default is Isha, which passes midnight here; nothing after it passes, so the first passing chip is used.
      expect(defaultReviewChip(day, after("asr"))).toBe("maghrib");
    });
  });

  it("offers the ordinary chips while an after-Taraweeh time is on, though delivery skips those days", () => {
    const main = after("fajr");
    expect(allowed(fallbackDay, main)).toEqual(["morning", "dhuhr", "asr", "maghrib", "evening", "isha"]);
    expect(defaultReviewChip(fallbackDay, main)).toBe("maghrib");
    // In Ramadan the main sitting moves to Isha + 90 minutes, after the review time, so that day is skipped.
    const ramadan = buildDayTimes(
      {
        clock: RIYADH,
        prayers: () => null,
        anchor: main,
        reviewAnchor: chipAnchor("isha"),
        ramadanAnchor: "after_taraweeh",
        isRamadan: () => true,
      },
      fallbackDay.date,
    );
    expect(RIYADH.minutesOf(ramadan.anchorAt)).toBe(21 * 60 + 30);
    expect(RIYADH.minutesOf(ramadan.reviewAt!)).toBe(20 * 60 + 20);
    expect(reviewFitsDay(RIYADH, fallbackDay.date, ramadan.anchorAt, ramadan.reviewAt!)).toBe(false);
  });

  it("never offers a chip whose time passes midnight", () => {
    const times = (date: string): DayPrayerTimes => ({
      fajr: RIYADH.at(date, 300),
      sunrise: RIYADH.at(date, 360),
      dhuhr: RIYADH.at(date, 720),
      asr: RIYADH.at(date, 900),
      maghrib: RIYADH.at(date, 1080),
      isha: RIYADH.at(date, 23 * 60 + 50),
    });
    const late: SittingDay = { ...fallbackDay, prayers: times };
    expect(reviewChipAllowed(late, after("maghrib"), "isha")).toBe(false);
    expect(reviewChipAllowed({ ...late, prayers: () => null }, after("maghrib"), "isha")).toBe(true);
  });
});
