import { isMissingPublicReviewAggregateError } from "@/lib/leaderboard/errors";
import { fetchPublicReviewActivity } from "@/lib/leaderboard/api";

type AggregateError = NonNullable<Parameters<typeof isMissingPublicReviewAggregateError>[0]>;
type Response = { data: unknown; error: AggregateError | null };
const mockResponses: Record<string, Response> = {};
const mockFrom = jest.fn((table: string) => {
  const response = mockResponses[table];
  if (!response) throw new Error(`Unexpected table ${table}`);
  return Object.assign(Promise.resolve(response), {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockReturnThis(),
  });
});
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { from: (table: string) => mockFrom(table) },
}));

const tables = ["public_review_activity", "public_review_stats"];
const reasons = ["does not exist", "schema cache", "PGRST205", "42P01"];

describe("missing public review aggregate classification", () => {
  it.each(tables.flatMap((table) => reasons.map((reason) => ({ table, reason }))))(
    "recognizes $table with $reason across fields and case",
    ({ table, reason }) => {
      expect(isMissingPublicReviewAggregateError({ code: reason, details: table })).toBe(true);
      expect(isMissingPublicReviewAggregateError({ message: `${table.toUpperCase()} ${reason.toUpperCase()}` })).toBe(
        true,
      );
      expect(isMissingPublicReviewAggregateError({ code: table, message: reason })).toBe(true);
    },
  );

  it.each<AggregateError | null>([
    null,
    {},
    { code: "", message: "", details: "" },
    { message: "public_review_activity" },
    { details: "public_review_stats" },
    { code: "PGRST205" },
    { code: "42P01" },
    { message: "profiles does not exist" },
    { message: "daily_scores schema cache", code: "PGRST205" },
    { message: "permission denied for public_review_stats", code: "42501" },
    { message: "public_review_activity connection failed", code: "08006" },
    { message: "public_review_stats timeout", code: "57014" },
    { message: "public_review_stats unique violation", code: "23505" },
    { message: "PUBLIC_REVIEW_ACTIVITY", details: "schema-cache" },
    { message: "public_review_stat does not exist" },
  ])("rejects unrelated or incomplete evidence %j", (error) => {
    expect(isMissingPublicReviewAggregateError(error)).toBe(false);
  });

  it("retains substring compatibility rather than imposing exact codes or table tokens", () => {
    expect(
      isMissingPublicReviewAggregateError({ details: "prefix_public_review_stats_suffix", code: "prefix42P01suffix" }),
    ).toBe(true);
  });

  it("does not modify a frozen error", () => {
    const error = Object.freeze({ code: "42P01", message: "public_review_stats does not exist" });
    expect(isMissingPublicReviewAggregateError(error)).toBe(true);
    expect(error).toEqual({ code: "42P01", message: "public_review_stats does not exist" });
  });
});

describe("actual public activity caller fallback", () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockResponses.public_review_stats = { data: null, error: null };
    mockResponses.public_review_activity = { data: [], error: null };
    mockResponses.daily_scores = { data: [{ date: "2026-01-02", reviews_count: 4 }], error: null };
  });

  it.each(tables)("retains daily-score activity when %s is unavailable", async (table) => {
    mockResponses[table] = { data: null, error: { code: "PGRST205", message: `${table} schema cache` } };
    await expect(fetchPublicReviewActivity("synthetic-user", 7)).resolves.toEqual({
      activity: [{ date: "2026-01-02", count: 4 }],
      activeDays: 1,
      totalReviews: 4,
    });
    expect(mockFrom.mock.calls.map(([name]) => name)).toEqual([
      "public_review_stats",
      "public_review_activity",
      "daily_scores",
    ]);
  });

  it.each(tables)("propagates unrelated %s errors by identity", async (table) => {
    const error = { code: "42501", message: `permission denied for ${table}` };
    mockResponses[table] = { data: null, error };
    await expect(fetchPublicReviewActivity("synthetic-user")).rejects.toBe(error);
  });

  it("preserves the larger successful aggregate", async () => {
    mockResponses.public_review_activity = { data: [{ date: "2026-01-03", reviews_count: 9 }], error: null };
    await expect(fetchPublicReviewActivity("synthetic-user")).resolves.toEqual({
      activity: [{ date: "2026-01-03", count: 9 }],
      activeDays: 1,
      totalReviews: 9,
    });
  });

  it("does not swallow a daily-score failure even when aggregate tables are missing", async () => {
    const error = { code: "08006", message: "daily_scores disconnected" };
    mockResponses.public_review_stats = { data: null, error: { code: "42P01", message: "public_review_stats" } };
    mockResponses.daily_scores = { data: null, error };
    await expect(fetchPublicReviewActivity("synthetic-user")).rejects.toBe(error);
  });
});
