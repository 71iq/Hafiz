import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useDatabase } from "@/lib/database/provider";
import { useAuthStore } from "@/lib/auth/store";
import { authCommands } from "@/lib/auth/commands";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import { isSupabaseConfigured } from "@/lib/supabase";
import { fullSync, type SyncStatus } from "@/lib/database/sync";
import { getPendingSyncCount } from "@/lib/database/sync-queue";
import { updateProfileStats } from "@/lib/fsrs/leaderboard-sync";
import { isQfSyncEnabled } from "@/lib/quran-foundation/config";
import { fullQfUserSync, getPendingQfSyncCount } from "@/lib/quran-foundation/user-sync";
import { emitSyncCompleted, subscribeSyncQueued } from "@/lib/sync/events";
import { useSettings } from "@/lib/settings/context";

const LOCAL_CHANGE_SYNC_DELAY_MS = 20_000;
const PERIODIC_SYNC_INTERVAL_MS = 5 * 60_000;

type SyncView = { start: () => Promise<void> };
// The optional status overlay can remount while its database work is still pending.
let physicalSyncRun: symbol | null = null;
const syncViews = new Set<SyncView>();
function latestSyncView(): SyncView | undefined {
  let latest: SyncView | undefined;
  for (const view of syncViews) latest = view;
  return latest;
}

function captureSyncOwner(userId: string): (() => boolean) | null {
  const auth = useAuthStore.getState();
  const identity = getAuthSessionIdentity(auth.session);
  if (auth.user?.id !== userId || identity.kind !== "identified" || identity.userId !== userId.toLowerCase())
    return null;
  const owner = authCommands.captureOwner();
  return () => {
    const current = useAuthStore.getState();
    const currentIdentity = getAuthSessionIdentity(current.session);
    return (
      owner.isCurrent() &&
      current.user?.id === userId &&
      currentIdentity.kind === "identified" &&
      currentIdentity.userId === identity.userId &&
      currentIdentity.sessionId === identity.sessionId
    );
  };
}

/** Automatic sync never blocks local reads. A retired run keeps the physical
 * single-flight lease until it settles, then the latest eligible owner can run. */
export function useSync() {
  const db = useDatabase();
  const { isLoaded, isTranslationLoading } = useSettings();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const session = useAuthStore((state) => state.session);
  const identity = getAuthSessionIdentity(session);
  const identityKey = identity.kind === "identified" ? JSON.stringify(identity) : `${identity.kind}:${userId ?? ""}`;
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  const [accountRestoreNotice, setAccountRestoreNotice] = useState(false);
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const viewOwner = useRef<SyncView>({ start: async () => {} });
  const sequence = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const context = useRef({ db, userId, identityKey, isLoaded, isTranslationLoading });
  const dismissAccountRestoreNotice = useCallback(() => setAccountRestoreNotice(false), []);
  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current !== null) clearTimeout(idleTimer.current);
    idleTimer.current = null;
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    lifecycle.current += 1;
    const view = viewOwner.current;
    syncViews.add(view);
    return () => {
      syncViews.delete(view);
      mounted.current = false;
      lifecycle.current += 1;
      clearIdleTimer();
    };
  }, [clearIdleTimer]);

  useEffect(() => {
    clearIdleTimer();
    sequence.current += 1;
    setStatus("idle");
    setPendingCount(0);
    setAccountRestoreNotice(false);
  }, [identityKey, clearIdleTimer]);

  const doSync = useCallback(async () => {
    if (
      !mounted.current ||
      latestSyncView() !== viewOwner.current ||
      context.current.db !== db ||
      context.current.identityKey !== identityKey ||
      context.current.userId !== userId ||
      !isSupabaseConfigured() ||
      !userId ||
      !isLoaded ||
      isTranslationLoading ||
      physicalSyncRun
    )
      return;
    const isAuthCurrent = captureSyncOwner(userId);
    if (!isAuthCurrent) return;
    const ownLifecycle = lifecycle.current;
    const token = Symbol("sync run");
    const runId = ++sequence.current;
    const isCurrent = () =>
      mounted.current &&
      latestSyncView() === viewOwner.current &&
      lifecycle.current === ownLifecycle &&
      isAuthCurrent() &&
      context.current.db === db &&
      context.current.identityKey === identityKey &&
      context.current.userId === userId &&
      context.current.isLoaded &&
      !context.current.isTranslationLoading;
    physicalSyncRun = token;
    clearIdleTimer();

    try {
      const netState = await NetInfo.fetch();
      if (!isCurrent()) return;
      if (!netState.isConnected) {
        setStatus("offline");
        return;
      }
      setStatus("syncing");
      const result = await fullSync(db);
      if (!isCurrent()) return;
      await updateProfileStats(db).catch((error) => {
        if (isCurrent())
          console.warn(
            "[Sync] Failed to update public profile aggregates:",
            error instanceof Error ? error.message : String(error),
          );
      });
      if (!isCurrent()) return;
      if (result.localDataReplaced) setAccountRestoreNotice(true);
      // A finished account restore is announced even when it moved no rows: the local data now
      // belongs to this account, and screens and the board refresh wait for it.
      if (result.pushed > 0 || result.pulled > 0 || result.accountRestored) emitSyncCompleted(result);
      if (!isCurrent()) return;
      const qfResult = isQfSyncEnabled() ? await fullQfUserSync(db) : null;
      if (!isCurrent()) return;
      const counts = await Promise.all([getPendingSyncCount(db), getPendingQfSyncCount(db)]);
      if (!isCurrent()) return;
      setPendingCount(counts[0] + counts[1]);
      const complete =
        result.status === "synced" &&
        counts[0] === 0 &&
        (qfResult === null || qfResult.status === "not_connected" || (qfResult.status === "synced" && counts[1] === 0));
      setStatus(complete ? "synced" : "error");
      if (!complete) return;
      const timer = setTimeout(() => {
        if (idleTimer.current !== timer) return;
        idleTimer.current = null;
        if (isCurrent() && sequence.current === runId && physicalSyncRun === null) {
          setStatus((previous) =>
            isCurrent() && sequence.current === runId && previous === "synced" ? "idle" : previous,
          );
        }
      }, 3000);
      idleTimer.current = timer;
    } catch (error) {
      if (isCurrent()) {
        console.warn("[Sync] Error:", error instanceof Error ? error.message : String(error));
        setStatus("error");
        try {
          const counts = await Promise.all([getPendingSyncCount(db), getPendingQfSyncCount(db)]);
          if (isCurrent()) setPendingCount(counts[0] + counts[1]);
        } catch (countError) {
          if (isCurrent())
            console.warn(
              "[Sync] Failed to refresh pending count:",
              countError instanceof Error ? countError.message : String(countError),
            );
        }
      }
    } finally {
      const retired = !isCurrent();
      if (physicalSyncRun === token) physicalSyncRun = null;
      // A replacement view/account waits until the previous physical work settles.
      if (retired) void latestSyncView()?.start();
    }
  }, [db, userId, identityKey, isLoaded, isTranslationLoading, clearIdleTimer]);
  useLayoutEffect(() => {
    context.current = { db, userId, identityKey, isLoaded, isTranslationLoading };
    viewOwner.current.start = doSync;
  }, [db, userId, identityKey, isLoaded, isTranslationLoading, doSync]);

  // Besides launch, resume and reconnect, a signed-in session syncs shortly after local changes, when
  // the app goes to the background (so a long session's work reaches the account before the OS
  // suspends it) and periodically while open (so another device's changes arrive).
  const localChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLocalChangeSync = useCallback(() => {
    if (localChangeTimer.current !== null) clearTimeout(localChangeTimer.current);
    localChangeTimer.current = setTimeout(function runWhenIdle() {
      // A run in progress may have read its queue before this change; try again once it settles.
      if (physicalSyncRun) {
        localChangeTimer.current = setTimeout(runWhenIdle, LOCAL_CHANGE_SYNC_DELAY_MS);
        return;
      }
      localChangeTimer.current = null;
      void doSync();
    }, LOCAL_CHANGE_SYNC_DELAY_MS);
  }, [doSync]);

  useEffect(() => {
    if (!userId) return;
    const unsubscribe = subscribeSyncQueued(scheduleLocalChangeSync);
    return () => {
      unsubscribe();
      if (localChangeTimer.current !== null) clearTimeout(localChangeTimer.current);
      localChangeTimer.current = null;
    };
  }, [userId, scheduleLocalChangeSync]);

  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void doSync();
    }, PERIODIC_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [userId, doSync]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active" || nextState === "background") void doSync();
    });
    return () => sub.remove();
  }, [doSync]);

  useEffect(() => {
    let active = true;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isAuthCurrent = userId ? captureSyncOwner(userId) : null;
      if (!active || !mounted.current || latestSyncView() !== viewOwner.current || !isAuthCurrent?.()) return;
      if (state.isConnected) void doSync();
      else {
        clearIdleTimer();
        setStatus("offline");
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [doSync, userId, clearIdleTimer]);

  useEffect(() => {
    if (userId) void doSync();
  }, [userId, doSync]);

  useEffect(() => {
    const isAuthCurrent = userId ? captureSyncOwner(userId) : null;
    if (!isAuthCurrent) {
      setPendingCount(0);
      return;
    }
    let active = true;
    Promise.all([getPendingSyncCount(db), getPendingQfSyncCount(db)])
      .then(([supabaseCount, qfCount]) => {
        if (active && mounted.current && isAuthCurrent()) setPendingCount(supabaseCount + qfCount);
      })
      .catch((error) => {
        if (active && isAuthCurrent()) console.warn(error);
      });
    return () => {
      active = false;
    };
  }, [db, userId, identityKey, status]);

  return { status, pendingCount, triggerSync: doSync, accountRestoreNotice, dismissAccountRestoreNotice };
}
