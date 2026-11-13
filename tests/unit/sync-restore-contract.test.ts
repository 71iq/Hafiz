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

  it("does not repair server surah progress before account restore is complete", () => {
    const source = read("lib/fsrs/leaderboard-sync.ts");
    const updateProfileStats = functionBody(source, "updateProfileStats");

    expect(updateProfileStats.indexOf("canWriteAccountDerivedStats")).toBeLessThan(
      updateProfileStats.indexOf("getLocalSurahProgress"),
    );
  });

  it("keeps server surah progress monotonic when local SQLite has fewer rows", () => {
    const updateProfileStats = functionBody(read("lib/fsrs/leaderboard-sync.ts"), "updateProfileStats");

    expect(updateProfileStats).toContain("Math.max(row.totalCards, existing?.total_cards ?? 0)");
    expect(updateProfileStats).toContain("Math.max(row.memorized, existing?.memorized_cards ?? 0)");
  });

  it("uses the owner's server surah progress only on their own profile", () => {
    const source = read("components/profile/ProfileModalContent.tsx");

    expect(source).toContain("chooseRicherSurahProgress(localSurahProgress, remoteSurahProgress)");
    expect(source).toContain("enabled: hasValidRequestedUserId && isOwnProfile,");
  });
});
