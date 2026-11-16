
export type DeepLinkTarget = {
  surah: number;
  ayah: number;
  wordPos?: number;
};

let pending: DeepLinkTarget | null = null;
const listeners = new Set<() => void>();

export function setPendingDeepLink(target: DeepLinkTarget) {
  pending = { ...target };
  for (const listener of Array.from(listeners)) listener();
}

export function consumePendingDeepLink(): DeepLinkTarget | null {
  const target = pending;
  pending = null;
  return target;
}

export function peekPendingDeepLink(): DeepLinkTarget | null {
  return pending;
}

export function subscribePendingDeepLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
