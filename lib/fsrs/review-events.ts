import type { WirdProgressEvent } from "@/lib/habit/queries";

type Listener = (wird?: WirdProgressEvent) => void;

const listeners = new Set<Listener>();

export function emitReviewActivity(wird?: WirdProgressEvent) {
  for (const listener of listeners) listener(wird);
}

export function subscribeReviewActivity(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
