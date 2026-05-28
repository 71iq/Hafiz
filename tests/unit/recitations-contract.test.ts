import {
  DEFAULT_RECITATION_ID,
  formatReciterLabel,
  getReciterById,
  normalizeRecitationId,
  QF_HUSARY_MURATTAL_RECITATION_ID,
  RECITERS,
} from "@/lib/quran-foundation/recitations";

describe("Quran Foundation recitation contracts", () => {
  it("keeps Husary Murattal as the default recitation", () => {
    expect(QF_HUSARY_MURATTAL_RECITATION_ID).toBe(6);
    expect(DEFAULT_RECITATION_ID).toBe(QF_HUSARY_MURATTAL_RECITATION_ID);
    expect(getReciterById(DEFAULT_RECITATION_ID).nameEn).toBe("Mahmoud Khalil Al-Husary");
    expect(getReciterById(DEFAULT_RECITATION_ID).styleEn).toBe("Murattal");
  });

  it("keeps the bundled reciter list stable and uniquely addressable", () => {
    expect(RECITERS).toHaveLength(12);
    expect(RECITERS.map((reciter) => reciter.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(RECITERS.map((reciter) => reciter.id)).size).toBe(RECITERS.length);
  });

  test.each(RECITERS)("reciter $id has English and Arabic display metadata", (reciter) => {
    expect(reciter.nameEn.trim()).toBeTruthy();
    expect(reciter.nameAr.trim()).toBeTruthy();
    expect(reciter.styleEn.trim()).toBeTruthy();
    expect(reciter.styleAr.trim()).toBeTruthy();
    expect(formatReciterLabel(reciter, "en")).toBe(`${reciter.nameEn} (${reciter.styleEn})`);
    expect(formatReciterLabel(reciter, "ar")).toBe(`${reciter.nameAr} (${reciter.styleAr})`);
  });

  test.each([
    [6, 6],
    ["6", 6],
    ["06", 6],
    [" 7 ", 7],
    [1.5, DEFAULT_RECITATION_ID],
    [0, DEFAULT_RECITATION_ID],
    [-1, DEFAULT_RECITATION_ID],
    ["", DEFAULT_RECITATION_ID],
    ["abc", DEFAULT_RECITATION_ID],
    [null, DEFAULT_RECITATION_ID],
    [undefined, DEFAULT_RECITATION_ID],
  ])("normalizes %p to %p", (value, expected) => {
    expect(normalizeRecitationId(value)).toBe(expected);
  });

  it("uses caller-provided reciter data before built-in reciters", () => {
    const reciter = getReciterById(6, [{
      id: 6,
      nameEn: "Custom",
      nameAr: "مخصص",
      styleEn: "Test",
      styleAr: "اختبار",
    }]);

    expect(formatReciterLabel(reciter, "en")).toBe("Custom (Test)");
    expect(formatReciterLabel(reciter, "ar")).toBe("مخصص (اختبار)");
  });

  it("falls back to a bilingual generic label for unknown positive recitations", () => {
    const reciter = getReciterById(99, []);

    expect(reciter).toEqual({
      id: 99,
      nameEn: "Recitation 99",
      nameAr: "التلاوة 99",
      styleEn: "QF",
      styleAr: "QF",
    });
  });
});
