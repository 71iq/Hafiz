import { getMemorizedAyahCardCount, getReviewStats, getTotalAyahCardCount } from "@/lib/fsrs/queries";
import type { HabitOverview } from "@/lib/habit/queries";
import type { AppDatabase } from "@/lib/database/types";
import {
  averageReviewsPerActiveDay,
  consistencyFromHabit,
  loadStudyMetrics,
  memorizedSharePercent,
} from "@/lib/progress/metrics";

jest.mock("@/lib/fsrs/queries", () => ({
  getMemorizedAyahCardCount: jest.fn(),
  getReviewStats: jest.fn(),
  getTotalAyahCardCount: jest.fn(),
}));

const db = {} as AppDatabase;

describe("shared study metric definitions", () => {
  it("keeps the memorized share and active-day average formulas with zero denominators", () => {
    expect(memorizedSharePercent(4, 10)).toBe(40);
    expect(memorizedSharePercent(1, 3)).toBe(33);
    expect(memorizedSharePercent(0, 0)).toBe(0);
    expect(averageReviewsPerActiveDay(25, 4)).toBe(6);
    expect(averageReviewsPerActiveDay(0, 0)).toBe(0);
  });

  it("loads one consistent set of figures and rejects when any query fails", async () => {
    jest.mocked(getTotalAyahCardCount).mockResolvedValue(10);
    jest.mocked(getMemorizedAyahCardCount).mockResolvedValue(4);
    jest
      .mocked(getReviewStats)
      .mockResolvedValue({ activity: [{ date: "2026-11-14", count: 7 }], activeDays: 2, totalReviews: 7 });
    await expect(loadStudyMetrics(db)).resolves.toEqual({
      totalAyahCards: 10,
      memorizedAyahCards: 4,
      memorizedSharePercent: 40,
      totalReviews: 7,
      activeDays: 2,
      averageReviewsPerActiveDay: 4,
      activity: [{ date: "2026-11-14", count: 7 }],
    });

    jest.mocked(getReviewStats).mockRejectedValueOnce(new Error("synthetic failure"));
    await expect(loadStudyMetrics(db)).rejects.toThrow("synthetic failure");
  });

  it("takes consistency from the habit owner, not from review days", () => {
    expect(consistencyFromHabit(null, 6)).toBeNull();
    const habit = {
      streak: { length: 5 },
      longest: 12,
      days: [],
      today: "2026-11-14",
    } as unknown as HabitOverview;
    expect(consistencyFromHabit(habit, 6)).toEqual({ current: 5, longest: 12, steadyWeeks: 0 });
  });
});
