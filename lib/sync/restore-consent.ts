import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { RestoreConsentRequest, RestorePauseState } from "@/lib/database/sync";

/**
 * In-memory view of the restore consent and sync pause for the signed-in account. The sync hook is
 * its only writer; the confirmation and the Settings Account status read it. Nothing here persists:
 * the stored pause lives in the database and is re-read by the next sync run.
 */
export type RestoreConsentIssue = "stale" | "expired" | "failed" | null;

export type RestoreConsentView = Readonly<{
  userId: string | null;
  /** The prepared request. The confirmation is open while this is set. */
  request: RestoreConsentRequest | null;
  pause: RestorePauseState | null;
  busy: "accepting" | "cancelling" | "resuming" | null;
  issue: RestoreConsentIssue;
}>;

type Handlers = Readonly<{
  accept: (token: string) => Promise<void>;
  prepareAgain: () => Promise<void>;
  cancel: () => Promise<void>;
  resume: () => Promise<void>;
}>;

const EMPTY: RestoreConsentView = { userId: null, request: null, pause: null, busy: null, issue: null };
let view: RestoreConsentView = EMPTY;
let handlers: Handlers | null = null;
const listeners = new Set<() => void>();

function publish(next: RestoreConsentView) {
  if (next === view) return;
  view = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRestoreConsentView(): RestoreConsentView {
  return view;
}

/** Start over for a new account or session. A request or pause shown for another account is dropped. */
export function resetRestoreConsent(userId: string | null): void {
  publish({ ...EMPTY, userId });
}

/** Apply a change for `userId` only. A late result for a previous account is ignored. */
export function updateRestoreConsent(userId: string, patch: Partial<Omit<RestoreConsentView, "userId">>): void {
  if (view.userId !== userId) return;
  publish({ ...view, ...patch });
}

/** The sync hook view that currently owns sync registers how the actions run. */
export function registerRestoreConsentHandlers(next: Handlers): () => void {
  handlers = next;
  return () => {
    if (handlers === next) handlers = null;
  };
}

function useView(userId: string | null): RestoreConsentView {
  const current = useSyncExternalStore(subscribe, getRestoreConsentView, getRestoreConsentView);
  return userId !== null && current.userId === userId ? current : EMPTY;
}

/** The confirmation's state and actions for the signed-in account. */
export function useRestoreConsent(userId: string | null) {
  const current = useView(userId);
  const request = current.request;
  useEffect(() => {
    if (!request || current.issue || current.busy) return;
    const timer = setTimeout(() => {
      if (request === view.request && !view.issue && !view.busy) {
        updateRestoreConsent(request.userId, { issue: "expired" });
      }
    }, Math.max(0, request.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [request, current.issue, current.busy]);
  const accept = useCallback(() => {
    if (!request || request !== view.request || view.issue || view.busy || view.userId !== userId) return;
    // An expired request is never submitted; the confirmation offers Prepare again instead.
    if (Date.now() >= request.expiresAt) {
      updateRestoreConsent(request.userId, { issue: "expired" });
      return;
    }
    void handlers?.accept(request.token);
  }, [request, userId]);
  const cancel = useCallback(() => {
    if (view.busy || view.userId !== userId) return;
    void handlers?.cancel();
  }, [userId]);
  const prepareAgain = useCallback(() => {
    if (!request || request !== view.request || !view.issue || view.busy || view.userId !== userId) return;
    void handlers?.prepareAgain();
  }, [request, userId]);
  return { ...current, accept, cancel, prepareAgain };
}

/**
 * Sync paused / Resume sync for the Settings Account status. `paused` is true while a stored pause
 * applies to this account and no confirmation is open. Resume fetches a fresh complete snapshot and
 * prompts again if replacement is still destructive; it never treats an earlier Cancel as consent.
 */
export function useSyncRestorePause(userId: string | null) {
  const current = useView(userId);
  const resume = useCallback(() => {
    if (view.busy || view.userId !== userId || !view.pause) return;
    void handlers?.resume();
  }, [userId]);
  return {
    paused: current.pause !== null && current.request === null,
    pause: current.pause,
    resuming: current.busy === "resuming",
    resume,
  };
}
