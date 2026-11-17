import { useEffect } from "react";
import { AppState } from "react-native";
import { isUnmeteredWifi, updateView, type UpdateView } from "./download-plan";
import {
  applyLatestRelease,
  maybeAutoDownload,
  pauseAutomaticDownload,
  restoreUpdateFiles,
  setUpdateReadyNotice,
} from "./update-controller";
import { appUpdatePlatform } from "./update-platform";
import { useUpdateState } from "./update-store";
import { checkAndroidRelease, useAndroidRelease, installedAndroidVersionCode } from "./use-android-update";

/** The Android update as the Home card and Settings row show it, plus a forced check. */
export function useAppUpdateView(): { view: UpdateView; checkAgain: () => void } {
  const { update, checkAgain } = useAndroidRelease();
  const phase = useUpdateState((current) => current.phase);
  return { view: updateView(phase, update), checkAgain };
}

type ReadyNotice = Parameters<typeof setUpdateReadyNotice>[0];

/**
 * Root lifecycle for the Android update, mounted once. It restores a verified download, checks for a
 * release at start and on every return to the app (six-hour cache), cleans superseded files, and
 * starts the automatic download when the setting allows it: after each check, when the setting is
 * turned on, on return to the app and when unmetered Wi-Fi comes back. Turning the setting off
 * pauses that download.
 */
export function useAppUpdateLifecycle({
  autoDownload,
  settingsLoaded,
  readyNotice,
}: {
  autoDownload: boolean;
  settingsLoaded: boolean;
  readyNotice: ReadyNotice;
}): void {
  const installed = installedAndroidVersionCode();
  const latest = useUpdateState((current) => current.latest?.release ?? null);

  useEffect(() => {
    setUpdateReadyNotice(readyNotice);
  }, [readyNotice]);

  useEffect(() => {
    if (installed === null) return;
    void restoreUpdateFiles();
    const check = () => void checkAndroidRelease(false).catch(() => undefined);
    check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => subscription.remove();
  }, [installed]);

  useEffect(() => {
    if (installed === null) return;
    let cancelled = false;
    void (async () => {
      if (latest) await applyLatestRelease(latest);
      if (cancelled || !settingsLoaded) return;
      if (autoDownload) await maybeAutoDownload(true);
      else pauseAutomaticDownload();
    })();
    return () => {
      cancelled = true;
    };
  }, [installed, latest, settingsLoaded, autoDownload]);

  // A paused or dropped automatic download continues when unmetered Wi-Fi returns or the person
  // comes back to the app (Android suspends Hafiz soon after it leaves the screen), even while the six-hour cache holds the same release.
  useEffect(() => {
    if (installed === null || !settingsLoaded || !autoDownload) return;
    const unsubscribeNetwork = appUpdatePlatform.subscribeNetwork((network) => {
      if (isUnmeteredWifi(network)) void maybeAutoDownload(true);
    });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void maybeAutoDownload(true);
    });
    return () => {
      unsubscribeNetwork();
      subscription.remove();
    };
  }, [installed, settingsLoaded, autoDownload]);
}
