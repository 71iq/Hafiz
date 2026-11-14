type SyncCompletedSummary = {
  pushed: number;
  pulled: number;
  accountRestored?: boolean;
  localDataReplaced?: boolean;
  /** This sync finished the account's restore on this device, with or without remote data. */
  restoreCompleted?: boolean;
};

type Listener = (summary: SyncCompletedSummary) => void;

const listeners = new Set<Listener>();

export function emitSyncCompleted(summary: SyncCompletedSummary) {
  for (const listener of listeners) listener(summary);
}

export function subscribeSyncCompleted(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type QueuedListener = () => void;
const queuedListeners = new Set<QueuedListener>();

/** A local change was queued for sync; the sync hook pushes it shortly after. */
export function emitSyncQueued() {
  for (const listener of queuedListeners) listener();
}

export function subscribeSyncQueued(listener: QueuedListener) {
  queuedListeners.add(listener);
  return () => {
    queuedListeners.delete(listener);
  };
}
