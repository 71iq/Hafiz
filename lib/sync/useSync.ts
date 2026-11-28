import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useDatabase } from "@/lib/database/provider";
import { useAuthStore } from "@/lib/auth/store";
import { authCommands } from "@/lib/auth/commands";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  acceptRestoreConsent,
  cancelRestoreConsent,
  clearRestoreConsentRequests,
  fullSync,
  hasCompletedAccountRestore,
  readRestorePause,
  refreshRestoreConsent,
  type SyncResult,
  type SyncStatus,
} from "@/lib/database/sync";
import { getPendingSyncCount } from "@/lib/database/sync-queue";
import { updateProfileStats } from "@/lib/fsrs/leaderboard-sync";
import { isQfSyncEnabled } from "@/lib/quran-foundation/config";
import { fullQfUserSync, getPendingQfSyncCount } from "@/lib/quran-foundation/user-sync";
import { emitSyncCompleted, subscribeSyncQueued } from "@/lib/sync/events";
import {
  getRestoreConsentView,
  registerRestoreConsentHandlers,
  resetRestoreConsent,
  updateRestoreConsent,
} from "@/lib/sync/restore-consent";
import { useSettings } from "@/lib/settings/context";

const LOCAL_CHANGE_SYNC_DELAY_MS = 20_000;
const PERIODIC_SYNC_INTERVAL_MS = 5 * 60_000;
/** W02: a reconnect waits this long, so a flapping connection starts one sync. */
export const RECONNECT_SYNC_DEBOUNCE_MS = 2_000;

/**
 * `auto` is every automatic trigger and obeys a stored restore pause. `manual` is the owner's Sync now
 * or Retry: it waits for a run in progress instead of dropping, and still obeys the pause. `resume` is
 * the owner's explicit Resume sync. `prepare` refreshes the dialog. `accept` submits its displayed token.
 */
type SyncMode = { kind: "auto" | "manual" | "resume" | "prepare" } | { kind: "accept"; token: string };
const AUTO: SyncMode = { kind: "auto" };
const MANUAL: SyncMode = { kind: "manual" };

/**
 * Why the last run did not finish cleanly, for the account status. `offline`: no connection.
 * `partial`: some changes stayed queued. `failed`: the account could not be reached.
 */
export type SyncFailure = "offline" | "partial" | "failed";

// The last complete sync per account in this process, so a remounted view keeps it.
const lastSyncedAtByUser = new Map<string, string>();

/** Pending writes the status may report. Quran Foundation rows stay stored but count only while its gate is on. */
async function readPendingCount(db: Parameters<typeof getPendingSyncCount>[0]): Promise<number> {
  const [accountCount, qfCount] = await Promise.all([
    getPendingSyncCount(db),
    isQfSyncEnabled() ? getPendingQfSyncCount(db) : Promise.resolve(0),
  ]);
  return accountCount + qfCount;
}

type SyncView = {
  start: () => Promise<void>;
  /** The database and account this view syncs, as of its latest render. */
  holds: (db: unknown, userId: string) => boolean;
};
// The optional status overlay can remount while its database work is still pending.
let physicalSyncRun: symbol | null = null;
let physicalSyncSettled: Promise<void> = Promise.resolve();
// In-memory consent belongs to one account session. Remounting the overlay keeps it; a transition drops it.
let consentIdentityKey: string | null = null;
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

function isOrdinaryResult(result: SyncResult): boolean {
  return (
    result.status === "synced" ||
    result.status === "partial" ||
    result.status === "failed" ||
    result.status === "not_connected"
  );
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
  const [failure, setFailure] = useState<SyncFailure | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() =>
    userId ? (lastSyncedAtByUser.get(userId) ?? null) : null,
  );
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const viewOwner = useRef<SyncView>({ start: async () => {}, holds: () => false });
  const sequence = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const context = useRef({ db, userId, identityKey, isLoaded, isTranslationLoading });
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
    setFailure(null);
    setLastSyncedAt(userId ? (lastSyncedAtByUser.get(userId) ?? null) : null);
    // An account or session transition retires any prepared consent and its UI at once.
    if (consentIdentityKey !== identityKey) {
      consentIdentityKey = identityKey;
      clearRestoreConsentRequests();
      resetRestoreConsent(identity.kind === "identified" ? userId : null);
    }
    // identity is derived from identityKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, clearIdleTimer]);

  const runSync = useCallback(
    async (mode: SyncMode) => {
      const eligible = () =>
        mounted.current &&
        latestSyncView() === viewOwner.current &&
        context.current.db === db &&
        context.current.identityKey === identityKey &&
        context.current.userId === userId &&
        isSupabaseConfigured() &&
        !!userId &&
        isLoaded &&
        !isTranslationLoading;
      if (!eligible() || !userId) return;
      const explicit = mode.kind !== "auto";
      const obeysPause = mode.kind === "auto" || mode.kind === "manual";
      if (physicalSyncRun) {
        // Automatic triggers drop while another run holds the lease; an explicit action waits for it.
        if (!explicit) return;
        while (physicalSyncRun) await physicalSyncSettled;
        if (!eligible()) return;
      }
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
      let settle!: () => void;
      physicalSyncRun = token;
      physicalSyncSettled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      clearIdleTimer();
      if (mode.kind === "accept") updateRestoreConsent(userId, { busy: "accepting", issue: null });
      else if (mode.kind === "resume" || mode.kind === "prepare") updateRestoreConsent(userId, { busy: "resuming" });

      try {
        if (obeysPause) {
          // A stored pause stops every automatic trigger and Sync now before any account work; only
          // Resume sync continues. fullSync checks again. It is read before connectivity so a cold
          // start offline still shows Sync paused and labels local figures (W07.9).
          const pause = await readRestorePause(db, userId);
          if (!isCurrent()) return;
          if (pause) {
            if (getRestoreConsentView().pause !== pause) updateRestoreConsent(userId, { pause });
            setStatus("idle");
            return;
          }
        }
        // Accepting applies the snapshot already held in memory, so it does not wait for connectivity.
        if (mode.kind !== "accept") {
          const netState = await NetInfo.fetch();
          if (!isCurrent()) return;
          if (netState.isConnected === false) {
            setStatus("offline");
            setFailure("offline");
            return;
          }
          // Unknown connectivity is not offline, but it is not a connection to sync over either.
          if (netState.isConnected !== true) return;
        }
        setStatus("syncing");
        setFailure(null);
        if (mode.kind === "prepare") {
          const refreshed = await refreshRestoreConsent(db);
          if (isCurrent()) {
            updateRestoreConsent(userId, { ...refreshed, busy: null, issue: null });
            setStatus("idle");
          }
          return;
        }
        // The rows a run moved are in the database whatever becomes of the view that started it, so
        // they are announced as soon as the result is known, before follow-up work can outlast the
        // view: an account restore that finished as the app navigated after sign-in otherwise left
        // Home on the empty plan it read first, since the next run moves nothing and announces
        // nothing. A retired run announces only while the same session holds the data and a mounted
        // view still syncs that database. A finished restore is announced even when it moved no rows:
        // the local data now belongs to this account, and screens and the board refresh wait for it.
        const announce = (moved: SyncResult) => {
          if (!isOrdinaryResult(moved)) return;
          if (!(moved.pushed > 0 || moved.pulled > 0 || moved.accountRestored || moved.restoreCompleted)) return;
          const holder = latestSyncView();
          if (isCurrent() || (isAuthCurrent() && holder !== undefined && holder.holds(db, userId))) {
            emitSyncCompleted(moved);
          }
        };
        const result =
          mode.kind === "accept"
            ? await acceptRestoreConsent(db, mode.token)
            : mode.kind === "resume"
              ? await fullSync(db, { resume: true })
              : await fullSync(db);
        if (!isCurrent()) {
          announce(result);
          return;
        }
        if (result.status === "restore_consent_stale" || result.status === "restore_consent_invalid") {
          updateRestoreConsent(userId, { busy: null, issue: result.status === "restore_consent_stale" ? "stale" : "expired" });
          setStatus("idle");
          return;
        }
        if (result.status === "needs_restore_consent") {
          updateRestoreConsent(userId, { request: result.request, pause: "pending_consent", busy: null, issue: null });
          setStatus("idle");
          return;
        }
        if (result.status === "sync_paused") {
          updateRestoreConsent(userId, { request: null, pause: result.pause, busy: null });
          setStatus("idle");
          return;
        }
        if (!isOrdinaryResult(result)) return;
        announce(result);
        if (!isCurrent()) return;
        // The account restore is complete for this owner, so any pause and request are over.
        const consent = getRestoreConsentView();
        if (consent.request || consent.pause || consent.busy || consent.issue) {
          updateRestoreConsent(userId, { request: null, pause: null, busy: null, issue: null });
        }
        await updateProfileStats(db).catch((error) => {
          if (isCurrent())
            console.warn(
              "[Sync] Failed to update public profile aggregates:",
              error instanceof Error ? error.message : String(error),
            );
        });
        if (!isCurrent()) return;
        const qfResult = isQfSyncEnabled() ? await fullQfUserSync(db) : null;
        if (!isCurrent()) return;
        const counts = await Promise.all([
          getPendingSyncCount(db),
          qfResult === null ? Promise.resolve(0) : getPendingQfSyncCount(db),
        ]);
        if (!isCurrent()) return;
        setPendingCount(counts[0] + counts[1]);
        const complete =
          result.status === "synced" &&
          counts[0] === 0 &&
          (qfResult === null ||
            qfResult.status === "not_connected" ||
            (qfResult.status === "synced" && counts[1] === 0));
        setStatus(complete ? "synced" : "error");
        if (!complete) {
          setFailure(result.status === "failed" ? "failed" : "partial");
          return;
        }
        const finishedAt = new Date().toISOString();
        lastSyncedAtByUser.set(userId, finishedAt);
        setLastSyncedAt(finishedAt);
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
          setFailure("failed");
          // A failed acceptance rolled back and retired its token; consent must be prepared again.
          if (mode.kind === "accept" || mode.kind === "prepare") updateRestoreConsent(userId, { busy: null, issue: "failed" });
          else if (mode.kind === "resume") updateRestoreConsent(userId, { busy: null });
          try {
            const count = await readPendingCount(db);
            if (isCurrent()) setPendingCount(count);
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
        if (!retired && explicit && getRestoreConsentView().busy) updateRestoreConsent(userId, { busy: null });
        if (physicalSyncRun === token) physicalSyncRun = null;
        settle();
        // A replacement view/account waits until the previous physical work settles.
        if (retired) void latestSyncView()?.start();
      }
    },
    [db, userId, identityKey, isLoaded, isTranslationLoading, clearIdleTimer],
  );
  const doSync = useCallback(() => runSync(AUTO), [runSync]);
  const syncNow = useCallback(() => runSync(MANUAL), [runSync]);

  const cancelRestore = useCallback(async () => {
    if (!userId) return;
    const isAuthCurrent = captureSyncOwner(userId);
    if (!isAuthCurrent) return;
    updateRestoreConsent(userId, { busy: "cancelling" });
    let cancelled = false;
    try {
      cancelled = await cancelRestoreConsent(db);
    } catch (error) {
      console.warn("[Sync] Failed to store the sync pause:", error instanceof Error ? error.message : String(error));
    }
    // The request is gone either way. A failed write leaves the prepared pending pause in place.
    if (isAuthCurrent())
      updateRestoreConsent(userId, {
        request: null,
        pause: cancelled ? "cancelled" : "pending_consent",
        busy: null,
        issue: null,
      });
  }, [db, userId]);

  useLayoutEffect(() => {
    context.current = { db, userId, identityKey, isLoaded, isTranslationLoading };
    viewOwner.current.start = doSync;
    viewOwner.current.holds = (heldDb, heldUserId) =>
      context.current.db === heldDb && context.current.userId === heldUserId;
  }, [db, userId, identityKey, isLoaded, isTranslationLoading, doSync]);

  useLayoutEffect(
    () =>
      registerRestoreConsentHandlers({
        accept: (token) => runSync({ kind: "accept", token }),
        prepareAgain: () => runSync({ kind: "prepare" }),
        cancel: cancelRestore,
        resume: () => runSync({ kind: "resume" }),
      }),
    [runSync, cancelRestore],
  );

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
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelReconnect = () => {
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isAuthCurrent = userId ? captureSyncOwner(userId) : null;
      if (!active || !mounted.current || latestSyncView() !== viewOwner.current || !isAuthCurrent?.()) return;
      if (state.isConnected === false) {
        // Another offline transition cancels a pending reconnect sync.
        cancelReconnect();
        clearIdleTimer();
        setStatus("offline");
        setFailure("offline");
        return;
      }
      // Unknown connectivity is neither offline nor a reconnect.
      if (state.isConnected !== true) return;
      cancelReconnect();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        // doSync still obeys the restore pause and the physical single-flight lease.
        if (active && isAuthCurrent()) void doSync();
      }, RECONNECT_SYNC_DEBOUNCE_MS);
    });
    return () => {
      active = false;
      cancelReconnect();
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
    readPendingCount(db)
      .then((count) => {
        if (active && mounted.current && isAuthCurrent()) setPendingCount(count);
      })
      .catch((error) => {
        if (active && isAuthCurrent()) console.warn(error);
      });
    return () => {
      active = false;
    };
  }, [db, userId, identityKey, status]);

  // Before this session's first complete run, the last complete pull recorded for this account's
  // restored dataset stands in. It is read only once the account restore is complete on this device.
  useEffect(() => {
    if (!userId || lastSyncedAtByUser.has(userId)) return;
    const isAuthCurrent = captureSyncOwner(userId);
    if (!isAuthCurrent) return;
    let active = true;
    (async () => {
      if (!(await hasCompletedAccountRestore(db, userId))) return;
      const row = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM user_settings WHERE key = 'last_pull_at'",
      );
      const value = row?.value;
      if (!value || Number.isNaN(Date.parse(value)) || Date.parse(value) <= 0) return;
      if (!active || !isAuthCurrent() || lastSyncedAtByUser.has(userId)) return;
      lastSyncedAtByUser.set(userId, value);
      setLastSyncedAt(value);
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, [db, userId, identityKey]);

  return { status, pendingCount, failure, lastSyncedAt, triggerSync: doSync, syncNow };
}
