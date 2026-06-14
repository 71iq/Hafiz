type SyncCompletedSummary = {
  pushed: number;
  pulled: number;
  accountRestored?: boolean;
  localDataReplaced?: boolean;
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
