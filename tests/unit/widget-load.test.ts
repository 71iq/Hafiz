import type { AppDatabase } from "@/lib/database/types";
import type { HabitDayRow } from "@/lib/habit/types";
import { todayFinishedAt } from "@/lib/widget/load";

const TODAY = "2026-11-23";

function row(overrides: Partial<HabitDayRow>): HabitDayRow {
  return {
    local_date: TODAY,
    status: "done",
    earned_status: "done",
    reason: null,
    excuse_updated_at: null,
    minimum_met: 1,
    full_met: 0,
    manzil_cycle_completed: 0,
    source_session_id: "session-1",
    credited_through: null,
    tz: "Asia/Riyadh",
    created_at: "2026-11-23T18:40:00.000Z",
    updated_at: "2026-11-23T19:10:00.000Z",
    ...overrides,
  };
}

/** Answers today's habit row and the review session by id, as the local database would. */
function database(day: HabitDayRow | null, sessionUpdatedAt: string | null = null): AppDatabase {
  return {
    getFirstAsync: async (sql: string, params: readonly unknown[]) => {
      if (sql.includes("FROM habit_days")) return params[0] === TODAY ? day : null;
      if (sql.includes("FROM review_sessions")) {
        return params[0] === day?.source_session_id && sessionUpdatedAt ? { updated_at: sessionUpdatedAt } : null;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as AppDatabase;
}

describe("todayFinishedAt", () => {
  it("reads when today's wird was done from the row the finish created", async () => {
    await expect(todayFinishedAt(database(row({})), TODAY)).resolves.toEqual(new Date("2026-11-23T18:40:00.000Z"));
  });

  it("asks the earning session when an excuse created the row first", async () => {
    const excused = row({ excuse_updated_at: "2026-11-23T05:00:00.000Z", created_at: "2026-11-23T05:00:00.000Z" });
    await expect(todayFinishedAt(database(excused, "2026-11-23T20:15:00.000Z"), TODAY)).resolves.toEqual(
      new Date("2026-11-23T20:15:00.000Z"),
    );
    await expect(todayFinishedAt(database(excused), TODAY)).resolves.toBeNull();
    await expect(todayFinishedAt(database({ ...excused, source_session_id: null }), TODAY)).resolves.toBeNull();
  });

  it("knows no finish while today is not done", async () => {
    await expect(todayFinishedAt(database(null), TODAY)).resolves.toBeNull();
    const excusedOnly = row({ status: "excused", earned_status: null, reason: "travel" });
    await expect(todayFinishedAt(database(excusedOnly), TODAY)).resolves.toBeNull();
  });
});
