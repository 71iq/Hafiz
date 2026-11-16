import type { DatabaseExecutor } from "@/lib/database/types";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/lib/auth/store";
import { authCommands } from "@/lib/auth/commands";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import { getLocalSurahProgress } from "@/lib/profile/progress";
import { hasCompletedAccountRestore, readRestorePause } from "@/lib/database/sync";
import { errorMessage } from "@/lib/error-message";

type StatsOwner = {
  userId: string;
  key: string;
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
    key: JSON.stringify(identity),
    isCurrent: () => authOwner.isCurrent() && useAuthStore.getState().user?.id === user.id,
  };
}

let statsQueue: { owner: StatsOwner; tail: Promise<void> } | null = null;

let lastUploaded: { ownerKey: string; figures: string } | null = null;

function enqueueStats(owner: StatsOwner, work: () => Promise<void>): Promise<void> {
  const queue = statsQueue?.owner.isCurrent() ? statsQueue : { owner, tail: Promise.resolve() };
  if (queue !== statsQueue && lastUploaded?.ownerKey !== owner.key) lastUploaded = null;
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
  const [restored, pause] = await Promise.all([
    hasCompletedAccountRestore(db, owner.userId),
    readRestorePause(db, owner.userId),
  ]);
  if (!owner.isCurrent()) return false;
  if (!restored) console.warn("[Profile] Skipping surah progress until account data restore completes.");
  return restored && pause === null;
}

export async function updateProfileStats(db: DatabaseExecutor): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const owner = captureStatsOwner();
  if (!owner) return;
  return enqueueStats(owner, async () => {
    try {
      if (!(await canWriteAccountDerivedStats(db, owner))) return;
      const surahProgress = await getLocalSurahProgress(db);
      if (!owner.isCurrent()) return;
      const figures = JSON.stringify(
        surahProgress.map((row) => [row.surah, row.totalCards, row.memorized]).sort((a, b) => a[0] - b[0]),
      );
      if (lastUploaded?.ownerKey === owner.key && lastUploaded.figures === figures) return;
      const remoteSurahProgress = await supabase
        .from("public_surah_progress")
        .select("surah, total_cards, memorized_cards")
        .eq("user_id", owner.userId);
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
      lastUploaded = { ownerKey: owner.key, figures };
    } catch (error) {
      if (owner.isCurrent()) console.warn("[Profile] Failed to update surah progress:", errorMessage(error));
    }
  });
}

export function resetProfileStatsMemoryForTests() {
  lastUploaded = null;
}
