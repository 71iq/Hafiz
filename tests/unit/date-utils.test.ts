import {
  dayIndexFromUtcDateKey,
  formatLocalDateInput,
  formatLocalDateKey,
  normalizeDateDigits,
  parseDueDateInput,
} from "@/lib/date";
import { formatRelativeTime } from "@/lib/i18n/relative-time";

describe("shared date utilities", () => {
  it("formats local date keys and date input values consistently", () => {
    const date = new Date(2026, 5, 15);
    expect(formatLocalDateKey(date)).toBe("2026-06-15");
    expect(formatLocalDateInput(date)).toBe("2026-06-15");
  });

  it("normalizes Arabic and Eastern Arabic date digits before parsing", () => {
    expect(normalizeDateDigits("٢٠٢٦-۰۶-۱۵")).toBe("2026-06-15");
    expect(parseDueDateInput("٢٠٢٦-۰۶-۱۵", new Date(2026, 5, 14))).toMatchObject({
      ok: true,
      date: new Date(2026, 5, 15),
    });
  });

  it("rejects invalid or past due-date input", () => {
    expect(parseDueDateInput("2026-02-30", new Date(2026, 0, 1))).toEqual({ ok: false, reason: "invalid" });
    expect(parseDueDateInput("2026-06-14", new Date(2026, 5, 15))).toEqual({ ok: false, reason: "past" });
  });

  it("keeps UTC day indexes stable for remote date-key summaries", () => {
    expect(dayIndexFromUtcDateKey("1970-01-02")).toBe(1);
  });
});

describe("shared relative time utility", () => {
  it("returns the supplied just-now label for fresh timestamps", () => {
    expect(formatRelativeTime("2026-06-15T09:00:10.000Z", "Just now", "en", Date.parse("2026-06-15T09:00:30.000Z"))).toBe("Just now");
  });

  it("uses localized compact fallback labels when Intl relative time is unavailable", () => {
    const original = Intl.RelativeTimeFormat;
    try {
      (Intl as unknown as { RelativeTimeFormat: typeof Intl.RelativeTimeFormat }).RelativeTimeFormat = function RelativeTimeFormat() {
        throw new Error("unavailable");
      } as unknown as typeof Intl.RelativeTimeFormat;

      expect(formatRelativeTime("2026-06-15T09:00:00.000Z", "الآن", "ar", Date.parse("2026-06-15T09:05:00.000Z"))).toBe("5د");
      expect(formatRelativeTime("2026-06-15T09:00:00.000Z", "Just now", "en", Date.parse("2026-06-15T11:00:00.000Z"))).toBe("2h");
    } finally {
      (Intl as unknown as { RelativeTimeFormat: typeof Intl.RelativeTimeFormat }).RelativeTimeFormat = original;
    }
  });
});
