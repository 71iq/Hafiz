import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Application from "expo-application";
import { fetchAndroidRelease, newerAndroidRelease, type AndroidRelease } from "./release";

const SIX_HOURS = 6 * 60 * 60 * 1000;

// One shared check for every screen that shows the update, refreshed at most every six hours
// unless the user asks again. Failures (offline, server down) leave the last known release.
let lastCheck: { at: number; release: AndroidRelease } | null = null;
let pending: Promise<AndroidRelease> | null = null;

function loadRelease(force: boolean): Promise<AndroidRelease> {
  if (!force && lastCheck && Date.now() - lastCheck.at < SIX_HOURS) return Promise.resolve(lastCheck.release);
  if (pending) return pending;
  pending = fetchAndroidRelease()
    .then((release) => {
      lastCheck = { at: Date.now(), release };
      return release;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Test seam: forget the shared release check. */
export function resetAndroidReleaseCheck() {
  lastCheck = null;
  pending = null;
}

/** Installed Android version code, or null off Android and for the side-by-side QA build. */
export function installedAndroidVersionCode(): number | null {
  if (Platform.OS !== "android") return null;
  if (Application.applicationId?.endsWith(".qa")) return null;
  const code = Number.parseInt(Application.nativeBuildVersion ?? "", 10);
  return Number.isInteger(code) ? code : null;
}

/** The newer published release, plus a way to check again now. */
export function useAndroidRelease(): { update: AndroidRelease | null; checkAgain: () => void } {
  const installed = installedAndroidVersionCode();
  const [release, setRelease] = useState<AndroidRelease | null>(lastCheck?.release ?? null);
  const mounted = useRef(true);

  const check = useCallback(
    (force: boolean) => {
      if (installed === null) return;
      loadRelease(force).then(
        (next) => {
          if (mounted.current) setRelease(next);
        },
        () => undefined,
      );
    },
    [installed],
  );

  useEffect(() => {
    mounted.current = true;
    check(false);
    return () => {
      mounted.current = false;
    };
  }, [check]);

  return {
    update: release ? newerAndroidRelease(release, installed) : null,
    checkAgain: () => check(true),
  };
}

/** The published Android release when it is newer than this install; null otherwise or offline. */
export function useAndroidUpdate(): AndroidRelease | null {
  return useAndroidRelease().update;
}
