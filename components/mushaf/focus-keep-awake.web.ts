import { useEffect, useState } from "react";

type WakeLockSentinelLike = { release?: () => Promise<void> | void };
type WakeLockLike = { request?: (type: "screen") => Promise<WakeLockSentinelLike> };

function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function releaseQuietly(sentinel: WakeLockSentinelLike | null) {
  try {
    void Promise.resolve(sentinel?.release?.()).catch(() => undefined);
  } catch {
    // Already released by the browser.
  }
}

/**
 * Keeps the screen on while focus auto-scroll plays and the page is visible, using the Screen Wake
 * Lock API. Browsers without it, or that deny it, simply let the screen sleep: study goes on. The
 * browser drops the lock when the page hides; it is requested again on return only while playing.
 */
export function useFocusKeepAwake(playing: boolean) {
  const [visible, setVisible] = useState(isDocumentVisible);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setVisible(isDocumentVisible());
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const wanted = playing && visible;
  useEffect(() => {
    if (!wanted) return;
    const wakeLock =
      typeof navigator !== "undefined" ? (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock : undefined;
    if (typeof wakeLock?.request !== "function") return;
    let sentinel: WakeLockSentinelLike | null = null;
    let released = false;
    try {
      wakeLock
        .request("screen")
        .then((lock) => {
          if (released) releaseQuietly(lock);
          else sentinel = lock;
        })
        .catch(() => undefined);
    } catch {
      return;
    }
    return () => {
      released = true;
      releaseQuietly(sentinel);
      sentinel = null;
    };
  }, [wanted]);
}
