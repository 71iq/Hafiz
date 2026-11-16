import { useCallback, useSyncExternalStore } from "react";
import type { RestoreConsentRequest, RestorePauseState } from "@/lib/database/sync";

export type RestoreConsentIssue = "stale" | "expired" | "failed" | null;

export type RestoreConsentView = Readonly<{
  userId: string | null;
  request: RestoreConsentRequest | null;
  pause: RestorePauseState | null;
  busy: "accepting" | "cancelling" | "resuming" | null;
  issue: RestoreConsentIssue;
}>;

type Handlers = Readonly<{
  accept: (token: string) => Promise<void>;
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

export function resetRestoreConsent(userId: string | null): void {
  publish({ ...EMPTY, userId });
}

export function updateRestoreConsent(userId: string, patch: Partial<Omit<RestoreConsentView, "userId">>): void {
  if (view.userId !== userId) return;
  publish({ ...view, ...patch });
}

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

export function useRestoreConsent(userId: string | null) {
  const current = useView(userId);
  const accept = useCallback(() => {
    const request = view.request;
    if (!request || view.busy || view.userId !== userId) return;
    if (Date.now() >= request.expiresAt) {
      updateRestoreConsent(request.userId, { issue: "expired" });
      return;
    }
    void handlers?.accept(request.token);
  }, [userId]);
  const cancel = useCallback(() => {
    if (view.busy || view.userId !== userId) return;
    void handlers?.cancel();
  }, [userId]);
  const prepareAgain = useCallback(() => {
    if (view.busy || view.userId !== userId) return;
    void handlers?.resume();
  }, [userId]);
  return { ...current, accept, cancel, prepareAgain };
}

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
