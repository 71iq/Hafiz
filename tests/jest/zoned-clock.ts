import type { DayClock } from "@/lib/notifications/clock";

/** A clock for a named IANA zone, independent of the machine running the tests. */
export function zonedClock(timeZone: string): DayClock {
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
