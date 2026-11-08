import {
  fetchPublicAchievementUnlocks,
  fetchPublicReviewActivity,
  fetchPublicSurahProgress,
  fetchStreakLeaderboard,
} from "@/lib/leaderboard/api";

const mockTables = new Map<string, { data: unknown; error: null }>();
function mockQuery(table: string) {
  const result = mockTables.get(table) ?? { data: [], error: null };
  const query = Object.assign(Promise.resolve(result), {
    maybeSingle: () => Promise.resolve(result),
    select: () => query,
    eq: () => query,
    gte: () => query,
    order: () => query,
    limit: () => query,
  });
  return query;
}
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { from: (table: string) => mockQuery(table) },
}));

const USER = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-03T12:00:00Z"));
  mockTables.clear();
});
afterEach(() => jest.useRealTimers());

describe("RF-191 leaderboard and public stats rows are validated", () => {
  it("rejects a review count that is not a number instead of concatenating it", async () => {
    mockTables.set("public_review_activity", { data: [{ date: "2026-11-02", reviews_count: "5" }], error: null });
    mockTables.set("public_review_stats", { data: null, error: null });

    await expect(fetchPublicReviewActivity(USER, 7)).rejects.toThrow();
  });

  it("rejects malformed public stats instead of showing undefined totals", async () => {
    mockTables.set("public_review_stats", { data: { total_reviews: "many" }, error: null });

    await expect(fetchPublicReviewActivity(USER, 7)).rejects.toThrow();
  });

  it("rejects a surah progress row without a numeric surah", async () => {
    mockTables.set("public_surah_progress", { data: [{ surah: "2", total_cards: 3 }], error: null });

    await expect(fetchPublicSurahProgress(USER)).rejects.toThrow();
  });

  it("rejects an achievement row without an id", async () => {
    mockTables.set("achievement_unlocks", { data: [{ unlocked_at: "2026-11-01T00:00:00Z" }], error: null });

    await expect(fetchPublicAchievementUnlocks(USER)).rejects.toThrow();
  });

  it("rejects a streak row without a date", async () => {
    mockTables.set("daily_scores", { data: [{ user_id: USER, profiles: null }], error: null });

    await expect(fetchStreakLeaderboard()).rejects.toThrow();
  });

  it("keeps the null fallbacks for valid rows", async () => {
    mockTables.set("public_review_activity", { data: [{ date: "2026-11-02", reviews_count: null }], error: null });
    mockTables.set("public_review_stats", {
      data: { total_reviews: 4, active_days: null, current_streak: 1, longest_streak: null, last_review_date: null },
      error: null,
    });
    mockTables.set("daily_scores", { data: [{ date: "2026-11-02", reviews_count: 2 }], error: null });

    await expect(fetchPublicReviewActivity(USER, 7)).resolves.toMatchObject({ totalReviews: 4 });
    mockTables.set("public_surah_progress", {
      data: [{ surah: 2, total_cards: null, memorized_cards: 1 }],
      error: null,
    });
    await expect(fetchPublicSurahProgress(USER)).resolves.toEqual([{ surah: 2, totalCards: 0, memorized: 1 }]);
  });
});
