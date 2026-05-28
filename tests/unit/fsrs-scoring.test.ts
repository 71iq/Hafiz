import { Rating } from "ts-fsrs";
import { computeReviewPoints } from "@/lib/fsrs/scoring";
import {
  DEFAULT_DECK_MAXIMUM_INTERVAL,
  DEFAULT_DECK_REQUEST_RETENTION,
  DEFAULT_ENABLED_MODES,
} from "@/lib/fsrs/types";

describe("FSRS and leaderboard scoring contracts", () => {
  it("does not award points for Again ratings", () => {
    expect(computeReviewPoints(Rating.Again, 30, 10, 100)).toBe(0);
  });

  it("caps streak and retention multipliers", () => {
    const capped = computeReviewPoints(Rating.Good, 999, 10, 999);
    const expected = Math.round(10 * 2 * 1.5 * 1);

    expect(capped).toBe(expected);
  });

  it("keeps Quran memorization FSRS defaults", () => {
    expect(DEFAULT_DECK_REQUEST_RETENTION).toBe(0.95);
    expect(DEFAULT_DECK_MAXIMUM_INTERVAL).toBe(365);
    expect(DEFAULT_ENABLED_MODES).toContain("nextAyah");
    expect(DEFAULT_ENABLED_MODES).toContain("translation");
  });
});
