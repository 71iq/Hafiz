import {
  downloadOutcome,
  downloadPercent,
  expectedApkSize,
  isUnmeteredWifi,
  planUpdateFiles,
  shouldAutoDownload,
  updateFileNames,
  type DownloadResponse,
} from "./download-plan";
import { androidReleaseApkUrl, newerAndroidRelease, parseAndroidRelease, type AndroidRelease } from "./release";
import { appUpdatePlatform as platform } from "./update-platform";
import type { UpdateDownloadTask } from "./update-platform-types";
import { dispatchUpdateEvent, getUpdateState, setUpdateState } from "./update-store";
import { installedAndroidVersionCode } from "./use-android-update";

/**
 * The Android in-app update: one shared download into the updates folder, verified before it is
 * offered, then installed through Android's package installer. Web and iOS never reach it, and the
 * side-by-side QA build (no installed version code) does nothing.
 *
 * The download is an ordinary request owned by the app process, so it only moves while Hafiz runs:
 * Android freezes a cached app soon after it leaves the screen (always from Android 14). An
 * interrupted download keeps its partial file and resumes on return to the app or when unmetered
 * Wi-Fi comes back. Keeping it alive in the background would need a foreground service or
 * DownloadManager.
 */

/** How long an automatic download waits after an error before reading the network, so a Wi-Fi loss
 * that broke the socket before NetInfo reported it still counts as a pause. */
const NETWORK_SETTLE_MS = 2000;

type ReadyNotice = (release: AndroidRelease) => Readonly<{ title: string; body: string; channelName: string }>;

let activeRun: Promise<void> | null = null;
let activeTask: UpdateDownloadTask | null = null;
let activeIsAuto = false;
/** Set when an automatic download must stop, including before its request has started. */
let pauseRequested = false;
let activePartial: string | null = null;
let restoring: Promise<void> | null = null;
let installing = false;
let notifiedVersion: number | null = null;
let readyNotice: ReadyNotice | null = null;

const warn = (message: string, error: unknown) => console.warn(`[App update] ${message}:`, error);

/** The localized text for the "Update ready" notification, kept current by the root host. */
export function setUpdateReadyNotice(notice: ReadyNotice | null): void {
  readyNotice = notice;
}

/** The published release when it is newer than this install. */
function availableUpdate(): AndroidRelease | null {
  const latest = getUpdateState().latest?.release ?? null;
  return latest ? newerAndroidRelease(latest, installedAndroidVersionCode()) : null;
}

async function removeFiles(names: readonly string[]): Promise<void> {
  for (const name of names) {
    if (name === activePartial) continue;
    await platform.deleteFile(name).catch((error: unknown) => warn(`Could not delete ${name}`, error));
  }
}

async function matchesApk(
  name: string,
  release: AndroidRelease,
  actualSize: number | null,
  expectedSize: number | null,
): Promise<boolean> {
  if (actualSize === null || actualSize <= 0 || (expectedSize !== null && actualSize !== expectedSize)) return false;
  try {
    return (await platform.sha256(name)) === release.sha256;
  } catch (error) {
    warn("Could not verify the update file", error);
    return false;
  }
}

/**
 * Applies planUpdateFiles: deletes old, unknown and superseded files and restores a verified APK as
 * ready. Once the published release is known, anything for another version goes.
 */
async function reconcileFiles(installed: number, latestCode: number | null): Promise<void> {
  const plan = planUpdateFiles(await platform.listFiles(), installed, latestCode);
  await removeFiles(plan.remove);
  if (plan.ready === null) return;
  const apk = updateFileNames.ready(plan.ready);
  const meta = updateFileNames.meta(plan.ready);
  try {
    const release = parseAndroidRelease(JSON.parse(await platform.readText(meta)));
    if (release.versionCode !== plan.ready) throw new Error("Update record names another version");
    if (getUpdateState().phase.status !== "idle") return;
    if (!(await matchesApk(apk, release, await platform.fileSize(apk), release.size ?? null))) {
      await removeFiles([apk, meta]);
      dispatchUpdateEvent({ type: "failed", release, reason: "verify" });
      return;
    }
    if (getUpdateState().phase.status === "idle") dispatchUpdateEvent({ type: "verified", release });
  } catch (error) {
    warn("Discarding an unreadable update record", error);
    await removeFiles([apk, meta]);
  }
}

/** On app start: clean the updates folder once and restore a verified download. */
export function restoreUpdateFiles(): Promise<void> {
  const installed = installedAndroidVersionCode();
  if (!platform.supported || installed === null) return Promise.resolve();
  restoring ??= reconcileFiles(installed, null).catch((error: unknown) =>
    warn("Could not read the updates folder", error),
  );
  return restoring;
}

/** A new latest.json: drop a download for an older release and its files. */
export async function applyLatestRelease(release: AndroidRelease): Promise<void> {
  const installed = installedAndroidVersionCode();
  if (!platform.supported || installed === null) return;
  await restoreUpdateFiles();
  const { phase } = getUpdateState();
  if (phase.status === "downloading") return;
  if (phase.status !== "idle" && phase.release.versionCode !== release.versionCode) {
    dispatchUpdateEvent({ type: "discard" });
  }
  await reconcileFiles(installed, release.versionCode).catch((error: unknown) =>
    warn("Could not clean the updates folder", error),
  );
}

function notifyIfInBackground(release: AndroidRelease): void {
  if (!readyNotice || notifiedVersion === release.versionCode || !platform.isAppInBackground()) return;
  notifiedVersion = release.versionCode;
  platform
    .notifyUpdateReady(readyNotice(release))
    .catch((error: unknown) => warn("Could not post the notification", error));
}

async function runDownload(release: AndroidRelease): Promise<void> {
  const partial = updateFileNames.partial(release.versionCode);
  activePartial = partial;
  let resumeFrom = (await platform.fileSize(partial)) ?? 0;
  if (release.size !== undefined && resumeFrom > release.size) {
    await platform.deleteFile(partial);
    resumeFrom = 0;
  }
  dispatchUpdateEvent({ type: "start", release, received: resumeFrom, total: release.size ?? null });

  let response: DownloadResponse | null = null;
  const alreadyComplete = release.size !== undefined && resumeFrom === release.size;
  for (let attempt = 0; !alreadyComplete; attempt += 1) {
    if (pauseRequested) {
      dispatchUpdateEvent({ type: "paused" });
      return;
    }
    let shownPercent = downloadPercent(resumeFrom, release.size ?? null);
    activeTask = platform.download(androidReleaseApkUrl(release), partial, resumeFrom, (received, total) => {
      const size = release.size ?? total;
      const percent = downloadPercent(received, size);
      if (percent === shownPercent) return;
      shownPercent = percent;
      dispatchUpdateEvent({ type: "progress", received, total: size });
    });
    response = await activeTask.result;
    if (response === null) {
      dispatchUpdateEvent({ type: "paused" });
      return;
    }
    const outcome = downloadOutcome(response.status, resumeFrom);
    if (outcome === "ok") break;
    // An error page or a doubled file is never kept.
    await platform.deleteFile(partial);
    if (outcome === "restart" && attempt === 0) {
      resumeFrom = 0;
      dispatchUpdateEvent({ type: "progress", received: 0, total: release.size ?? null });
      continue;
    }
    dispatchUpdateEvent({ type: "failed", release, reason: "download" });
    return;
  }

  const size = await platform.fileSize(partial);
  if (!(await matchesApk(partial, release, size, expectedApkSize(release, response, resumeFrom)))) {
    await platform.deleteFile(partial);
    dispatchUpdateEvent({ type: "failed", release, reason: "verify" });
    return;
  }
  await platform.writeText(updateFileNames.meta(release.versionCode), JSON.stringify(release));
  await platform.moveFile(partial, updateFileNames.ready(release.versionCode));
  dispatchUpdateEvent({ type: "verified", release });
  notifyIfInBackground(release);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function partialSize(release: AndroidRelease): Promise<number> {
  return (await platform.fileSize(updateFileNames.partial(release.versionCode))) ?? 0;
}

/**
 * Whether a download that threw stopped for the network rather than failed. An automatic download
 * pauses when unmetered Wi-Fi ended: Android usually breaks the socket before NetInfo reports the
 * change, so after an error the network is read again once it has had time to settle.
 */
async function pausedByNetwork(auto: boolean): Promise<boolean> {
  if (pauseRequested) return true;
  if (!auto) return false;
  if (!isUnmeteredWifi(await platform.getNetwork())) return true;
  await wait(NETWORK_SETTLE_MS);
  return pauseRequested || !isUnmeteredWifi(await platform.getNetwork());
}

/**
 * Runs the download until it finishes, pauses or fails. An automatic download that broke on
 * unmetered Wi-Fi while Hafiz is open (a socket that stalled while Android froze the app) resumes
 * on its own as long as the last attempt added bytes, so a server that keeps failing is not retried
 * in a loop; that waits for the next return to the app or network change, or for Try again.
 */
async function downloadUntilSettled(release: AndroidRelease, auto: boolean): Promise<void> {
  await restoreUpdateFiles();
  for (;;) {
    const before = await partialSize(release);
    try {
      await runDownload(release);
      return;
    } catch (error) {
      // The partial file stays, so a resume, Try again or the next check continues it.
      warn("Download interrupted", error);
      if (await pausedByNetwork(auto)) {
        dispatchUpdateEvent({ type: "paused" });
        return;
      }
      const progressed = (await partialSize(release).catch(() => before)) > before;
      if (auto && progressed && !platform.isAppInBackground()) continue;
      dispatchUpdateEvent({ type: "failed", release, reason: "download" });
      return;
    }
  }
}

/**
 * Starts (or resumes) the download of a release. Every caller shares the one running download. An
 * automatic download pauses when the device leaves unmetered Wi-Fi; its partial file stays.
 */
export function startUpdateDownload(release: AndroidRelease, { auto }: { auto: boolean }): Promise<void> {
  if (!platform.supported || installedAndroidVersionCode() === null) return Promise.resolve();
  if (activeRun) return activeRun;
  const { phase } = getUpdateState();
  if (phase.status === "ready" && phase.release.versionCode === release.versionCode) return Promise.resolve();
  activeIsAuto = auto;
  pauseRequested = false;
  const stopWatching = auto
    ? platform.subscribeNetwork((network) => {
        if (!isUnmeteredWifi(network)) pauseActiveDownload();
      })
    : () => undefined;
  activeRun = downloadUntilSettled(release, auto)
    .catch((error: unknown) => {
      warn("Download failed", error);
      dispatchUpdateEvent({ type: "failed", release, reason: "download" });
    })
    .finally(() => {
      stopWatching();
      activeRun = null;
      activeTask = null;
      activePartial = null;
      activeIsAuto = false;
      pauseRequested = false;
    });
  return activeRun;
}

function pauseActiveDownload(): void {
  pauseRequested = true;
  void activeTask?.pause().catch(() => undefined);
}

/** Turning the setting off pauses a download it started. One the person asked for continues. */
export function pauseAutomaticDownload(): void {
  if (activeIsAuto) pauseActiveDownload();
}

/**
 * The automatic download decision after a release check, on reconnect and when the setting
 * changes: only for a newer release, with the setting on, on unmetered Wi-Fi.
 */
export async function maybeAutoDownload(enabled: boolean): Promise<void> {
  if (!enabled || !platform.supported) return;
  await restoreUpdateFiles();
  const update = availableUpdate();
  if (!update) return;
  const network = await platform.getNetwork();
  if (shouldAutoDownload({ enabled, update, phase: getUpdateState().phase, network })) {
    void startUpdateDownload(update, { auto: true });
  }
}

/**
 * Update pressed in the Home card or Settings. On a metered or unknown network the size is shown
 * first (meteredConfirm); offline it starts and fails into Try again.
 */
export async function requestUpdateDownload(release: AndroidRelease): Promise<void> {
  if (activeRun) return;
  const network = await platform.getNetwork();
  if (network?.isConnected === false || isUnmeteredWifi(network)) {
    void startUpdateDownload(release, { auto: false });
    return;
  }
  setUpdateState((current) => ({ ...current, meteredConfirm: release }));
}

export function confirmMeteredDownload(): void {
  const release = getUpdateState().meteredConfirm;
  setUpdateState((current) => ({ ...current, meteredConfirm: null }));
  if (release) void startUpdateDownload(release, { auto: false });
}

export function cancelMeteredDownload(): void {
  setUpdateState((current) => (current.meteredConfirm ? { ...current, meteredConfirm: null } : current));
}

/** Later on the install prompt: hidden for this version until the next launch. */
export function dismissInstallPrompt(): void {
  const { phase } = getUpdateState();
  if (phase.status !== "ready") return;
  const version = phase.release.versionCode;
  setUpdateState((current) => ({ ...current, promptDismissedVersion: version }));
}

/**
 * Opens Android's installer for the verified APK. Returning to Hafiz means it was not installed (the
 * person cancelled or first has to allow installs from Hafiz), so the ready state stays.
 */
export async function installUpdate(): Promise<void> {
  const { phase } = getUpdateState();
  if (phase.status !== "ready" || installing) return;
  const { release } = phase;
  dismissInstallPrompt();
  installing = true;
  try {
    const apk = updateFileNames.ready(release.versionCode);
    const size = await platform.fileSize(apk);
    if (size === null) {
      // Android cleared the cache folder; Try again downloads it again.
      await removeFiles([updateFileNames.meta(release.versionCode)]);
      dispatchUpdateEvent({ type: "failed", release, reason: "download" });
      return;
    }
    const verified = await matchesApk(apk, release, size, release.size ?? null);
    if (getUpdateState().phase !== phase) return;
    if (!verified) {
      await removeFiles([apk, updateFileNames.meta(release.versionCode)]);
      dispatchUpdateEvent({ type: "failed", release, reason: "verify" });
      return;
    }
    await platform.launchInstaller(apk);
  } catch (error) {
    warn("Could not open the installer", error);
    dispatchUpdateEvent({ type: "failed", release, reason: "install" });
  } finally {
    installing = false;
  }
}

/** Try again after a failure: reopen the installer for a kept file, otherwise download again. */
export async function retryUpdate(): Promise<void> {
  const { phase } = getUpdateState();
  if (phase.status !== "failed") return;
  if (phase.reason === "install") {
    dispatchUpdateEvent({ type: "verified", release: phase.release });
    await installUpdate();
    return;
  }
  await requestUpdateDownload(phase.release);
}

/** Test seam: forget the running download and the per-launch flags. */
export function resetUpdateController(): void {
  activeRun = null;
  activeTask = null;
  activeIsAuto = false;
  pauseRequested = false;
  activePartial = null;
  restoring = null;
  installing = false;
  notifiedVersion = null;
  readyNotice = null;
}
