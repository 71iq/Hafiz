/**
 * The Android home-screen widget's timeline contract (spec section 7). JavaScript builds the next 7
 * local days as fully worded entries; native validates them with the same rules
 * (WidgetTimelineParser in android/app/src/main/java/com/anonymous/hafiz/widget/WidgetTimeline.kt),
 * stores the JSON and renders the entry active now. A new field needs a version bump on both sides.
 */
export const WIDGET_TIMELINE_VERSION = 2;
export const WIDGET_HORIZON_DAYS = 7;
export const WIDGET_MAX_ENTRIES = 64;
export const WIDGET_MAX_BYTES = 65_536;
/** 7 days plus 2 hours, so a daylight-saving week still fits. */
export const WIDGET_MAX_SPAN_MS = 7 * 86_400_000 + 2 * 3_600_000;
/** 2020-01-01T00:00:00Z */
export const WIDGET_MIN_INSTANT = 1_577_836_800_000;
/** 2100-01-01T00:00:00Z */
export const WIDGET_MAX_INSTANT = 4_102_444_800_000;
/** Streak stages from lib/habit/milestones streakTier: 0 below 7 days, 6 from 365. */
export const WIDGET_MAX_TIER = 6;

export const WIDGET_STATES = [
  "begin",
  "fresh_start",
  "open_day",
  "open_evening",
  "make_up",
  "earn_back_open",
  "earn_back_done",
  "done",
  "safe",
  "milestone",
  "kept",
  "paused",
] as const;
/** The background: the sky over the olive grove for this moment of the person's local day. */
export const WIDGET_SCENES = [
  "dawn",
  "morning",
  "day",
  "golden",
  "dusk",
  "night",
  "midnight",
  "sunrise",
  "radiant",
  "radiant_night",
  "milestone",
  "calm",
] as const;
/** Zayt's still. The _halo poses carry their own light for the night scenes. */
export const WIDGET_POSES = [
  "rest",
  "warm",
  "wave",
  "glow",
  "open",
  "shimmer",
  "milestone",
  "sit",
  "glow_halo",
  "open_halo",
  "warm_halo",
  "shimmer_halo",
  // The urgency batch (owner decision, 2026-11-21): faces that follow the time left.
  "eager",
  "impatient",
  "worried",
  "anxious",
  "panicked",
  "relieved",
  "lonely",
  "worried_halo",
  "anxious_halo",
  "panicked_halo",
  "relieved_halo",
] as const;
/** How close the streak is to being lost (lib/widget/copy.ts widgetUrgencyAt). */
export const WIDGET_URGENCIES = ["none", "calm", "steady", "nudge", "urgent", "critical", "last"] as const;
/** The streak icon: lit once today counts, unlit while the streak waits for today, out at zero. */
export const WIDGET_FLAMES = ["lit", "unlit", "out"] as const;
export const WIDGET_TAPS = ["wird", "home"] as const;
/** One day in the 4 by 2 widget's week row: recited, kept without recitation, today still open, or nothing. */
export const WIDGET_DAY_MARKS = ["lit", "kept", "open", "empty"] as const;
export const WIDGET_WEEK_DAYS = 7;

export type WidgetState = (typeof WIDGET_STATES)[number];
export type WidgetScene = (typeof WIDGET_SCENES)[number];
export type WidgetPose = (typeof WIDGET_POSES)[number];
export type WidgetFlame = (typeof WIDGET_FLAMES)[number];
export type WidgetUrgencyLevel = (typeof WIDGET_URGENCIES)[number];
export type WidgetTap = (typeof WIDGET_TAPS)[number];
export type WidgetDayMark = (typeof WIDGET_DAY_MARKS)[number];

/** A day of the week row: its mark and its one-letter weekday in the interface language. */
export type WidgetWeekDay = Readonly<{ mark: WidgetDayMark; label: string }>;

/** "#RRGGBB", upper case. */
export type WidgetColors = Readonly<{
  surface: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentText: string;
}>;

export type WidgetEntry = Readonly<{
  /** Epoch ms. The entry lasts until the next entry's startsAt, the last one until expiresAt. */
  startsAt: number;
  state: WidgetState;
  /** Time left before the streak is at stake; drives the waiting flame's ember. */
  urgency: WidgetUrgencyLevel;
  scene: WidgetScene;
  /** Null when Show Zayt is off: the widget then uses the app theme's plain card. */
  pose: WidgetPose | null;
  flame: WidgetFlame;
  /** 0 to WIDGET_MAX_TIER, the lit flame's streak stage. */
  tier: number;
  /** The streak length in the interface's digits, "0" included, or null when Show numbers is off. */
  count: string | null;
  /** One short line beside the count, or null when the art and the lit flame say it. */
  line: string | null;
  /** The plan or grace note for the larger layouts, or null. */
  note: string | null;
  /** The last 7 local days, oldest first and today last, for the 4 by 2 widget. */
  week: readonly WidgetWeekDay[];
  contentDescription: string;
  tap: WidgetTap;
}>;

export type WidgetEntryContent = Omit<WidgetEntry, "startsAt">;

export type WidgetTimeline = Readonly<{
  version: typeof WIDGET_TIMELINE_VERSION;
  /** Build instant, epoch ms. */
  generatedAt: number;
  /** End of the last entry. */
  expiresAt: number;
  /** deviceTimeZone() at build time. */
  timeZone: string;
  language: "en" | "ar";
  direction: "ltr" | "rtl";
  /** "system" lets the widget's resource colors follow the launcher's night mode live. */
  colorMode: "fixed" | "system";
  /** Non-null exactly when colorMode is "fixed". */
  colors: WidgetColors | null;
  entries: readonly WidgetEntry[];
}>;
