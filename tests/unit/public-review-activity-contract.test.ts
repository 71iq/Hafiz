import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPath = "supabase/migrations/20260614181311_public_profile_review_activity_from_study_log.sql";
const distinctMigrationPath = "supabase/migrations/20260614182342_count_distinct_public_review_events.sql";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("public review activity aggregate contract", () => {
  it("maintains public review activity from synced study_log on the server", () => {
    const migration = read(migrationPath);

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.public_review_activity");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.public_review_stats");
    expect(migration).toContain("ALTER TABLE public.public_review_activity ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE public.public_review_stats ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE POLICY \"Public review activity is publicly readable\"");
    expect(migration).toContain("CREATE POLICY \"Public review stats are publicly readable\"");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION private.refresh_public_review_stats_for_user");
    expect(migration).toContain("CREATE TRIGGER study_log_public_review_stats_insert");
    expect(migration).toContain("CREATE TRIGGER study_log_public_review_stats_update");
    expect(migration).toContain("CREATE TRIGGER study_log_public_review_stats_delete");
    expect(migration).toContain("SELECT DISTINCT user_id FROM public.study_log");
  });

  it("counts distinct review events when remote study_log contains duplicate rows", () => {
    const migration = read(distinctMigrationPath);

    expect(migration).toContain("COUNT(DISTINCT (card_id, reviewed_at))::INTEGER AS reviews_count");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION private.refresh_public_review_stats_for_user");
    expect(migration).toContain("PERFORM private.refresh_public_review_stats_for_user(target_user_id)");
  });

  it("keeps public profile reads off stale daily_scores-only activity", () => {
    const api = read("lib/leaderboard/api.ts");

    expect(api).toContain('from("public_review_activity")');
    expect(api).toContain('from("public_review_stats")');
    expect(api).toContain("fetchPublicReviewAggregateActivity");
    expect(api).toContain("fetchDailyScoreActivity");
    expect(api).toContain("mergePublicProfileStats");
    expect(api).toContain("cards_reviewed: Math.max");
    expect(api).toContain("total_score: Math.max");
  });

  it("repairs public review aggregates from the owner device during profile stat sync", () => {
    const sync = read("lib/fsrs/leaderboard-sync.ts");

    expect(sync).toContain("getLocalReviewSummary");
    expect(sync).toContain("fetchPublicReviewSummary");
    expect(sync).toContain("upsertPublicReviewSummary");
    expect(sync).toContain('from("public_review_activity")');
    expect(sync).toContain('from("public_review_stats")');
    expect(sync).toContain("formatLocalDateKey(reviewedAt)");
    expect(sync).toContain("localReviewSummary.totalReviews");
    expect(sync).toContain("remotePublicReviewSummary?.totalReviews");
  });

  it("uses the merged public review total for public Cards Reviewed", () => {
    const profile = read("components/profile/ProfileModalContent.tsx");

    expect(profile).toContain("const publicCardsReviewed = Math.max(visibleProfile?.cards_reviewed ?? 0, review.totalReviews);");
    expect(profile).toContain("value: isOwnProfile ? ownStats.cardsReviewed : publicCardsReviewed");
  });
});
