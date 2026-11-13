import type { DatabaseExecutor } from "@/lib/database/types";
import type { LocalDate } from "@/lib/habit/dates";
import { notificationsStrings } from "@/lib/i18n/features/notifications";
import { interpolate } from "@/lib/i18n/useStrings";
import { readPrayerLocation } from "@/lib/prayer/settings";
import { createPrayerTimesLookup } from "@/lib/prayer/times";
import { saveCalendarFile } from "@/lib/notifications/calendar-file";
import { deviceClock, type DayClock } from "@/lib/notifications/clock";
import { buildDayTimes } from "@/lib/notifications/day-times";
import { isRamadan } from "@/lib/notifications/ramadan";
import { readReminderPrefs, readUiLanguage } from "@/lib/notifications/settings";
import { prayerLabel, type Language } from "@/lib/notifications/templates";

const CALENDAR_FILE_NAME = "hafiz-daily-wird.ics";

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 3.1: fold lines longer than 75 octets, without splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function compactDate(date: LocalDate): string {
  return date.replace(/-/g, "");
}

function utcStamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * AMB-05: one daily repeating event with a reminder at its start. The time is floating (no zone),
 * so it stays at the same wall-clock time wherever the calendar is.
 */
export function buildWirdCalendar(input: {
  date: LocalDate;
  minutes: number;
  title: string;
  description: string;
  now: Date;
  uid: string;
}): string {
  const hours = String(Math.floor(input.minutes / 60)).padStart(2, "0");
  const minutes = String(input.minutes % 60).padStart(2, "0");
  const start = `${compactDate(input.date)}T${hours}${minutes}00`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hafiz//Daily wird//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${utcStamp(input.now)}`,
    `DTSTART:${start}`,
    "DURATION:PT15M",
    "RRULE:FREQ=DAILY",
    `SUMMARY:${escapeText(input.title)}`,
    `DESCRIPTION:${escapeText(input.description)}`,
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(input.title)}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/**
 * The calendar file for the user's reminder time. A prayer anchor uses today's time, rounded to 5
 * minutes, and the description says that prayer times move through the year.
 */
async function buildWirdCalendarForUser(
  db: DatabaseExecutor,
  { now = new Date(), language, clock = deviceClock }: { now?: Date; language?: Language; clock?: DayClock } = {},
): Promise<string> {
  const [prefs, location, lang] = await Promise.all([
    readReminderPrefs(db),
    readPrayerLocation(db),
    language ? Promise.resolve(language) : readUiLanguage(db),
  ]);
  const strings = notificationsStrings[lang];
  const date = clock.dateOf(now);
  const times = buildDayTimes(
    { clock, prayers: createPrayerTimesLookup(location), anchor: prefs.anchor, ramadanAnchor: null, isRamadan },
    date,
  );
  const exact = clock.minutesOf(times.anchorAt);
  const minutes = prefs.anchor.kind === "clock" ? prefs.anchor.minutes : (Math.round(exact / 5) * 5) % 1440;
  const description =
    prefs.anchor.kind === "prayer"
      ? `${strings.notifCalendarEventNote} ${interpolate(strings.notifCalendarEventPrayerNote, {
          prayer: prayerLabel(prefs.anchor.prayer, lang),
        })}`
      : strings.notifCalendarEventNote;
  return buildWirdCalendar({
    date,
    minutes,
    title: strings.notifCalendarEventTitle,
    description,
    now,
    // A stable UID lets a calendar update the event when the file is added again.
    uid: "daily-wird@hafizquran.app",
  });
}

/** Build the file and hand it to the platform: a download on web, the share sheet on native. */
export async function exportWirdCalendar(
  db: DatabaseExecutor,
  options: { now?: Date; language?: Language } = {},
): Promise<void> {
  const contents = await buildWirdCalendarForUser(db, options);
  await saveCalendarFile(CALENDAR_FILE_NAME, contents);
}
