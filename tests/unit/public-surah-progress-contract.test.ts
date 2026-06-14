import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPath = "supabase/migrations/20260614120000_public_surah_progress_from_study_cards.sql";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("public Surah Progress aggregate contract", () => {
  it("maintains public_surah_progress from synced study_cards on the server", () => {
    const migration = read(migrationPath);

    expect(migration).toContain("CREATE SCHEMA IF NOT EXISTS private;");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.public_surah_progress");
    expect(migration).toContain("ALTER TABLE public.public_surah_progress ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE POLICY \"Public surah progress is publicly readable\"");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION private.refresh_public_surah_progress_for_user");
    expect(migration).toContain("CREATE TRIGGER study_cards_public_surah_progress_insert");
    expect(migration).toContain("CREATE TRIGGER study_cards_public_surah_progress_update");
    expect(migration).toContain("CREATE TRIGGER study_cards_public_surah_progress_delete");
    expect(migration).toContain("REFERENCING NEW TABLE AS new_rows");
    expect(migration).toContain("REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows");
    expect(migration).toContain("SELECT DISTINCT user_id FROM public.study_cards");
  });

  it("keeps the server aggregate aligned with local Surah Progress card filters", () => {
    const localProgress = read("lib/profile/progress.ts");
    const migration = read(migrationPath);

    for (const snippet of ["word:%", "MUTASHABIHAT_DECK_ID", "SMART_DECK_IDS.mutashabihat", "SMART_DECK_IDS.similarTails", "SMART_DECK_IDS.qiraat", "SMART_DECK_IDS.reasonsOfRevelation"]) {
      expect(localProgress).toContain(snippet);
    }

    for (const snippet of ["word:%", "default-mutashabihat", "default-similar-tails", "default-qiraat", "default-reasons-of-revelation", "mutashabihat:%"]) {
      expect(migration).toContain(snippet);
    }

    expect(migration).toContain("reps > 0 OR last_review IS NOT NULL");
  });

  it("keeps SECURITY DEFINER functions out of the exposed public schema", () => {
    const migration = read(migrationPath);
    const securityDefinerFunctionBlocks = [...migration.matchAll(/CREATE OR REPLACE FUNCTION ([\w.]+)[\s\S]*?SECURITY DEFINER/g)]
      .map((match) => match[1]);

    expect(securityDefinerFunctionBlocks.length).toBeGreaterThan(0);
    expect(securityDefinerFunctionBlocks.every((name) => name.startsWith("private."))).toBe(true);
    expect(migration).toContain("REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;");
  });

  it("refreshes public aggregates after normal client sync completes", () => {
    const syncHook = read("lib/sync/useSync.ts");
    const fullSyncIndex = syncHook.indexOf("const result = await fullSync(db);");
    const updateStatsIndex = syncHook.indexOf("await updateProfileStats(db).catch");

    expect(syncHook).toContain('import { updateProfileStats } from "@/lib/fsrs/leaderboard-sync";');
    expect(fullSyncIndex).toBeGreaterThanOrEqual(0);
    expect(updateStatsIndex).toBeGreaterThan(fullSyncIndex);
  });
});
