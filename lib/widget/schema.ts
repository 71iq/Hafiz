import { z } from "zod";
import {
  WIDGET_IMAGES,
  WIDGET_MARKERS,
  WIDGET_MAX_BYTES,
  WIDGET_MAX_ENTRIES,
  WIDGET_MAX_INSTANT,
  WIDGET_MAX_SPAN_MS,
  WIDGET_MIN_INSTANT,
  WIDGET_STATES,
  WIDGET_TAPS,
  WIDGET_TIMELINE_VERSION,
  type WidgetTimeline,
} from "@/lib/widget/types";

/**
 * Spec 7.4. The Kotlin parser enforces the same rules, so a timeline JavaScript accepts is one native
 * accepts. Unknown keys are rejected on both sides.
 */
export class WidgetTimelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WidgetTimelineError";
  }
}

// Rule 9: no C0 control character or DEL anywhere in a string.
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const COLOR = /^#[0-9A-F]{6}$/;
const TIME_ZONE = /^[A-Za-z0-9_+\-/:]+$/;

const instant = z.number().int().min(WIDGET_MIN_INSTANT).max(WIDGET_MAX_INSTANT);

function text(min: number, max: number) {
  return z
    .string()
    .min(min)
    .max(max)
    .refine((value) => !CONTROL_CHARACTER.test(value), "control character");
}

const colorsSchema = z.strictObject({
  surface: z.string().regex(COLOR),
  textPrimary: z.string().regex(COLOR),
  textSecondary: z.string().regex(COLOR),
  accent: z.string().regex(COLOR),
  accentText: z.string().regex(COLOR),
});

const entrySchema = z
  .strictObject({
    startsAt: instant,
    state: z.enum(WIDGET_STATES),
    marker: z.enum(WIDGET_MARKERS),
    count: text(1, 12).nullable(),
    countCaption: text(1, 24).nullable(),
    headline: text(1, 48),
    detail: text(1, 120).nullable(),
    note: text(1, 80).nullable(),
    image: z.enum(WIDGET_IMAGES).nullable(),
    contentDescription: text(1, 400),
    tap: z.enum(WIDGET_TAPS),
  })
  .refine((entry) => (entry.count === null) === (entry.countCaption === null), "count and caption");

export const widgetTimelineSchema = z
  .strictObject({
    version: z.literal(WIDGET_TIMELINE_VERSION),
    generatedAt: instant,
    expiresAt: instant,
    timeZone: z.string().min(1).max(64).regex(TIME_ZONE),
    language: z.enum(["en", "ar"]),
    direction: z.enum(["ltr", "rtl"]),
    colorMode: z.enum(["fixed", "system"]),
    colors: colorsSchema.nullable(),
    entries: z.array(entrySchema).min(1).max(WIDGET_MAX_ENTRIES),
  })
  .superRefine((timeline, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message });
    if (timeline.direction !== (timeline.language === "ar" ? "rtl" : "ltr")) issue("direction");
    if ((timeline.colorMode === "fixed") !== (timeline.colors !== null)) issue("colors");
    const { entries } = timeline;
    // Zod still runs this after the length check failed.
    if (entries.length === 0) return;
    if (entries[0].startsAt !== timeline.generatedAt) issue("first entry");
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index].startsAt <= entries[index - 1].startsAt) issue("order");
    }
    if (timeline.expiresAt <= entries[entries.length - 1].startsAt) issue("expiry");
    if (timeline.expiresAt - timeline.generatedAt > WIDGET_MAX_SPAN_MS) issue("span");
  });

/** UTF-8 byte length, counted the way the native side reads the stored file. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Validates the timeline and returns its JSON, or throws WidgetTimelineError (rule 10 included). */
export function serializeWidgetTimeline(timeline: WidgetTimeline): string {
  const parsed = widgetTimelineSchema.safeParse(timeline);
  if (!parsed.success) {
    throw new WidgetTimelineError(
      `Invalid widget timeline: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
    );
  }
  const json = JSON.stringify(timeline);
  if (utf8Length(json) > WIDGET_MAX_BYTES) throw new WidgetTimelineError("Widget timeline is too large");
  return json;
}
