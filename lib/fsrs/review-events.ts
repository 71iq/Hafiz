type Listener = () => void;

const listeners = new Set<Listener>();

export function emitReviewActivity() {
  for (const listener of listeners) listener();
}

export function subscribeReviewActivity(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
