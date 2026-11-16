import { localDateOf, type LocalDate } from "@/lib/habit/dates";

export type DayClock = Readonly<{
  at: (date: LocalDate, minutes: number) => Date;
  dateOf: (at: Date) => LocalDate;
  minutesOf: (at: Date) => number;
  weekdayOf: (date: LocalDate) => number;
}>;

export const deviceClock: DayClock = {
  at: (date, minutes) => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day, 0, minutes, 0, 0);
  },
  dateOf: localDateOf,
  minutesOf: (at) => at.getHours() * 60 + at.getMinutes(),
  weekdayOf: (date) => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  },
};

export function formatClockMinutes(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  return `${String(hours).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

const displayFormatters = new Map<"en" | "ar", Intl.DateTimeFormat>();

export function formatClockMinutesForDisplay(minutes: number, language: "en" | "ar"): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  let formatter = displayFormatters.get(language);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language === "ar" ? "ar-u-nu-arab" : "en", { hour: "numeric", minute: "2-digit" });
    displayFormatters.set(language, formatter);
  }
  return formatter.format(new Date(2000, 0, 1, Math.floor(normalized / 60), normalized % 60));
}
