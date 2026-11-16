import { formatSecondsPerWord } from "@/components/mushaf/HifzControls";
import { keepPageReveals, NO_VERSE_REVEALS, setVerseReveal } from "@/components/mushaf/verse-reveals";

describe("verse reveal state", () => {
  it("keeps reveals through same-page jumps and prunes to the new page on a page change", () => {
    let reveals = setVerseReveal(NO_VERSE_REVEALS, 2, 255, 42, true);
    reveals = setVerseReveal(reveals, 2, 256, 42, true);
    reveals = setVerseReveal(reveals, 2, 257, 43, true);

    const pageOnly = setVerseReveal(reveals, 2, 257, 43, false);
    expect(keepPageReveals(pageOnly, 42)).toBe(pageOnly);
    expect([...pageOnly.keys()]).toEqual(["2:255", "2:256"]);

    expect([...keepPageReveals(reveals, 43).keys()]).toEqual(["2:257"]);
  });

  it("re-hides only through the explicit action and returns the same map when nothing changes", () => {
    const revealed = setVerseReveal(NO_VERSE_REVEALS, 1, 1, 1, true);
    expect(setVerseReveal(revealed, 1, 1, 1, true)).toBe(revealed);
    expect(setVerseReveal(revealed, 1, 1, 1, false).size).toBe(0);
    expect(keepPageReveals(NO_VERSE_REVEALS, 5)).toBe(NO_VERSE_REVEALS);
  });
});

describe("auto reveal speed label", () => {
  it("shows seconds per word in each locale", () => {
    expect(formatSecondsPerWord(500, false, "{{seconds}}s")).toBe("0.5s");
    expect(formatSecondsPerWord(5000, false, "{{seconds}}s")).toBe("5s");
    expect(formatSecondsPerWord(1250, false, "{{seconds}}s")).toBe("1.25s");
    expect(formatSecondsPerWord(500, true, "{{seconds}} ث")).toBe("٠٫٥ ث");
  });
});
