import { fetchPublicProfile, fetchPublicReviewActivity, fetchStreakLeaderboard } from "@/lib/leaderboard/api";

type Row = Record<string, unknown>;
type Result = { data: Row | Row[] | null; error: { code: string; message: string } | null };
const USER = "synthetic-public-user";
let mockProfile: Row;
let mockStats: Row | null;
let mockDaily: Row[] = [];
let mockActivity: Row[] = [];
let mockAggregateMissing = false;
const mockRequests: { table: string; lowerBound?: string }[] = [];
class PublicQuery implements PromiseLike<Result> {
  private filters: [string, unknown][] = [];
  private lowerBound: string | undefined;
  private ascending = true;
  constructor(private readonly table: string) {}
  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  gte(column: string, value: string) {
    if (column !== "date") throw new Error("Unexpected synthetic range column");
    this.lowerBound = value;
    return this;
  }
  order(column: string, options: { ascending: boolean }) {
    if (column !== "date") throw new Error("Unexpected synthetic order column");
    this.ascending = options.ascending;
    return this;
  }
  maybeSingle() {
    return this.execute(true);
  }
  then: Promise<Result>["then"] = (resolve, reject) => this.execute(false).then(resolve, reject);
  private async execute(single: boolean): Promise<Result> {
    mockRequests.push({ table: this.table, lowerBound: this.lowerBound });
    if (mockAggregateMissing && ["public_review_stats", "public_review_activity"].includes(this.table)) {
      return { data: null, error: { code: "42P01", message: "relation public_review_stats does not exist" } };
    }
    const source =
      this.table === "profiles"
        ? [mockProfile]
        : this.table === "public_review_stats"
          ? mockStats
            ? [mockStats]
            : []
          : this.table === "daily_scores"
            ? mockDaily
            : this.table === "public_review_activity"
              ? mockActivity
              : null;
    if (!source) throw new Error("Unexpected synthetic table " + this.table);
    const rows = source
      .filter((row) => this.filters.every(([column, value]) => row[column] === value))
      .filter((row) => this.lowerBound === undefined || (typeof row.date === "string" && row.date >= this.lowerBound))
      .map((row) => ({ ...row }));
    rows.sort((a, b) =>
      typeof a.date === "string" && typeof b.date === "string"
        ? a.date.localeCompare(b.date) * (this.ascending ? 1 : -1)
        : 0,
    );
    return { data: single ? (rows[0] ?? null) : rows, error: null };
  }
}
const mockFrom = (table: string) => new PublicQuery(table);
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { from: (table: string) => mockFrom(table) },
}));
const boundaries = [
  { instant: "2026-11-03T22:30:00.000Z", today: "2026-11-03", yesterday: "2026-11-02" },
  { instant: "2026-11-04T04:30:00.000Z", today: "2026-11-04", yesterday: "2026-11-03" },
];
beforeEach(() => {
  jest.useFakeTimers();
  mockProfile = {
    id: USER,
    username: "synthetic",
    display_name: null,
    avatar_url: null,
    bio: null,
    country: null,
    total_score: 0,
    current_streak: 0,
    longest_streak: 0,
    cards_reviewed: 0,
    last_review_date: null,
  };
  mockStats = null;
  mockDaily = [];
  mockActivity = [];
  mockAggregateMissing = false;
  mockRequests.length = 0;
});
afterEach(() => jest.useRealTimers());

it.each(boundaries.flatMap((boundary) => ["profile", "aggregate", "daily"].map((source) => ({ ...boundary, source }))))(
  "keeps UTC public streaks at $instant from $source",
  async ({ instant, today, yesterday, source }) => {
    jest.setSystemTime(new Date(instant));
    const expected = source === "profile" ? 7 : source === "aggregate" ? 4 : 2;
    if (source === "profile")
      mockProfile = { ...mockProfile, current_streak: 7, longest_streak: 9, last_review_date: today };
    if (source === "aggregate")
      mockStats = {
        user_id: USER,
        total_reviews: 10,
        active_days: 4,
        current_streak: 4,
        longest_streak: 6,
        last_review_date: today,
      };
    if (source === "daily")
      mockDaily = [
        { user_id: USER, date: yesterday, reviews_count: 1, score: 2 },
        { user_id: USER, date: today, reviews_count: 1, score: 3 },
        { user_id: USER, date: today, reviews_count: 1, score: 4 },
      ];
    await expect(fetchPublicProfile(USER)).resolves.toMatchObject({
      current_streak: expected,
      last_review_date: today,
    });
    if (source === "daily")
      await expect(fetchPublicProfile(USER)).resolves.toMatchObject({
        total_score: 9,
        cards_reviewed: 3,
        current_streak: 2,
        longest_streak: 2,
      });
  },
);
it.each(boundaries)("expires a prior UTC day at $instant", async ({ instant, yesterday }) => {
  jest.setSystemTime(new Date(instant));
  mockProfile = { ...mockProfile, current_streak: 7, longest_streak: 9, last_review_date: yesterday };
  mockStats = { user_id: USER, current_streak: 8, longest_streak: 10, last_review_date: yesterday };
  await expect(fetchPublicProfile(USER)).resolves.toMatchObject({ current_streak: 0, longest_streak: 10 });
});
it.each(boundaries)(
  "ranks UTC streaks with duplicate days and stable ties at $instant",
  async ({ instant, today, yesterday }) => {
    jest.setSystemTime(new Date(instant));
    const row = (user_id: string, date: string) => ({
      user_id,
      date,
      profiles: user_id === "missing" ? null : { username: user_id, display_name: null, avatar_url: null },
    });
    mockDaily = [
      row("first", today),
      row("second", today),
      row("missing", today),
      row("first", yesterday),
      row("second", yesterday),
      row("first", today),
      row("expired", yesterday),
    ];
    const result = await fetchStreakLeaderboard();
    expect(result.map(({ user_id, score, rank }) => ({ user_id, score, rank }))).toEqual([
      { user_id: "first", score: 2, rank: 1 },
      { user_id: "second", score: 2, rank: 2 },
      { user_id: "missing", score: 1, rank: 3 },
      { user_id: "expired", score: 0, rank: 4 },
    ]);
    expect(result[2].username).toBe("unknown");
  },
);
it.each(
  [
    { days: 1, expectedDates: ["2026-03-08"], total: 3, start: "2026-03-08" },
    {
      days: 90,
      expectedDates: ["2025-12-09", "2026-02-10", "2026-03-07", "2026-03-08"],
      total: 10,
      start: "2025-12-09",
    },
    {
      days: undefined,
      expectedDates: ["2025-12-09", "2026-02-10", "2026-03-07", "2026-03-08"],
      total: 10,
      start: "2025-12-09",
    },
  ].flatMap((window) => [false, true].map((missing) => ({ ...window, missing }))),
)(
  "filters UTC activity window days=$days with missing aggregates=$missing",
  async ({ days, expectedDates, total, start, missing }) => {
    jest.setSystemTime(new Date("2026-03-08T04:30:00.000Z"));
    mockAggregateMissing = missing;
    mockDaily = [
      { user_id: USER, date: "2025-12-08", reviews_count: 100 },
      { user_id: USER, date: "2025-12-09", reviews_count: 2 },
      { user_id: USER, date: "2026-02-10", reviews_count: 1 },
      { user_id: USER, date: "2026-03-07", reviews_count: 4 },
      { user_id: USER, date: "2026-03-08", reviews_count: 3 },
    ];
    mockActivity = mockDaily.map((row) => ({ ...row }));
    const result = await fetchPublicReviewActivity(USER, days);
    expect(result.activity.filter((row) => row.count > 0).map((row) => row.date)).toEqual(expectedDates);
    expect(result.totalReviews).toBe(total);
    expect(result.activeDays).toBe(expectedDates.length);
    expect(
      mockRequests.filter((request) => ["daily_scores", "public_review_activity"].includes(request.table)),
    ).toEqual(
      expect.arrayContaining([
        { table: "daily_scores", lowerBound: start },
        { table: "public_review_activity", lowerBound: start },
      ]),
    );
  },
);
