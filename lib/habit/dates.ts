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

export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((calendarMs(to) - calendarMs(from)) / DAY_MS);
}

export function weekdayOf(date: LocalDate): number {
  return new Date(calendarMs(date)).getUTCDay();
}

export function startOfWeek(date: LocalDate, weekStart: number): LocalDate {
  return addDays(date, -((weekdayOf(date) - weekStart + 7) % 7));
}

export function localDateOf(at: Date): LocalDate {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function atLocalTime(date: LocalDate, minutesOfDay: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
}

export function deviceTimeZone(at = new Date()): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === "string" && zone.length > 0) return zone;
  } catch {
  }
  const offset = -at.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

export function deviceZoneKey(at = new Date()): string {
  return `${deviceTimeZone(at)}|${at.getTimezoneOffset()}`;
}

export function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const days = diffDays(from, to);
  const dates: LocalDate[] = [];
  for (let i = 0; i <= days; i += 1) dates.push(addDays(from, i));
  return dates;
}
