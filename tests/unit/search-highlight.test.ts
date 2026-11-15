import {
  arabicMatchRanges,
  highlightSegments,
  plainMatchRanges,
  snippetSegments,
  wordMatchRange,
} from "@/lib/search/highlight";
import { planSearchQuery } from "@/lib/search/query-plan";

const join = (segments: { text: string }[]) => segments.map((segment) => segment.text).join("");

describe("search highlighting", () => {
  it("highlights every match in diacritized Arabic and keeps the original text intact", () => {
    const text = "قُلْ هُوَ اللَّهُ أَحَدٌ اللَّهُ الصَّمَدُ";
    const ranges = arabicMatchRanges(text, "الله");
    expect(ranges).toHaveLength(2);
    const segments = highlightSegments(text, ranges);
    expect(join(segments)).toBe(text);
    expect(segments.filter((segment) => segment.highlight).map((segment) => segment.text)).toEqual([
      "اللَّهُ",
      "اللَّهُ",
    ]);
  });

  it("highlights every case-insensitive match in a translation", () => {
    expect(plainMatchRanges("Mercy upon mercy, and more MERCY", "mercy")).toEqual([
      [0, 5],
      [11, 16],
      [27, 32],
    ]);
  });

  it("keeps a root occurrence to its one word", () => {
    expect(wordMatchRange("كَتَبَ كِتَابًا كَتَبَ", "كَتَبَ")).toEqual([[0, 6]]);
  });

  it("trims long text to about fifteen words around the first match", () => {
    const words = Array.from({ length: 40 }, (_, i) => `w${i}`);
    const text = words.join(" ");
    const segments = snippetSegments(text, plainMatchRanges(text, "w20"));
    const shown = join(segments);
    expect(shown.startsWith("… ")).toBe(true);
    expect(shown.endsWith(" …")).toBe(true);
    expect(shown.replace(/…/g, "").trim().split(/\s+/)).toHaveLength(15);
    expect(segments.find((segment) => segment.highlight)?.text).toBe("w20");
  });

  it("shows short text whole", () => {
    expect(join(snippetSegments("one two three", []))).toBe("one two three");
  });
});

describe("search query plan", () => {
  const surahs = [{ number: 18, name_arabic: "الكهف", name_english: "The Cave" }];

  it.each([
    ["2:255", "ayah", false],
    ["2", "surah", false],
    ["page 62", "page", false],
    ["ص ٦٢", "page", false],
    ["2:300", "invalid", false],
    ["Al-Kahf", "surah", true],
  ])("treats %s as %s (searches text: %s)", (input, kind, runSearch) => {
    const plan = planSearchQuery(input, surahs);
    expect(plan.reference?.kind).toBe(kind);
    expect(plan.runSearch).toBe(runSearch);
  });

  it("keeps ordinary words as searches and flags one letter as too short", () => {
    expect(planSearchQuery("mercy", surahs)).toEqual({ reference: null, runSearch: true, tooShort: false });
    expect(planSearchQuery("m", surahs)).toEqual({ reference: null, runSearch: false, tooShort: true });
  });
});
