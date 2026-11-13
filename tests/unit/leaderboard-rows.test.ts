import { fetchPublicAchievementUnlocks, fetchPublicProfile, fetchPublicSurahProgress } from "@/lib/leaderboard/api";

const mockTables = new Map<string, { data: unknown; error: unknown }>();
const mockSelections: Array<{ table: string; columns: string }> = [];
function mockQuery(table: string) {
  const result = mockTables.get(table) ?? { data: [], error: null };
  const query = Object.assign(Promise.resolve(result), {
    maybeSingle: () => Promise.resolve(result),
    select: (columns: string) => {
      mockSelections.push({ table, columns });
      return query;
    },
    eq: () => query,
    order: () => query,
  });
  return query;
}
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { from: (table: string) => mockQuery(table) },
}));

const USER = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  mockTables.clear();
  mockSelections.length = 0;
});
afterEach(() => jest.restoreAllMocks());

describe("RF-191 public profile rows are validated", () => {
  it("reads identity only, never totals or streaks the server no longer publishes", async () => {
    mockTables.set("profiles", {
      data: { id: USER, username: "amina", display_name: null, avatar_url: null, bio: "Hi", country: null },
      error: null,
    });

    await expect(fetchPublicProfile(USER)).resolves.toEqual({
      id: USER,
      username: "amina",
      display_name: null,
      avatar_url: null,
      bio: "Hi",
      country: null,
    });
    expect(mockSelections).toEqual([{ table: "profiles", columns: "id, username, display_name, avatar_url, bio, country" }]);
  });

  it("falls back to the identity columns when bio and country are missing from the server", async () => {
    let calls = 0;
    mockTables.set("profiles", { data: null, error: { code: "PGRST204", message: "column profiles.bio does not exist" } });
    const fallback = { data: { id: USER, username: "amina", display_name: "A", avatar_url: null }, error: null };
    const original = mockTables.get.bind(mockTables);
    jest.spyOn(mockTables, "get").mockImplementation((table) => (table === "profiles" && calls++ > 0 ? fallback : original(table)));

    await expect(fetchPublicProfile(USER)).resolves.toEqual({
      id: USER,
      username: "amina",
      display_name: "A",
      avatar_url: null,
      bio: null,
      country: null,
    });
  });

  it("rejects a profile whose username is not text", async () => {
    mockTables.set("profiles", { data: { id: USER, username: 7 }, error: null });

    await expect(fetchPublicProfile(USER)).rejects.toThrow();
  });

  it("rejects a surah progress row without a numeric surah", async () => {
    mockTables.set("public_surah_progress", { data: [{ surah: "2", total_cards: 3 }], error: null });

    await expect(fetchPublicSurahProgress(USER)).rejects.toThrow();
  });

  it("rejects an achievement row without an id", async () => {
    mockTables.set("achievement_unlocks", { data: [{ unlocked_at: "2026-11-01T00:00:00Z" }], error: null });

    await expect(fetchPublicAchievementUnlocks(USER)).rejects.toThrow();
  });

  it("keeps the null fallbacks for valid rows", async () => {
    mockTables.set("public_surah_progress", {
      data: [{ surah: 2, total_cards: null, memorized_cards: 1 }],
      error: null,
    });
    await expect(fetchPublicSurahProgress(USER)).resolves.toEqual([{ surah: 2, totalCards: 0, memorized: 1 }]);
  });
});
