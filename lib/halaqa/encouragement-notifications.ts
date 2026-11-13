import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabase } from "@/lib/database/provider";
import type { AppDatabase } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import { fetchReceivedEncouragementsSince } from "@/lib/halaqa/api";
import { notifyGroupEncouragement } from "@/lib/notifications/schedule";
import { captureSocialOwner } from "@/lib/social/owner";
import { socialFailureOf } from "@/lib/social/remote";
import { isSupabaseConfigured } from "@/lib/supabase";
import { subscribeSyncCompleted } from "@/lib/sync/events";

/**
 * The group_encouragement trigger (5.8.2). The device keeps, per account, the server time of the
 * newest encouragement it has handled. A check asks the server for what arrived after it, hands the
 * count to notifyGroupEncouragement, which batches it into at most one notification a day, and only
 * then moves the mark forward, so a failed notification is retried by the next check.
 *
 * The key starts with "device_", which is off the sync allowlist (lib/database/user-settings.ts): the
 * mark describes this device's notifications, not the account.
 */
const WATERMARK_PREFIX = "device_halaqa_encouragements_seen:";

export function encouragementWatermarkKey(userId: string): string {
  return `${WATERMARK_PREFIX}${userId}`;
}

export type EncouragementCheck =
  /** Signed out, no account service, or the account changed. */
  | { status: "skipped" }
  /** First check for this account on this device: the mark starts now and nothing is announced. */
  | { status: "started" }
  | { status: "checked"; received: number };

async function runCheck(db: AppDatabase, userId: string): Promise<EncouragementCheck> {
  const owner = captureSocialOwner(userId);
  if (!owner) return { status: "skipped" };
  const key = encouragementWatermarkKey(userId);
  const stored = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [key]);
  const since = stored?.value || null;
  const result = await fetchReceivedEncouragementsSince(since, owner);
  if (!owner.isCurrent()) return { status: "skipped" };

  if (since === null) {
    // Older encouragements were seen in the app or are past; announcing them now would be noise.
    await putUserSetting(db, key, result.latestCreatedAt ?? result.checkedAt);
    return { status: "started" };
  }
  if (result.count > 0) await notifyGroupEncouragement(db, { count: result.count });
  // Rows from halaqas the reader has left are not counted but still move the mark past them.
  if (result.latestCreatedAt !== null && result.latestCreatedAt !== since) {
    await putUserSetting(db, key, result.latestCreatedAt);
  }
  return { status: "checked", received: result.count };
}

// One check at a time per account, so a foreground and a finished sync arriving together cannot
// announce the same encouragement twice.
const running = new Map<string, Promise<EncouragementCheck>>();

/** Checks for new group encouragement for this signed-in account. Safe to call often. */
export function checkGroupEncouragements(db: AppDatabase, userId: string | null): Promise<EncouragementCheck> {
  if (!userId || !isSupabaseConfigured()) return Promise.resolve({ status: "skipped" });
  const current = running.get(userId);
  if (current) return current;
  const check = runCheck(db, userId).finally(() => running.delete(userId));
  running.set(userId, check);
  return check;
}

/**
 * Runs the check for the signed-in account now, whenever the app returns to the foreground and after
 * each sync. Mount once inside the database provider. Failures wait for the next trigger; being
 * offline or switching accounts is expected and stays quiet.
 */
export function useGroupEncouragementChecks(): void {
  const db = useDatabase();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  useEffect(() => {
    if (!userId) return;
    const run = () => {
      checkGroupEncouragements(db, userId).catch((error: unknown) => {
        const kind = socialFailureOf(error).kind;
        if (kind !== "offline" && kind !== "account_changed" && kind !== "unconfigured") {
          console.warn("[Halaqa] Encouragement check failed:", error);
        }
      });
    };
    run();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    const unsubscribe = subscribeSyncCompleted(run);
    return () => {
      appState.remove();
      unsubscribe();
    };
  }, [db, userId]);
}
