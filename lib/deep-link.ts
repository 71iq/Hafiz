/**
 * C06 reader target store. A screen outside the reader (the /open route, Search, bookmarks on
 * another tab, feed and profile ayah links) submits one explicit target here and the Mushaf
 * consumes it exactly once. It lives only in memory: a pending target never survives a restart.
 */

export type DeepLinkTarget = {
  surah: number;
  ayah: number;
  wordPos?: number;
};

let pending: DeepLinkTarget | null = null;
const listeners = new Set<() => void>();

/** Submit an explicit target. A later submission replaces an unconsumed earlier one. */
export function setPendingDeepLink(target: DeepLinkTarget) {
  pending = { ...target };
  for (const listener of Array.from(listeners)) listener();
}

/** Consume (read and clear) the pending target. A second call returns null. */
export function consumePendingDeepLink(): DeepLinkTarget | null {
  const target = pending;
  pending = null;
  return target;
}

/** Peek at the pending target without consuming it. */
export function peekPendingDeepLink(): DeepLinkTarget | null {
  return pending;
}

/** Called after each submission, so a focused reader can consume a target sent while it is open. */
export function subscribePendingDeepLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
