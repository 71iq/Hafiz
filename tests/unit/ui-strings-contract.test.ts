import { strings } from "@/lib/i18n/strings";

describe("UI string contracts", () => {
  it("keeps English UI labels free of Arabic script unless explicitly intentional", () => {
    const allowedArabicInEnglish = new Set([
      "progressHadith",
      "flashcardsLearningStepsInfo",
      "flashcardsRelearningStepsInfo",
    ]);
    const arabicScript = /[\u0600-\u06FF]/;

    const accidentalArabic = Object.entries(strings.en)
      .filter(([key, value]) => !allowedArabicInEnglish.has(key) && arabicScript.test(value))
      .map(([key]) => key);

    expect(accidentalArabic).toEqual([]);
  });
});
