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
