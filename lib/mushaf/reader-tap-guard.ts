/**
 * A press on an interactive reader element (an ayah end marker) claims the touch, so the reader's
 * tap-to-toggle layer underneath does not also show or hide the controls for the same tap. Nested
 * Text cannot stop touch propagation on Android, so the claim is a short-lived timestamp instead.
 */
const CLAIM_MS = 900;
let claimedAt = 0;

export function claimReaderTap(now = Date.now()) {
  claimedAt = now;
}

export function isReaderTapClaimed(now = Date.now()): boolean {
  return now - claimedAt < CLAIM_MS;
}

/** Called once the reader layer has seen the claimed touch end. */
export function releaseReaderTap() {
  claimedAt = 0;
}
