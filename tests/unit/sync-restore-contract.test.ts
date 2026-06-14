import fs from "fs";
import path from "path";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  const exportStart = source.indexOf(`export async function ${name}`);
  const functionStart = start >= 0 ? start : exportStart;
  expect(functionStart).toBeGreaterThanOrEqual(0);

  const braceStart = source.indexOf("{\n", functionStart);
  expect(braceStart).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(braceStart, i + 1);
  }
  throw new Error(`Could not parse function body for ${name}`);
}

describe("account sync restore contract", () => {
  it("restores account data before pushing any local queue entries", () => {
    const source = read("lib/database/sync.ts");
    const body = functionBody(source, "fullSync");

    expect(body.indexOf("restoreAccountDataIfNeeded")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("pushSyncQueue")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("restoreAccountDataIfNeeded")).toBeLessThan(body.indexOf("pushSyncQueue"));
  });

  it("fetches remote rows before clearing local synced tables", () => {
    const source = read("lib/database/sync.ts");
    const body = functionBody(source, "restoreAccountDataIfNeeded");

    expect(body.indexOf("fetchRemoteAccountRows")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("clearLocalSyncableData")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("fetchRemoteAccountRows")).toBeLessThan(body.indexOf("clearLocalSyncableData"));
  });

  it("clears stale local sync queues and all synced user tables during account replacement", () => {
    const source = read("lib/database/sync.ts");
    const body = functionBody(source, "clearLocalSyncableData");

    for (const table of [
      "study_cards",
      "study_log",
      "bookmarks",
      "highlights",
      "private_notes",
      "reflection_journey_entries",
      "achievement_unlocks",
      "user_word_meanings",
      "sync_queue",
      "qf_sync_queue",
    ]) {
      expect(body).toContain(`DELETE FROM ${table}`);
    }
  });

  it("does not let leaderboard aggregates write before account restore is complete", () => {
    const source = read("lib/fsrs/leaderboard-sync.ts");
    const syncDailyScore = functionBody(source, "syncDailyScore");
    const updateProfileStats = functionBody(source, "updateProfileStats");

    expect(syncDailyScore.indexOf("canWriteAccountDerivedStats")).toBeLessThan(syncDailyScore.indexOf("getTodayScore"));
    expect(updateProfileStats.indexOf("canWriteAccountDerivedStats")).toBeLessThan(updateProfileStats.indexOf("getTotalScore"));
  });

  it("keeps public aggregate progress monotonic when local SQLite has fewer rows", () => {
    const source = read("lib/fsrs/leaderboard-sync.ts");
    const syncDailyScore = functionBody(source, "syncDailyScore");
    const updateProfileStats = functionBody(source, "updateProfileStats");

    expect(syncDailyScore).toContain("Math.max(score, existing?.score ?? 0)");
    expect(syncDailyScore).toContain("Math.max(reviewsCount, existing?.reviews_count ?? 0)");
    expect(updateProfileStats).toContain("fetchDailyScoreSummary");
    expect(updateProfileStats).toContain("Math.max(totalScore, remoteDailySummary.totalScore, profile?.total_score ?? 0)");
    expect(updateProfileStats).toContain("Math.max(localReviewedCount, remoteDailySummary.cardsReviewed, profile?.cards_reviewed ?? 0)");
  });

  it("uses account-backed public activity as the owner profile fallback", () => {
    const source = read("components/profile/ProfileModalContent.tsx");

    expect(source).toContain("chooseRicherReview(localReview, remoteReview)");
    expect(source).toContain("chooseRicherSurahProgress(localSurahProgress, remoteSurahProgress)");
    expect(source.match(/enabled: !!requestedUserId && !isSignedOutOwnProfile/g)).toHaveLength(2);
  });
});
