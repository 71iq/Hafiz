import fs from "node:fs";
import path from "node:path";
import { serializeWidgetTimeline, utf8Length, WidgetTimelineError, widgetTimelineSchema } from "@/lib/widget/schema";
import { WIDGET_MAX_BYTES, WIDGET_MAX_SPAN_MS, type WidgetEntry, type WidgetTimeline } from "@/lib/widget/types";

const FIXTURES = path.resolve(__dirname, "../fixtures/widget");
const readFixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
const valid = () => readFixture("timeline-v2-valid.json") as WidgetTimeline;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableTimeline = Mutable<Omit<WidgetTimeline, "entries">> & { entries: Mutable<WidgetEntry>[] };

/** A deep copy of the valid fixture, changed by `change`. */
function variant(change: (timeline: MutableTimeline & Record<string, unknown>) => void): unknown {
  const copy = JSON.parse(JSON.stringify(valid())) as MutableTimeline & Record<string, unknown>;
  change(copy);
  return copy;
}

const accepts = (value: unknown) => widgetTimelineSchema.safeParse(value).success;

describe("widget timeline fixtures", () => {
  it("accepts the valid fixture and round-trips it through serialization", () => {
    const timeline = valid();
    expect(accepts(timeline)).toBe(true);
    expect(JSON.parse(serializeWidgetTimeline(timeline))).toEqual(timeline);
  });

  it("rejects the invalid fixtures as named", () => {
    expect(accepts(readFixture("timeline-v2-invalid-order.json"))).toBe(false);
    expect(accepts(readFixture("timeline-v2-invalid-version.json"))).toBe(false);
  });
});

describe("widget timeline validation (spec 7.4)", () => {
  const cases: [string, (timeline: MutableTimeline & Record<string, unknown>) => void][] = [
    ["version 1", (t) => Object.assign(t, { version: 1 })],
    ["version 3", (t) => Object.assign(t, { version: 3 })],
    ["an unknown top-level key", (t) => Object.assign(t, { extra: true })],
    ["an unknown entry key", (t) => Object.assign(t.entries[0], { extra: true })],
    ["no entries", (t) => (t.entries = [])],
    [
      "65 entries",
      (t) => {
        const first = t.entries[0];
        t.entries = Array.from({ length: 65 }, (_, index) => ({ ...first, startsAt: t.generatedAt + index * 60_000 }));
      },
    ],
    [
      "unsorted startsAt",
      (t) => ([t.entries[1].startsAt, t.entries[2].startsAt] = [t.entries[2].startsAt, t.entries[1].startsAt]),
    ],
    ["a repeated startsAt", (t) => (t.entries[2].startsAt = t.entries[1].startsAt)],
    ["a first entry not at generatedAt", (t) => (t.entries[0].startsAt = t.generatedAt + 1)],
    ["expiresAt not after the last entry", (t) => (t.expiresAt = t.entries[t.entries.length - 1].startsAt)],
    ["a span too long", (t) => (t.expiresAt = t.generatedAt + WIDGET_MAX_SPAN_MS + 1)],
    ["an instant before 2020", (t) => (t.generatedAt = 1_500_000_000_000)],
    ["a fractional instant", (t) => (t.expiresAt = t.expiresAt + 0.5)],
    ["a lower-case color", (t) => (t.colors = { ...t.colors!, surface: "#f8fafc" })],
    ["a short color", (t) => (t.colors = { ...t.colors!, accent: "#0D948" })],
    ["colors with the System theme", (t) => (t.colorMode = "system")],
    ["no colors with a fixed theme", (t) => (t.colors = null)],
    ["a direction that does not match the language", (t) => (t.direction = "rtl")],
    ["neither a count nor a line", (t) => Object.assign(t.entries[0], { count: null, line: null })],
    ["a line of 49 characters", (t) => (t.entries[0].line = "x".repeat(49))],
    ["a control character", (t) => (t.entries[0].line = "line\nbreak")],
    ["a DEL character", (t) => (t.entries[0].note = "note\u007F")],
    ["a time zone with a space", (t) => (t.timeZone = "Asia/Riyadh City")],
    ["an unknown scene", (t) => Object.assign(t.entries[0], { scene: "noon" })],
    ["an unknown pose", (t) => Object.assign(t.entries[0], { pose: "cheer" })],
    ["an unknown flame", (t) => Object.assign(t.entries[0], { flame: "frozen" })],
    ["a tier above 6", (t) => Object.assign(t.entries[0], { tier: 7 })],
    ["an unknown urgency", (t) => Object.assign(t.entries[0], { urgency: "panic" })],
    ["a fractional tier", (t) => Object.assign(t.entries[0], { tier: 1.5 })],
    ["a version 1 field", (t) => Object.assign(t.entries[0], { headline: "Today's wird awaits" })],
    ["a week of six days", (t) => (t.entries[0].week = t.entries[0].week.slice(1))],
    [
      "an unknown day mark",
      (t) => Object.assign(t.entries[0], { week: t.entries[0].week.map((day) => ({ ...day, mark: "missed" })) }),
    ],
    ["an unknown tap", (t) => Object.assign(t.entries[0], { tap: "settings" })],
    ["an unknown state", (t) => Object.assign(t.entries[0], { state: "frozen" })],
  ];

  it.each(cases)("rejects %s", (_name, change) => {
    const timeline = variant(change);
    expect(accepts(timeline)).toBe(false);
    expect(() => serializeWidgetTimeline(timeline as WidgetTimeline)).toThrow(WidgetTimelineError);
  });

  it("accepts the System theme without colors", () => {
    expect(accepts(variant((t) => Object.assign(t, { colorMode: "system", colors: null })))).toBe(true);
  });

  it("rejects JSON over 65,536 bytes even when every field is within its limit", () => {
    const timeline = variant((t) => {
      const first = t.entries[0];
      t.entries = Array.from({ length: 64 }, (_, index) => ({
        ...first,
        startsAt: t.generatedAt + index * 60_000,
        line: "ح".repeat(48),
        note: "ح".repeat(80),
        contentDescription: "ح".repeat(400),
      }));
    }) as WidgetTimeline;
    expect(accepts(timeline)).toBe(true);
    expect(utf8Length(JSON.stringify(timeline))).toBeGreaterThan(WIDGET_MAX_BYTES);
    expect(() => serializeWidgetTimeline(timeline)).toThrow(/too large/);
  });

  it("counts UTF-8 bytes", () => {
    expect(utf8Length("a")).toBe(1);
    expect(utf8Length("ح")).toBe(2);
    expect(utf8Length("٣")).toBe(2);
    expect(utf8Length(" ")).toBe(3);
    expect(utf8Length("😀")).toBe(4);
  });
});
