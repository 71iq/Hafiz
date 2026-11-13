import type { LocalDate } from "@/lib/habit/dates";

export type HijriDate = Readonly<{ year: number; month: number; day: number }>;

let formatter: Intl.DateTimeFormat | null | undefined;

function umalquraFormatter(): Intl.DateTimeFormat | null {
  if (formatter !== undefined) return formatter;
  try {
    const candidate = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
      timeZone: "UTC",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    formatter = candidate.resolvedOptions().calendar === "islamic-umalqura" ? candidate : null;
  } catch {
    formatter = null;
  }
  return formatter;
}

/**
 * The Umm al-Qura date for a civil date, or null when the runtime's Intl has no such calendar.
 * Callers skip Ramadan behavior in that case (NOT-10) instead of guessing.
 */
export function hijriDateOf(date: LocalDate): HijriDate | null {
  const format = umalquraFormatter();
  if (!format) return null;
  try {
    const parts = format.formatToParts(new Date(`${date}T12:00:00Z`));
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const result = { year: read("year"), month: read("month"), day: read("day") };
    return Number.isInteger(result.year) && Number.isInteger(result.month) && Number.isInteger(result.day)
      ? result
      : null;
  } catch {
    return null;
  }
}

export const RAMADAN_MONTH = 9;

export function isRamadan(date: LocalDate): boolean {
  return hijriDateOf(date)?.month === RAMADAN_MONTH;
}

