/**
 * The Android home-screen widget's timeline contract (spec section 7). JavaScript builds the next 7
 * local days as fully worded entries; native validates them with the same rules
 * (WidgetTimelineParser in android/app/src/main/java/com/anonymous/hafiz/widget/WidgetTimeline.kt),
 * stores the JSON and renders the entry active now. A new field needs a version bump on both sides.
 */
export const WIDGET_TIMELINE_VERSION = 1;
export const WIDGET_HORIZON_DAYS = 7;
export const WIDGET_MAX_ENTRIES = 64;
export const WIDGET_MAX_BYTES = 65_536;
/** 7 days plus 2 hours, so a daylight-saving week still fits. */
export const WIDGET_MAX_SPAN_MS = 7 * 86_400_000 + 2 * 3_600_000;
/** 2020-01-01T00:00:00Z */
export const WIDGET_MIN_INSTANT = 1_577_836_800_000;
/** 2100-01-01T00:00:00Z */
export const WIDGET_MAX_INSTANT = 4_102_444_800_000;

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
export const WIDGET_MARKERS = ["begin", "open", "done", "kept", "paused"] as const;
export const WIDGET_IMAGES = ["rest", "warm", "glow", "sit"] as const;
export const WIDGET_TAPS = ["wird", "home"] as const;

export type WidgetState = (typeof WIDGET_STATES)[number];
export type WidgetMarker = (typeof WIDGET_MARKERS)[number];
export type WidgetImage = (typeof WIDGET_IMAGES)[number];
export type WidgetTap = (typeof WIDGET_TAPS)[number];

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
  marker: WidgetMarker;
  /** The streak length in the interface's digits, or null when no count is shown. */
  count: string | null;
  /** Non-null exactly when count is non-null. */
  countCaption: string | null;
  headline: string;
  detail: string | null;
  note: string | null;
  image: WidgetImage | null;
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
