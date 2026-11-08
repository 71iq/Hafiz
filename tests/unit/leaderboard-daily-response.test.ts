import * as fc from "fast-check";
import { fetchDailyLeaderboard } from "@/lib/leaderboard/api";

let mockData: unknown = [];
let mockError: { message: string } | null = null;
let mockConfigured = true;
const mockSelect = jest.fn().mockReturnThis();
const mockEq = jest.fn().mockReturnThis();
const mockOrder = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockReturnThis();
const mockFrom = jest.fn((table: string) => {
  if (table !== "daily_scores") throw new Error(`Unexpected table ${table}`);
  return Object.assign(Promise.resolve({ data: mockData, error: mockError }), {
    select: mockSelect,
    eq: mockEq,
    order: mockOrder,
    limit: mockLimit,
  });
});
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabase: { from: (table: string) => mockFrom(table) },
}));
const entry = (id: string, score: number, rank: number, username = "unknown") => ({
  user_id: id,
  username,
  display_name: null,
  avatar_url: null,
  score,
  rank,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-03T23:30:00Z"));
  jest.clearAllMocks();
  mockData = [];
  mockError = null;
  mockConfigured = true;
});
afterEach(() => jest.useRealTimers());

it("preserves returned order and per-row ranks without grouping or sorting nullable rows", async () => {
  mockData = [
    { user_id: "a", score: null },
    { user_id: "a", score: -1, profiles: { username: "second" } },
    { user_id: "b", score: 100 },
  ];
  const rows = await fetchDailyLeaderboard();
  expect(rows).toEqual([entry("a", 0, 1), entry("a", -1, 2, "second"), entry("b", 100, 3)]);
  expect(rows[0].score.toLocaleString("en")).toBe("0");
});

it("keeps UTC date, exact selection, descending server order and limit50", async () => {
  await fetchDailyLeaderboard();
  expect(mockFrom).toHaveBeenCalledTimes(1);
  expect(mockSelect).toHaveBeenCalledWith(
    "user_id, score, profiles:profiles!daily_scores_user_id_fkey(username, display_name, avatar_url)",
  );
  expect(mockEq).toHaveBeenCalledWith("date", "2026-11-03");
  expect(mockOrder).toHaveBeenCalledWith("score", { ascending: false });
  expect(mockLimit).toHaveBeenCalledWith(50);
});

it("does not add a client-side limit when the synthetic server supplies extra rows", async () => {
  mockData = Array.from({ length: 55 }, (_, i) => ({ user_id: String(i), score: i }));
  const rows = await fetchDailyLeaderboard();
  expect(rows).toHaveLength(55);
  expect(rows[0]).toEqual(entry("0", 0, 1));
  expect(rows[54]).toEqual(entry("54", 54, 55));
});

it("preserves empty text, fractional scores and row-specific profile metadata", async () => {
  mockData = [{ user_id: "", score: 1.5, profiles: { username: "", display_name: "", avatar_url: "", extra: 1 } }];
  await expect(fetchDailyLeaderboard()).resolves.toEqual([
    { user_id: "", username: "", display_name: "", avatar_url: "", score: 1.5, rank: 1 },
  ]);
});

it("keeps missing/null profile and field fallbacks", async () => {
  mockData = [
    { user_id: "a", score: 1, profiles: null },
    { user_id: "b", score: 2, profiles: { username: null } },
  ];
  await expect(fetchDailyLeaderboard()).resolves.toEqual([entry("a", 1, 1), entry("b", 2, 2)]);
});

it.each([null, undefined])("returns empty for absent data %j", async (data) => {
  mockData = data;
  await expect(fetchDailyLeaderboard()).resolves.toEqual([]);
});

it("does not call the client when unconfigured", async () => {
  mockConfigured = false;
  mockData = [null];
  await expect(fetchDailyLeaderboard()).resolves.toEqual([]);
  expect(mockFrom).not.toHaveBeenCalled();
});

it("propagates service errors by identity before validating data", async () => {
  mockData = [null];
  mockError = { message: "offline" };
  await expect(fetchDailyLeaderboard()).rejects.toBe(mockError);
});

it("does not mutate frozen rows or profiles", async () => {
  const profile = Object.freeze({ username: "fixed" });
  const row = Object.freeze({ user_id: "a", score: null, profiles: profile });
  const rows = [row];
  Object.freeze(rows);
  mockData = rows;
  await expect(fetchDailyLeaderboard()).resolves.toEqual([entry("a", 0, 1, "fixed")]);
  expect(row.score).toBeNull();
  expect(rows[0]).toBe(row);
  expect(row.profiles).toBe(profile);
});

it.each<unknown>([
  {},
  [null],
  [{ score: 1 }],
  [{ user_id: 1, score: 2 }],
  [{ user_id: "a" }],
  [{ user_id: "a", score: "2" }],
  [{ user_id: "a", score: NaN }],
  [{ user_id: "a", score: Infinity }],
  [{ user_id: "a", score: 1, profiles: [] }],
  [{ user_id: "a", score: 1, profiles: { avatar_url: 1 } }],
])("rejects malformed response %j without partial rows", async (data) => {
  mockData = data;
  await expect(fetchDailyLeaderboard()).rejects.toThrow();
});

it("maps arbitrary valid response rows independently with numeric scores and unchanged order", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          user_id: fc.constantFrom("a", "b", "c"),
          score: fc.option(fc.integer({ min: -100, max: 100 }), { nil: null }),
        }),
        { maxLength: 80 },
      ),
      async (data) => {
        mockData = data;
        const original = data.map((row) => ({ ...row }));
        expect(await fetchDailyLeaderboard()).toEqual(data.map((row, i) => entry(row.user_id, row.score ?? 0, i + 1)));
        expect(data).toEqual(original);
      },
    ),
    { seed: 12101, numRuns: 500 },
  );
});
