import type { DatabaseExecutor } from "@/lib/database/types";
import type { LocalDate } from "@/lib/habit/dates";
import { notificationsStrings } from "@/lib/i18n/features/notifications";
import { interpolate } from "@/lib/i18n/useStrings";
import { readPrayerLocation } from "@/lib/prayer/settings";
import { createPrayerTimesLookup } from "@/lib/prayer/times";
import { saveCalendarFile } from "@/lib/notifications/calendar-file";
import { deviceClock, type DayClock } from "@/lib/notifications/clock";
import { resolveAnchorAt } from "@/lib/notifications/day-times";
import { readReminderPrefs, readUiLanguage } from "@/lib/notifications/settings";
import { prayerLabel, type Language } from "@/lib/notifications/templates";
import type { ReminderAnchor } from "@/lib/notifications/types";

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

export type WirdCalendarEvent = Readonly<{
  minutes: number;
  title: string;
  description: string;
  /** Stable, so a calendar updates the event when the file is added again. */
  uid: string;
}>;

/**
 * AMB-05: daily repeating events, each with a reminder at its start: the wird, and the second sitting
 * for review when it is on (REMIND-07). The time is floating (no zone), so it stays at the same
 * wall-clock time wherever the calendar is.
 */
export function buildWirdCalendar(input: { date: LocalDate; now: Date; events: readonly WirdCalendarEvent[] }): string {
  const event = (item: WirdCalendarEvent) => {
    const hours = String(Math.floor(item.minutes / 60)).padStart(2, "0");
    const minutes = String(item.minutes % 60).padStart(2, "0");
    return [
      "BEGIN:VEVENT",
      `UID:${item.uid}`,
      `DTSTAMP:${utcStamp(input.now)}`,
      `DTSTART:${compactDate(input.date)}T${hours}${minutes}00`,
      "DURATION:PT15M",
      "RRULE:FREQ=DAILY",
      `SUMMARY:${escapeText(item.title)}`,
      `DESCRIPTION:${escapeText(item.description)}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(item.title)}`,
      "TRIGGER:PT0M",
      "END:VALARM",
      "END:VEVENT",
    ];
  };
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hafiz//Daily wird//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...input.events.flatMap(event),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/**
 * The calendar file for the user's reminder time, and for the second sitting when it is on. A prayer
 * anchor uses today's time, rounded to 5 minutes, and the description says that prayer times move
 * through the year. Neither event follows the Ramadan time.
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
  const day = { clock, prayers: createPrayerTimesLookup(location) };
  const minutesOf = (anchor: ReminderAnchor) =>
    anchor.kind === "clock" ? anchor.minutes : (Math.round(clock.minutesOf(resolveAnchorAt(day, date, anchor)) / 5) * 5) % 1440;
  const describe = (note: string, anchor: ReminderAnchor) =>
    anchor.kind === "prayer"
      ? `${note} ${interpolate(strings.notifCalendarEventPrayerNote, { prayer: prayerLabel(anchor.prayer, lang) })}`
      : note;
  const events: WirdCalendarEvent[] = [
    {
      minutes: minutesOf(prefs.anchor),
      title: strings.notifCalendarEventTitle,
      description: describe(strings.notifCalendarEventNote, prefs.anchor),
      uid: "daily-wird@hafizquran.app",
    },
  ];
  if (prefs.reviewAnchor) {
    events.push({
      minutes: minutesOf(prefs.reviewAnchor),
      title: strings.notifCalendarReviewEventTitle,
      description: describe(strings.notifCalendarReviewEventNote, prefs.reviewAnchor),
      uid: "daily-review@hafizquran.app",
    });
  }
  return buildWirdCalendar({ date, now, events });
}

/** Build the file and hand it to the platform: a download on web, the share sheet on native. */
export async function exportWirdCalendar(
  db: DatabaseExecutor,
  options: { now?: Date; language?: Language } = {},
): Promise<void> {
  const contents = await buildWirdCalendarForUser(db, options);
  await saveCalendarFile(CALENDAR_FILE_NAME, contents);
}
