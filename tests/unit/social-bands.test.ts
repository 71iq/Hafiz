import * as fc from "fast-check";
import {
  approximatePagesFromAyahs,
  deviceUtcOffsetMinutes,
  LEVEL_BANDS,
  levelBand,
  offsetBand,
  paceBand,
  newPerDayFromPlan,
  socialBands,
} from "@/lib/social/bands";

describe("level band (8.13)", () => {
  it.each([
    [0, "starting"],
    [19.9, "starting"],
    [20, "juz_amma"],
    [60, "juz_amma"],
    [60.5, "juz_4_15"],
    [300, "juz_4_15"],
    [300.5, "juz_16_29"],
    [603, "juz_16_29"],
    [604, "hafiz"],
    [-5, "starting"],
    [Number.NaN, "starting"],
  ] as const)("%s pages is %s", (pages, band) => {
    expect(levelBand(pages)).toBe(band);
  });

  it("never moves down as more pages are memorized", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 604, noNaN: true }), fc.double({ min: 0, max: 604, noNaN: true }), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        return LEVEL_BANDS.indexOf(levelBand(low)) <= LEVEL_BANDS.indexOf(levelBand(high));
      }),
    );
  });
});

describe("pace band (8.13)", () => {
  it.each([
    [0, "maintenance"],
    [-1, "maintenance"],
    [Number.NaN, "maintenance"],
    [0.25, "light"],
    [1 / 3, "light"],
    [0.5, "half_page"],
    [0.99, "half_page"],
    [1, "page_plus"],
    [2, "page_plus"],
  ] as const)("%s new pages a day is %s", (pages, band) => {
    expect(paceBand(pages)).toBe(band);
  });
});

describe("offset band", () => {
  it("groups offsets into two-hour buckets with halves rounding up, like the server", () => {
    expect(offsetBand(0)).toBe(0);
    expect(offsetBand(-60)).toBe(0);
    expect(offsetBand(60)).toBe(1);
    expect(offsetBand(180)).toBe(2);
    expect(offsetBand(-180)).toBe(-1);
    expect(offsetBand(330)).toBe(3);
    expect(offsetBand(-720)).toBe(-6);
    expect(offsetBand(840)).toBe(7);
  });

  it("matches the server's floor(m / 120 + 0.5) for every whole minute offset", () => {
    for (let minutes = -720; minutes <= 840; minutes += 15) {
      expect(offsetBand(minutes)).toBe(Math.floor(minutes / 120 + 0.5));
    }
  });

  it("reads the device offset as minutes east of UTC", () => {
    const at = new Date("2026-11-13T12:00:00Z");
    jest.spyOn(at, "getTimezoneOffset").mockReturnValue(-180);
    expect(deviceUtcOffsetMinutes(at)).toBe(180);
  });
});

describe("local inputs", () => {
  it("approximates pages from ayah cards in one place, capped at the mushaf", () => {
    expect(approximatePagesFromAyahs(0)).toBe(0);
    expect(approximatePagesFromAyahs(103)).toBeCloseTo(10);
    expect(approximatePagesFromAyahs(6236)).toBe(604);
    expect(approximatePagesFromAyahs(-3)).toBe(0);
  });

  it("treats a missing or unreadable plan as maintenance", () => {
    expect(newPerDayFromPlan(null)).toBe(0);
    expect(newPerDayFromPlan("not json")).toBe(0);
    expect(newPerDayFromPlan('{"method":"page"}')).toBe(0);
    expect(newPerDayFromPlan('{"new_per_day":-1}')).toBe(0);
    expect(newPerDayFromPlan('{"new_per_day":0.5,"cycle_days":30}')).toBe(0.5);
  });

  it("combines the inputs into bands", () => {
    expect(socialBands({ memorizedAyahs: 600, newPerDayPages: 0.5, utcOffsetMinutes: 180 })).toEqual({
      levelBand: "juz_amma",
      paceBand: "half_page",
      utcOffsetMinutes: 180,
    });
  });
});
