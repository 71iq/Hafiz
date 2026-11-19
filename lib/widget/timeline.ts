import { addDays, type LocalDate } from "@/lib/habit/dates";
import type { HabitPause, HabitDay } from "@/lib/habit/types";
import type { DayClock } from "@/lib/notifications/clock";
import { makeUpCutoff } from "@/lib/notifications/day-times";
import { createHabitProjector } from "@/lib/notifications/habit-projection";
import type { DayPrayerTimes } from "@/lib/prayer/times";
import { describeWidgetEntry, type WidgetPlanFacts } from "@/lib/widget/copy";
import type { WidgetAppearance } from "@/lib/widget/palette";
import {
  WIDGET_HORIZON_DAYS,
  WIDGET_TIMELINE_VERSION,
  type WidgetEntry,
  type WidgetEntryContent,
  type WidgetTimeline,
} from "@/lib/widget/types";

export type WidgetBuildInput = Readonly<{
  now: Date;
  clock: DayClock;
  timeZone: string;
  habit: Readonly<{ days: readonly HabitDay[]; pause: HabitPause | null }>;
  prayers: (date: LocalDate) => DayPrayerTimes | null;
  /** The streak-at-risk time from buildDayTimes, where the calm evening band starts (spec 4.5). */
  eveningStartsAt: (date: LocalDate) => Date;
  plan: WidgetPlanFacts;
  language: "en" | "ar";
  appearance: WidgetAppearance;
  showZayt: boolean;
  showNumbers: boolean;
}>;

function sameContent(a: WidgetEntryContent, b: WidgetEntryContent): boolean {
  return (
    a.state === b.state &&
    a.marker === b.marker &&
    a.count === b.count &&
    a.countCaption === b.countCaption &&
    a.headline === b.headline &&
    a.detail === b.detail &&
    a.note === b.note &&
    a.image === b.image &&
    a.contentDescription === b.contentDescription &&
    a.tap === b.tap
  );
}

/**
 * Spec 7.2: the next 7 local days for a person who does nothing more, as entries that start at each
 * instant the widget can change: now, each local midnight, each make-up cutoff (where yesterday's
 * window closes and grace settles), each evening band start, and when more review comes due today.
 * lib/habit's projection applies every streak rule; this only words the result. Pure.
 */
export function buildWidgetTimeline(input: WidgetBuildInput): WidgetTimeline {
  const { now, clock, prayers } = input;
  const today = clock.dateOf(now);
  const expiresAt = clock.at(addDays(today, WIDGET_HORIZON_DAYS), 0).getTime();
  const nowMs = now.getTime();

  const candidates = [nowMs];
  for (let offset = 0; offset < WIDGET_HORIZON_DAYS; offset += 1) {
    const date = addDays(today, offset);
    candidates.push(
      clock.at(date, 0).getTime(),
      makeUpCutoff({ clock, prayers }, addDays(date, -1)).getTime(),
      input.eveningStartsAt(date).getTime(),
    );
  }
  if (input.plan.moreDueAt) candidates.push(input.plan.moreDueAt.getTime());
  const instants = [...new Set(candidates.filter((at) => at >= nowMs && at < expiresAt))].sort((a, b) => a - b);

  const projector = createHabitProjector({ habit: input.habit, clock, prayers }, today);
  const entries: WidgetEntry[] = [];
  let previous: WidgetEntryContent | null = null;
  for (const startsAt of instants) {
    const at = new Date(startsAt);
    const content = describeWidgetEntry(projector(clock.dateOf(at), at), at, input);
    if (previous && sameContent(previous, content)) continue;
    entries.push({ startsAt, ...content });
    previous = content;
  }

  return {
    version: WIDGET_TIMELINE_VERSION,
    generatedAt: nowMs,
    expiresAt,
    timeZone: input.timeZone,
    language: input.language,
    direction: input.language === "ar" ? "rtl" : "ltr",
    colorMode: input.appearance.colorMode,
    colors: input.appearance.colorMode === "fixed" ? input.appearance.colors : null,
    entries,
  };
}

export type WidgetSelection =
  | Readonly<{ kind: "entry"; entry: WidgetEntry; nextBoundary: number }>
  | Readonly<{ kind: "neutral"; reason: "zone" | "early" | "expired" }>;

/**
 * Spec 7.5, the reference for WidgetSelector in Kotlin: the entry active at `nowMs`, or the neutral
 * state after a time zone change, before the first entry or once the timeline has run out.
 */
export function selectWidgetEntry(timeline: WidgetTimeline, nowMs: number, zoneMatches: boolean): WidgetSelection {
  if (!zoneMatches) return { kind: "neutral", reason: "zone" };
  const { entries } = timeline;
  if (nowMs < entries[0].startsAt) return { kind: "neutral", reason: "early" };
  if (nowMs >= timeline.expiresAt) return { kind: "neutral", reason: "expired" };
  let index = 0;
  while (index + 1 < entries.length && entries[index + 1].startsAt <= nowMs) index += 1;
  const next = entries[index + 1];
  return { kind: "entry", entry: entries[index], nextBoundary: next ? next.startsAt : timeline.expiresAt };
}
