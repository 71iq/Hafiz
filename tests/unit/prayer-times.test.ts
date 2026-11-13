import { buildWirdCalendar, foldLine } from "@/lib/notifications/calendar";
import { hijriDateOf, isRamadan } from "@/lib/notifications/ramadan";
import { parseManualCoordinates } from "@/lib/prayer/location";
import { parsePrayerLocation } from "@/lib/prayer/settings";
import { computePrayerTimes, createDhuhrResolver, minutesAfterPrayer, type PrayerLocation } from "@/lib/prayer/times";

jest.mock("expo-location", () => ({}));
jest.mock("@/lib/notifications/calendar-file", () => ({ saveCalendarFile: jest.fn() }));

const MAKKAH: PrayerLocation = { latitude: 21.42, longitude: 39.83, method: "UmmAlQura", madhab: "shafi", source: "manual" };
const LONDON: PrayerLocation = { latitude: 51.51, longitude: -0.13, method: "MuslimWorldLeague", madhab: "hanafi", source: "manual" };

function utcMinutes(at: Date): number {
  return at.getUTCHours() * 60 + at.getUTCMinutes();
}

describe("prayer times", () => {
  it("computes the day's prayers in order", () => {
    const times = computePrayerTimes(MAKKAH, "2026-11-12")!;
    const order = [times.fajr, times.sunrise, times.dhuhr, times.asr, times.maghrib, times.isha].map((at) => at.getTime());
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Makkah is UTC+3 with Dhuhr near 12:10 local in November.
    expect(utcMinutes(times.dhuhr)).toBeGreaterThanOrEqual(9 * 60);
    expect(utcMinutes(times.dhuhr)).toBeLessThanOrEqual(9 * 60 + 25);
    // Umm al-Qura sets Isha 90 minutes after Maghrib.
    expect((times.isha.getTime() - times.maghrib.getTime()) / 60_000).toBe(90);
  });

  it("uses the Hanafi Asr when chosen", () => {
    const shafi = computePrayerTimes({ ...LONDON, madhab: "shafi" }, "2026-06-21")!;
    const hanafi = computePrayerTimes(LONDON, "2026-06-21")!;
    expect(hanafi.asr.getTime()).toBeGreaterThan(shafi.asr.getTime());
  });

  it("gives times at high latitudes in summer instead of failing", () => {
    expect(computePrayerTimes({ ...LONDON, latitude: 64.15, longitude: -21.94 }, "2026-06-21")).not.toBeNull();
  });

  it("resolves Dhuhr for lib/habit and falls back to null without a location", () => {
    expect(createDhuhrResolver(null)("2026-11-12")).toBeNull();
    const dhuhr = createDhuhrResolver(MAKKAH)("2026-11-12");
    expect(dhuhr?.getTime()).toBe(computePrayerTimes(MAKKAH, "2026-11-12")!.dhuhr.getTime());
    const afterFajr = minutesAfterPrayer(MAKKAH, "2026-11-12", "fajr", 20)!;
    expect(afterFajr.getTime() - computePrayerTimes(MAKKAH, "2026-11-12")!.fajr.getTime()).toBe(20 * 60_000);
    expect(minutesAfterPrayer(null, "2026-11-12", "fajr", 20)).toBeNull();
  });

  it("reads typed coordinates, including Arabic digits and a decimal comma", () => {
    expect(parseManualCoordinates("21.4225", "39.8262")).toEqual({ latitude: 21.42, longitude: 39.83 });
    expect(parseManualCoordinates("٢١٫٤٢", "-0,13")).toEqual({ latitude: 21.42, longitude: -0.13 });
    expect(parseManualCoordinates("91", "0")).toBeNull();
    expect(parseManualCoordinates("abc", "0")).toBeNull();
  });

  it("parses a stored location and rejects a bad one", () => {
    expect(parsePrayerLocation(JSON.stringify(MAKKAH))).toEqual(MAKKAH);
    expect(parsePrayerLocation(JSON.stringify({ ...MAKKAH, method: "Unknown" }))).toBeNull();
    expect(parsePrayerLocation("not json")).toBeNull();
  });
});

describe("Ramadan detection", () => {
  it("reads the Umm al-Qura month from Intl", () => {
    // 1 Ramadan 1447 is 18 February 2026 in Umm al-Qura.
    expect(hijriDateOf("2026-02-18")).toEqual({ year: 1447, month: 9, day: 1 });
    expect(isRamadan("2026-03-01")).toBe(true);
    expect(isRamadan("2026-11-12")).toBe(false);
  });
});

describe("calendar file (AMB-05)", () => {
  it("builds one daily floating-time event with a reminder", () => {
    const ics = buildWirdCalendar({
      date: "2026-11-12",
      minutes: 5 * 60 + 20,
      title: "Daily wird (Hafiz)",
      description: "A few minutes, then rest; it counts.",
      now: new Date("2026-11-12T09:00:00Z"),
      uid: "daily-wird@hafizquran.app",
    });
    expect(ics).toContain("\r\nDTSTART:20261112T052000\r\n");
    expect(ics).toContain("\r\nRRULE:FREQ=DAILY\r\n");
    expect(ics).toContain("\r\nDTSTAMP:20261112T090000Z\r\n");
    expect(ics).toContain("DESCRIPTION:A few minutes\\, then rest\\; it counts.");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("folds long lines at 75 octets without splitting Arabic letters", () => {
    const line = `SUMMARY:${"الوِرد اليومي ".repeat(10)}`;
    const folded = foldLine(line);
    const encoder = new TextEncoder();
    for (const part of folded.split("\r\n")) expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n ").join("")).toBe(line);
  });
});
