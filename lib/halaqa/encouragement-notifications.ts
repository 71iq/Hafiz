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

const ACKS_PREFIX = "device_halaqa_encouragements_acked:";
const ACK_KEEP_MS = (7 * 24 + 1) * 60 * 60 * 1000;

export function encouragementAcksKey(userId: string): string {
  return `${ACKS_PREFIX}${userId}`;
}

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
  | { status: "skipped" }
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
  if (!received.complete) console.warn("[Halaqa] The encouragement list stopped before its last page.");

  if (acked === null) {
    await putUserSetting(db, key, serializeAcks(new Map(received.items.map((item) => [item.id, item.createdAt])), received));
    return { status: "started" };
  }
  const fresh = received.items.filter((item) => !acked.has(item.id));
  if (fresh.length > 0) {
    const recorded = await notifyGroupEncouragement(db, { account: owner, count: fresh.length });
    if (!recorded) return { status: "skipped" };
    for (const item of fresh) acked.set(item.id, item.createdAt);
  } else if (!owner.isCurrent()) {
    return { status: "skipped" };
  }
  await putUserSetting(db, key, serializeAcks(acked, received));
  return { status: "checked", received: fresh.length };
}

const running = new Map<string, Promise<EncouragementCheck>>();

export function checkGroupEncouragements(db: AppDatabase, userId: string | null): Promise<EncouragementCheck> {
  if (!userId || !isSupabaseConfigured()) return Promise.resolve({ status: "skipped" });
  const current = running.get(userId);
  if (current) return current;
  const check = runCheck(db, userId).finally(() => running.delete(userId));
  running.set(userId, check);
  return check;
}

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
