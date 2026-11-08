import * as fc from "fast-check";
import { rankDailyScores } from "@/lib/leaderboard/ranking";
import { fetchWeeklyLeaderboard, fetchAllTimeLeaderboard } from "@/lib/leaderboard/api";

let mockData: unknown = [];
let mockError: { message: string } | null = null;
let mockConfigured = true;
const mockGte = jest.fn().mockReturnThis();
const mockOrder = jest.fn().mockReturnThis();
const mockSelect = jest.fn().mockReturnThis();
const mockFrom = jest.fn((table: string) => {
  if (table !== "daily_scores") throw new Error(`Unexpected table ${table}`);
  return Object.assign(Promise.resolve({ data: mockData, error: mockError }), {
    select: mockSelect,
    gte: mockGte,
    order: mockOrder,
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

describe("validated daily-score ranking", () => {
  it("keeps empty results", () => expect(rankDailyScores({ rows: [] })).toEqual([]));

  it("sums in input order, preserves first metadata and stable total-score ties", () => {
    expect(
      rankDailyScores({
        rows: [
          { user_id: "b", score: 3, profiles: { username: "first", display_name: "B", avatar_url: "avatar" } },
          { user_id: "a", score: 5, profiles: null },
          { user_id: "b", score: 2, profiles: { username: "later" } },
          { user_id: "c", score: -1 },
        ],
      }),
    ).toEqual([
      { ...entry("b", 5, 1, "first"), display_name: "B", avatar_url: "avatar" },
      entry("a", 5, 2),
      entry("c", -1, 3),
    ]);
  });

  it("keeps empty profile text, missing profile defaults and extra-field compatibility", () => {
    expect(
      rankDailyScores({
        rows: [
          {
            user_id: "",
            score: 1.5,
            ignored: true,
            profiles: { username: "", display_name: "", avatar_url: "", extra: 1 },
          },
        ],
      }),
    ).toEqual([{ user_id: "", username: "", display_name: "", avatar_url: "", score: 1.5, rank: 1 }]);
  });

  it("normalizes a permitted null score to a numeric renderable zero", () => {
    const rows = rankDailyScores({ rows: [{ user_id: "null", score: null }] });
    expect(rows).toEqual([entry("null", 0, 1)]);
    expect(rows[0].score.toLocaleString("en")).toBe("0");
  });

  it("keeps nullable mixed totals, fractional arithmetic and first missing metadata", () => {
    expect(
      rankDailyScores({
        rows: [
          { user_id: "a", score: null },
          { user_id: "a", score: 0.1, profiles: { username: "later" } },
          { user_id: "a", score: 0.2 },
          { user_id: "b", score: null },
          { user_id: "b", score: null },
        ],
      }),
    ).toEqual([entry("a", 0.30000000000000004, 1), entry("b", 0, 2)]);
  });

  it("limits after aggregation and sorting, with consecutive ranks", () => {
    const rows = Array.from({ length: 55 }, (_, i) => ({ user_id: `u${i}`, score: i }));
    rows.push({ user_id: "u0", score: 100 });
    const result = rankDailyScores({ rows });
    expect(result).toHaveLength(50);
    expect(result[0]).toEqual(entry("u0", 100, 1));
    expect(result[49]).toEqual(entry("u6", 6, 50));
    expect(result.some((row) => row.user_id === "u5")).toBe(false);
  });

  it("does not mutate frozen input rows or profiles", () => {
    const profile = Object.freeze({ username: "fixed" });
    const row = Object.freeze({ user_id: "a", score: 2, profiles: profile });
    const rows = [row, row];
    Object.freeze(rows);
    expect(rankDailyScores({ rows })).toEqual([entry("a", 4, 1, "fixed")]);
    expect(rows).toEqual([row, row]);
    expect(row.score).toBe(2);
  });

  it.each<unknown>([
    null,
    {},
    [null],
    [{ score: 1 }],
    [{ user_id: 1, score: 2 }],
    [{ user_id: "a" }],
    [{ user_id: "a", score: "2" }],
    [{ user_id: "a", score: NaN }],
    [{ user_id: "a", score: Infinity }],
    [{ user_id: "a", score: 1, profiles: [] }],
    [{ user_id: "a", score: 1, profiles: { username: 7 } }],
  ])("rejects malformed boundary data %j", (rows) => {
    expect(() => rankDailyScores({ rows })).toThrow();
  });

  it("matches an independent grouping oracle over arbitrary repeated users and nullable scores", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            user_id: fc.constantFrom("a", "b", "c", "d"),
            score: fc.option(fc.integer({ min: -20, max: 100 }), { nil: null }),
          }),
          { maxLength: 100 },
        ),
        (rows) => {
          const ids = [...new Set(rows.map((row) => row.user_id))];
          const expected = ids
            .map((id) => ({
              id,
              score: rows.filter((row) => row.user_id === id).reduce((sum, row) => sum + (row.score ?? 0), 0),
            }))
            .sort((a, b) => b.score - a.score)
            .map((row, i) => entry(row.id, row.score, i + 1));
          expect(rankDailyScores({ rows })).toEqual(expected);
        },
      ),
      { seed: 6501, numRuns: 500 },
    );
  });
});

describe.each([fetchWeeklyLeaderboard, fetchAllTimeLeaderboard])("actual service %p", (fetchBoard) => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    jest.clearAllMocks();
    mockConfigured = true;
    mockError = null;
    mockData = [];
  });
  afterEach(() => jest.useRealTimers());

  it("keeps remote query selection/order and distinct weekly filter", async () => {
    mockData = [
      { user_id: "a", score: 2 },
      { user_id: "a", score: 3 },
    ];
    await expect(fetchBoard()).resolves.toEqual([entry("a", 5, 1)]);
    expect(mockSelect).toHaveBeenCalledWith(
      "user_id, score, profiles:profiles!daily_scores_user_id_fkey(username, display_name, avatar_url)",
    );
    expect(mockOrder).toHaveBeenCalledWith("score", { ascending: false });
    if (fetchBoard === fetchWeeklyLeaderboard) expect(mockGte).toHaveBeenCalledWith("date", "2026-10-27");
    else expect(mockGte).not.toHaveBeenCalled();
  });
  it("returns empty for null data", async () => {
    mockData = null;
    await expect(fetchBoard()).resolves.toEqual([]);
  });
  it("returns empty without client calls when unconfigured", async () => {
    mockConfigured = false;
    await expect(fetchBoard()).resolves.toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
  it("preserves remote error identity before parsing data", async () => {
    mockData = [null];
    mockError = { message: "offline" };
    await expect(fetchBoard()).rejects.toBe(mockError);
  });
  it("normalizes null scores through the actual service and UI number contract", async () => {
    mockData = [{ user_id: "a", score: null }];
    const rows = await fetchBoard();
    expect(rows).toEqual([entry("a", 0, 1)]);
    expect(rows[0].score.toLocaleString("en")).toBe("0");
  });
  it("rejects malformed remote scores without a partial ranking", async () => {
    mockData = [
      { user_id: "valid", score: 2 },
      { user_id: "bad", score: "3" },
    ];
    await expect(fetchBoard()).rejects.toThrow();
  });
});
