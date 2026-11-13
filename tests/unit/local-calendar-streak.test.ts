import { DatabaseSync } from "node:sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import { dayIndexFromLocalDateKey, dayIndexFromUtcDateKey } from "@/lib/date";
import { getReviewStats } from "@/lib/fsrs/queries";

// Review stats never read the network; the public streak board and daily_scores were retired. The wird
// streak itself lives in lib/habit and is tested in habit-core and habit-wird-progress.
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    from: (table: string) => {
      throw new Error(`Unexpected table ${table}`);
    },
  },
}));
jest.mock("@/lib/database/sync-queue", () => ({ enqueueSync: jest.fn(async () => undefined) }));

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe("local calendar ordinals", () => {
  it.each([
    ["1970-01-01", 0],
    ["1970-01-02", 1],
    ["1969-12-31", -1],
    ["2026-01-01", 20454],
    ["2024-02-29", 19782],
  ])("uses calendar ordinal %s = %s", (key, index) => {
    expect(dayIndexFromLocalDateKey(String(key))).toBe(index);
  });

  it("retains local constructor defaults, rollover, short-year and invalid normalization", () => {
    expect(dayIndexFromLocalDateKey("2026-0-0")).toBe(20454);
    expect(dayIndexFromLocalDateKey("2026-02-30")).toBe(dayIndexFromUtcDateKey("2026-03-02"));
    expect(dayIndexFromLocalDateKey("99-1-1")).toBe(dayIndexFromUtcDateKey("1999-01-01"));
    expect(dayIndexFromLocalDateKey("0-1-1")).toBe(dayIndexFromUtcDateKey("1900-01-01"));
    expect(dayIndexFromLocalDateKey("invalid")).toBeNaN();
    expect(dayIndexFromLocalDateKey("Infinity-1-1")).toBeNaN();
  });

  it("does not remap a normalized year below 100 into the 1900s", () => {
    expect(dayIndexFromLocalDateKey("100-1-0.1")).toBe(-683004);
    expect(dayIndexFromLocalDateKey("100-1-1")).toBe(-683003);
    expect(dayIndexFromLocalDateKey("99-12-31")).toBe(10956);
  });

  it("preserves skipped-date normalization while remote UTC parsing stays distinct", () => {
    const expected = zone === "Pacific/Apia" ? "2011-12-31" : "2011-12-30";
    expect(dayIndexFromLocalDateKey("2011-12-30")).toBe(dayIndexFromUtcDateKey(expected));
    expect(dayIndexFromUtcDateKey("2011-12-30")).toBe(15338);
  });
});

describe.each([
  { dates: ["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"] },
  { dates: ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"] },
])("review stats across daylight saving for $dates", ({ dates }) => {
  let sql: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(`${dates[3]}T12:00:00`));
    sql = new DatabaseSync(":memory:");
    sql.exec("CREATE TABLE study_log (reviewed_at TEXT NOT NULL)");
    const adapter = {
      getAllAsync: async (query: string) => sql.prepare(query).all(),
    };
    // Match the established Node SQLite fixture pattern. Only getAllAsync is
    // implemented; an unexpected native method fails instead of being faked.
    db = adapter as unknown as SQLiteDatabase;
  });

  afterEach(() => {
    sql.close();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function insert(keys: string[]) {
    const statement = sql.prepare("INSERT INTO study_log (reviewed_at) VALUES (?)");
    for (const key of keys) statement.run(`${key}T12:00:00`);
  }

  it("keeps actual SQLite review stats at four consecutive days, ignoring duplicate and invalid rows", async () => {
    insert([...dates, dates[0]]);
    sql.prepare("INSERT INTO study_log VALUES (?)").run("invalid");
    await expect(getReviewStats(db, 4)).resolves.toEqual({
      activity: dates.map((date, i) => ({ date, count: i === 0 ? 2 : 1 })),
      activeDays: 4,
      totalReviews: 5,
      averageDailyReviews: 1,
      longestStreak: 4,
    });
    expect(sql.prepare("SELECT COUNT(*) AS count FROM study_log").get()).toEqual({ count: 6 });
  });
});
