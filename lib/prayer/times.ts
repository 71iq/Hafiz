import { CalculationMethod, Coordinates, HighLatitudeRule, Madhab, PolarCircleResolution, PrayerTimes } from "adhan";
import { z } from "zod";
import type { DhuhrResolver } from "@/lib/habit/cutoff";
import { atLocalTime, type LocalDate } from "@/lib/habit/dates";

/** The five daily prayers a reminder can follow. */
export const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
export type PrayerName = (typeof PRAYERS)[number];

/** adhan's calculation methods, by the key adhan uses. */
export const CALCULATION_METHODS = [
  "MuslimWorldLeague",
  "Egyptian",
  "Karachi",
  "UmmAlQura",
  "Dubai",
  "MoonsightingCommittee",
  "NorthAmerica",
  "Kuwait",
  "Qatar",
  "Singapore",
  "Tehran",
  "Turkey",
] as const;
export type CalculationMethodKey = (typeof CALCULATION_METHODS)[number];
export const DEFAULT_CALCULATION_METHOD: CalculationMethodKey = "MuslimWorldLeague";

/** Asr: shafi is the standard shadow length used by the Shafi'i, Maliki and Hanbali schools; hanafi doubles it. */
const ASR_MADHABS = ["shafi", "hanafi"] as const;
export type AsrMadhab = (typeof ASR_MADHABS)[number];

/**
 * Where prayer times are computed for. Stored only on this device (ETH-11). Coordinates are rounded
 * to two decimals, about a kilometre, which is far finer than prayer times need.
 */
export const prayerLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  method: z.enum(CALCULATION_METHODS),
  madhab: z.enum(ASR_MADHABS),
  source: z.enum(["device", "manual"]),
});
export type PrayerLocation = z.infer<typeof prayerLocationSchema>;

export type DayPrayerTimes = Readonly<Record<PrayerName | "sunrise", Date>>;

/** Two decimals of a degree, about 1.1 km of latitude. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function isValidInstant(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * The day's prayer times at `location`. adhan reads the calendar date from the Date's local fields,
 * so the date is passed as local noon. Returns null when a time cannot be computed, which the
 * polar-circle resolution makes rare.
 */
export function computePrayerTimes(location: PrayerLocation, date: LocalDate): DayPrayerTimes | null {
  const coordinates = new Coordinates(location.latitude, location.longitude);
  const params = CalculationMethod[location.method]();
  params.madhab = location.madhab === "hanafi" ? Madhab.Hanafi : Madhab.Shafi;
  params.highLatitudeRule = HighLatitudeRule.recommended(coordinates);
  params.polarCircleResolution = PolarCircleResolution.AqrabYaum;
  const times = new PrayerTimes(coordinates, atLocalTime(date, 12 * 60), params);
  const result = {
    fajr: times.fajr,
    sunrise: times.sunrise,
    dhuhr: times.dhuhr,
    asr: times.asr,
    maghrib: times.maghrib,
    isha: times.isha,
  };
  return Object.values(result).every(isValidInstant) ? result : null;
}

/** Prayer times per local date, computed once each. */
export function createPrayerTimesLookup(location: PrayerLocation | null): (date: LocalDate) => DayPrayerTimes | null {
  if (!location) return () => null;
  const cache = new Map<LocalDate, DayPrayerTimes | null>();
  return (date) => {
    if (!cache.has(date)) cache.set(date, computePrayerTimes(location, date));
    return cache.get(date) ?? null;
  };
}

/** The make-up cutoff source for lib/habit (STR-07): Dhuhr from saved prayer times, or null for the 12:30 fallback. */
export function createDhuhrResolver(location: PrayerLocation | null): DhuhrResolver {
  const lookup = createPrayerTimesLookup(location);
  return (date) => lookup(date)?.dhuhr ?? null;
}

/** `offsetMinutes` after `prayer` on `date`, or null when prayer times are not set up. */
export function minutesAfterPrayer(
  location: PrayerLocation | null,
  date: LocalDate,
  prayer: PrayerName,
  offsetMinutes: number,
): Date | null {
  if (!location) return null;
  const times = computePrayerTimes(location, date);
  if (!times) return null;
  return new Date(times[prayer].getTime() + offsetMinutes * 60_000);
}

/**
 * Clock times used when prayer times are not set (5.1 step 7 falls back to clock times). Dhuhr
 * matches the 12:30 make-up cutoff in lib/habit/cutoff.
 */
export const FALLBACK_PRAYER_MINUTES: Readonly<Record<PrayerName, number>> = {
  fajr: 5 * 60,
  dhuhr: 12 * 60 + 30,
  asr: 15 * 60 + 30,
  maghrib: 18 * 60,
  isha: 20 * 60,
};
