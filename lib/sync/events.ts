type SyncCompletedSummary = {
  pushed: number;
  pulled: number;
  accountRestored?: boolean;
  localDataReplaced?: boolean;
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

export function emitSyncQueued() {
  for (const listener of queuedListeners) listener();
}

export function subscribeSyncQueued(listener: QueuedListener) {
  queuedListeners.add(listener);
  return () => {
    queuedListeners.delete(listener);
  };
}
