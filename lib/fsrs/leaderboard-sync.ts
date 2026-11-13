import type { DatabaseExecutor } from "@/lib/database/types";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/lib/auth/store";
import { authCommands } from "@/lib/auth/commands";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import { getLocalSurahProgress } from "@/lib/profile/progress";
import { hasCompletedAccountRestore } from "@/lib/database/sync";
import { errorMessage } from "@/lib/error-message";

/**
 * After a sync, repair this account's own surah progress on the server from the device. The server
 * also maintains it from synced study cards; only the owner can read it (spec 5.6, SOC-01).
 *
 * Client-written scores, totals and streaks were retired with daily_scores: board points are computed
 * by the server from synced wird days (PTS-02, PTS-05).
 */
type StatsOwner = {
  userId: string;
  isCurrent: () => boolean;
};

function captureStatsOwner(): StatsOwner | null {
  const { user, session } = useAuthStore.getState();
  if (!user) return null;
  const identity = getAuthSessionIdentity(session);
  if (identity.kind !== "identified" || identity.userId !== user.id.toLowerCase()) return null;
  const authOwner = authCommands.captureOwner();
  return {
    userId: user.id,
    isCurrent: () => authOwner.isCurrent() && useAuthStore.getState().user?.id === user.id,
  };
}

let statsQueue: { owner: StatsOwner; tail: Promise<void> } | null = null;

function enqueueStats(owner: StatsOwner, work: () => Promise<void>): Promise<void> {
  const queue = statsQueue?.owner.isCurrent() ? statsQueue : { owner, tail: Promise.resolve() };
  statsQueue = queue;
  const result = queue.tail.then(async () => {
    if (owner.isCurrent()) await work();
  });
  queue.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function canWriteAccountDerivedStats(db: DatabaseExecutor, owner: StatsOwner): Promise<boolean> {
  const restored = await hasCompletedAccountRestore(db, owner.userId);
  if (!owner.isCurrent()) return false;
  if (!restored) console.warn("[Profile] Skipping surah progress until account data restore completes.");
  return restored;
}

/** Repairs this account's server-side surah progress from local cards. Bound to the account that started it. */
export async function updateProfileStats(db: DatabaseExecutor): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const owner = captureStatsOwner();
  if (!owner) return;
  return enqueueStats(owner, async () => {
    try {
      if (!(await canWriteAccountDerivedStats(db, owner))) return;
      const [surahProgress, remoteSurahProgress] = await Promise.all([
        getLocalSurahProgress(db),
        supabase.from("public_surah_progress").select("surah, total_cards, memorized_cards").eq("user_id", owner.userId),
      ]);
      if (!owner.isCurrent()) return;
      if (remoteSurahProgress.error) throw remoteSurahProgress.error;

      const bySurah = new Map<number, { surah: number; total_cards: number; memorized_cards: number }>();
      for (const row of remoteSurahProgress.data ?? []) {
        bySurah.set(row.surah, {
          surah: row.surah,
          total_cards: row.total_cards ?? 0,
          memorized_cards: row.memorized_cards ?? 0,
        });
      }
      for (const row of surahProgress) {
        const existing = bySurah.get(row.surah);
        bySurah.set(row.surah, {
          surah: row.surah,
          total_cards: Math.max(row.totalCards, existing?.total_cards ?? 0),
          memorized_cards: Math.max(row.memorized, existing?.memorized_cards ?? 0),
        });
      }

      const mergedSurahProgress = Array.from(bySurah.values());
      if (mergedSurahProgress.length > 0) {
        const now = new Date().toISOString();
        const { error: progressError } = await supabase.from("public_surah_progress").upsert(
          mergedSurahProgress.map((row) => ({
            user_id: owner.userId,
            surah: row.surah,
            total_cards: row.total_cards,
            memorized_cards: row.memorized_cards,
            updated_at: now,
          })),
          { onConflict: "user_id,surah" },
        );
        if (!owner.isCurrent()) return;
        if (progressError) throw progressError;
      } else {
        const { error: deleteError } = await supabase.from("public_surah_progress").delete().eq("user_id", owner.userId);
        if (!owner.isCurrent()) return;
        if (deleteError) throw deleteError;
      }
    } catch (error) {
      if (owner.isCurrent()) console.warn("[Profile] Failed to update surah progress:", errorMessage(error));
    }
  });
}
