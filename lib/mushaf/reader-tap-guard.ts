const CLAIM_MS = 900;
let claimedAt = 0;

export function claimReaderTap(now = Date.now()) {
  claimedAt = now;
}

export function isReaderTapClaimed(now = Date.now()): boolean {
  return now - claimedAt < CLAIM_MS;
}

export function releaseReaderTap() {
  claimedAt = 0;
}
