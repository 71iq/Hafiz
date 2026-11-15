/**
 * A settings write failed and its value was reconciled to the last committed choice (when no newer
 * choice was made since). Settings screens show one localized notice. Only the key is passed, never
 * the value.
 */
type Listener = (key: string) => void;
const listeners = new Set<Listener>();

export function emitSettingSaveFailed(key: string): void {
  for (const listener of listeners) listener(key);
}

export function subscribeSettingSaveFailed(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
