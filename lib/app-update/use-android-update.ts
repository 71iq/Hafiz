import { useCallback, useEffect } from "react";
import { Platform } from "react-native";
import * as Application from "expo-application";
import { fetchAndroidRelease, newerAndroidRelease, type AndroidRelease } from "./release";
import { getUpdateState, resetUpdateStore, setUpdateState, useUpdateState } from "./update-store";

const SIX_HOURS = 6 * 60 * 60 * 1000;

// One shared check for every screen that shows the update and for the background download,
// refreshed at most every six hours unless the user asks again. Failures (offline, server down)
// leave the last known release.
let pending: Promise<AndroidRelease> | null = null;

/** The published release, from the six-hour cache unless forced. Rejects when it cannot be read. */
export function checkAndroidRelease(force: boolean): Promise<AndroidRelease> {
  const latest = getUpdateState().latest;
  if (!force && latest && Date.now() - latest.at < SIX_HOURS) return Promise.resolve(latest.release);
  if (pending) return pending;
  pending = fetchAndroidRelease()
    .then((release) => {
      setUpdateState((current) => ({ ...current, latest: { at: Date.now(), release } }));
      return release;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Test seam: forget the shared release check and the update state that depends on it. */
export function resetAndroidReleaseCheck() {
  pending = null;
  resetUpdateStore();
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
  const release = useUpdateState((current) => current.latest?.release ?? null);

  const check = useCallback(
    (force: boolean) => {
      if (installed === null) return;
      checkAndroidRelease(force).catch(() => undefined);
    },
    [installed],
  );

  useEffect(() => {
    check(false);
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
