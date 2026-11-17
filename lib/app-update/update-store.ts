import { useSyncExternalStore } from "react";
import { IDLE_PHASE, nextUpdatePhase, type UpdateEvent, type UpdatePhase } from "./download-plan";
import type { AndroidRelease } from "./release";

export type AppUpdateState = Readonly<{
  /** The last published release read from latest.json, and when. */
  latest: Readonly<{ at: number; release: AndroidRelease }> | null;
  /** The one download for the whole app. */
  phase: UpdatePhase;
  /** Later on the install prompt hides it for this version until the next launch (memory only). */
  promptDismissedVersion: number | null;
  /** A download the person asked for that waits for them to accept the size on a metered network. */
  meteredConfirm: AndroidRelease | null;
}>;

const INITIAL: AppUpdateState = {
  latest: null,
  phase: IDLE_PHASE,
  promptDismissedVersion: null,
  meteredConfirm: null,
};

let state = INITIAL;
const listeners = new Set<() => void>();

export function getUpdateState(): AppUpdateState {
  return state;
}

export function setUpdateState(update: (current: AppUpdateState) => AppUpdateState): void {
  const next = update(state);
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

export function dispatchUpdateEvent(event: UpdateEvent): void {
  setUpdateState((current) => {
    const phase = nextUpdatePhase(current.phase, event);
    return phase === current.phase ? current : { ...current, phase };
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Selectors must return stored values (or primitives) so renders happen only on change. */
export function useUpdateState<T>(select: (current: AppUpdateState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(state),
  );
}

/** Test seam: forget the release check, download state and prompt choices. */
export function resetUpdateStore(): void {
  state = INITIAL;
  for (const listener of listeners) listener();
}
