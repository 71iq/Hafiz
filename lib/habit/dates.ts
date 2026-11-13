/**
 * Calendar days for the wird habit. A local date is a day in the zone the device was in when the
 * event happened, written YYYY-MM-DD. Arithmetic runs on the calendar itself, through UTC midnights,
 * so daylight saving and time-zone travel never add or drop a day.
 */
export type LocalDate = string;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function calendarMs(date: LocalDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromCalendarMs(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromCalendarMs(calendarMs(date) + days * DAY_MS);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((calendarMs(to) - calendarMs(from)) / DAY_MS);
}

/** 0 is Sunday, as in Date.getDay. */
export function weekdayOf(date: LocalDate): number {
  return new Date(calendarMs(date)).getUTCDay();
}

/** The first day of the week containing `date`, for a week starting on `weekStart` (0 is Sunday). */
export function startOfWeek(date: LocalDate, weekStart: number): LocalDate {
  return addDays(date, -((weekdayOf(date) - weekStart + 7) % 7));
}

/** The device's local date for an instant. */
export function localDateOf(at: Date): LocalDate {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The instant of a wall-clock time on a local date in the device's zone. */
export function atLocalTime(date: LocalDate, minutesOfDay: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
}

/**
 * The device's IANA zone, stored beside each event so its date stays fixed after travel. Falls back
 * to a fixed offset when the runtime cannot name the zone.
 */
export function deviceTimeZone(at = new Date()): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === "string" && zone.length > 0) return zone;
  } catch {
    // Fall through to the offset form.
  }
  const offset = -at.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

/** Every date from `from` to `to`, inclusive. Empty when `to` is before `from`. */
export function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const days = diffDays(from, to);
  const dates: LocalDate[] = [];
  for (let i = 0; i <= days; i += 1) dates.push(addDays(from, i));
  return dates;
}
