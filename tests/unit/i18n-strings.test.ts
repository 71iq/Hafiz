import { strings } from "@/lib/i18n/strings";

describe("bilingual UI strings", () => {
  it("keeps English and Arabic string keys in parity", () => {
    const englishKeys = Object.keys(strings.en).sort();
    const arabicKeys = Object.keys(strings.ar).sort();

    expect(arabicKeys).toEqual(englishKeys);
  });

  it("does not leave empty string values in either locale", () => {
    for (const [locale, localeStrings] of Object.entries(strings)) {
      for (const [key, value] of Object.entries(localeStrings)) {
        expect(`${locale}.${key}`).toBeTruthy();
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
