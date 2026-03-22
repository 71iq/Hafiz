/**
 * Lightweight module-level state for passing deep link targets
 * from the /open route to the Mushaf screen.
 */

export type DeepLinkTarget = {
  surah: number;
  ayah: number;
};

let pending: DeepLinkTarget | null = null;

/** Set a pending deep link target (called from the /open route) */
export function setPendingDeepLink(target: DeepLinkTarget) {
  pending = target;
}

/** Consume (read and clear) the pending deep link target (called from Mushaf) */
export function consumePendingDeepLink(): DeepLinkTarget | null {
  const target = pending;
  pending = null;
  return target;
}
