import { useEffect } from "react";
import { AppState } from "react-native";
import { z } from "zod";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabase } from "@/lib/database/provider";
import type { AppDatabase } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import { fetchReceivedEncouragements, type ReceivedEncouragements } from "@/lib/halaqa/api";
import { notifyGroupEncouragement } from "@/lib/notifications/schedule";
import { captureSocialOwner } from "@/lib/social/owner";
import { socialFailureOf } from "@/lib/social/remote";
import { isSupabaseConfigured } from "@/lib/supabase";
import { subscribeSyncCompleted } from "@/lib/sync/events";

/**
 * The group_encouragement trigger (5.8.2). The server lists what the reader received in the last 7
 * days by id, and the device keeps, per account, the ids it has already handled. A check hands the
 * count of new ids to notifyGroupEncouragement, which batches them into at most one notification a
 * day for this account only, and then acknowledges them, so a failed check is retried by the next
 * one. Ids rather than a time mark, because a send that commits after a later one carries the
 * earlier time.
 *
 * The key starts with "device_", which is off the sync allowlist (lib/database/user-settings.ts): the
 * acknowledgements describe this device's notifications, not the account.
 */
const ACKS_PREFIX = "device_halaqa_encouragements_acked:";
/** The server lists 7 days; an hour more absorbs the boundary. */
const ACK_KEEP_MS = (7 * 24 + 1) * 60 * 60 * 1000;

export function encouragementAcksKey(userId: string): string {
  return `${ACKS_PREFIX}${userId}`;
}

/** Acknowledged ids with each encouragement's server time, for pruning by age. */
const acksSchema = z.object({ acked: z.array(z.tuple([z.string(), z.string()])) });

function parseAcks(value: string | undefined): Map<string, string> | null {
  if (!value) return null;
  try {
    const parsed = acksSchema.safeParse(JSON.parse(value));
    return parsed.success ? new Map(parsed.data.acked) : null;
  } catch {
    return null;
  }
}

function serializeAcks(acked: ReadonlyMap<string, string>, received: ReceivedEncouragements): string {
  const oldest = Date.parse(received.checkedAt) - ACK_KEEP_MS;
  const kept = [...acked].filter(([, createdAt]) => !(Date.parse(createdAt) < oldest));
  return JSON.stringify({ acked: kept });
}

export type EncouragementCheck =
  /** Signed out, no account service, or the account changed. */
  | { status: "skipped" }
  /** First check for this account on this device: what is listed is acknowledged, nothing announced. */
  | { status: "started" }
  | { status: "checked"; received: number };

async function runCheck(db: AppDatabase, userId: string): Promise<EncouragementCheck> {
  const owner = captureSocialOwner(userId);
  if (!owner) return { status: "skipped" };
  const key = encouragementAcksKey(userId);
  const stored = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [key]);
  if (!owner.isCurrent()) return { status: "skipped" };
  const acked = parseAcks(stored?.value);
  const received = await fetchReceivedEncouragements(owner);
  if (!owner.isCurrent()) return { status: "skipped" };

  if (acked === null) {
    // Older encouragements were seen in the app or are past; announcing them now would be noise.
    await putUserSetting(db, key, serializeAcks(new Map(received.items.map((item) => [item.id, item.createdAt])), received));
    return { status: "started" };
  }
  const fresh = received.items.filter((item) => !acked.has(item.id));
  if (fresh.length > 0) {
    // Records the batch for this account only, and nothing once another account has signed in.
    const recorded = await notifyGroupEncouragement(db, { account: owner, count: fresh.length });
    if (!recorded) return { status: "skipped" };
    // The batch is now this account's, so its ids are acknowledged under this account's own key even
    // if another account signed in meanwhile; leaving them would announce them twice.
    for (const item of fresh) acked.set(item.id, item.createdAt);
  } else if (!owner.isCurrent()) {
    return { status: "skipped" };
  }
  await putUserSetting(db, key, serializeAcks(acked, received));
  return { status: "checked", received: fresh.length };
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
