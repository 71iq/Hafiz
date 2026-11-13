import { teacherCardLabel } from "@/components/social/TeacherViewSheet";
import { strings } from "@/lib/i18n/strings";
import { formatClockMinutesForDisplay } from "@/lib/notifications/clock";

describe("teacher view card labels (SOC-03)", () => {
  it.each([
    ["page:madani15:582", "Page 582"],
    ["half:madani15:582:a", "Page 582, first half"],
    ["half:madani15:582:b", "Page 582, second half"],
    ["seam:madani15:581", "Page 581 into 582"],
    ["chunk:madani15:12:3-7", "Page 12, lines 3 to 7"],
    ["2:255", "Surah 2, ayah 255"],
    ["qiraat:2:255", "Surah 2, ayah 255"],
  ])("names %s in words", (cardId, label) => {
    expect(teacherCardLabel(cardId, "en", strings.en)).toBe(label);
  });

  it("uses Arabic digits and words in Arabic", () => {
    expect(teacherCardLabel("page:madani15:582", "ar", strings.ar)).toBe("صفحة ٥٨٢");
    expect(teacherCardLabel("half:madani15:5:a", "ar", strings.ar)).toBe("صفحة ٥، النصف الأول");
  });

  it("never shows a storage key it cannot read", () => {
    for (const cardId of ["page:madani15:999", "page:other:5", "mutashabihat:g1:2", "0f8c4b0e-5d1e-4c3a-9f3e-1a2b3c4d5e6f", "200:1"]) {
      expect(teacherCardLabel(cardId, "en", strings.en)).toBe(strings.en.teacherViewUnitOther);
    }
  });
});

describe("reminder time display (L14)", () => {
  it("writes the time the way the interface language does", () => {
    expect(formatClockMinutesForDisplay(23 * 60 + 15, "en").replace(/\s/g, " ")).toBe("11:15 PM");
    expect(formatClockMinutesForDisplay(5 * 60 + 20, "en").replace(/\s/g, " ")).toBe("5:20 AM");
    expect(formatClockMinutesForDisplay(23 * 60 + 15, "ar")).toMatch(/^[٠-٩]{1,2}:[٠-٩]{2}/);
  });

  it("wraps minutes outside one day", () => {
    expect(formatClockMinutesForDisplay(-45, "en")).toBe(formatClockMinutesForDisplay(23 * 60 + 15, "en"));
    expect(formatClockMinutesForDisplay(1440 + 60, "en")).toBe(formatClockMinutesForDisplay(60, "en"));
  });
});
