import type { AndroidRelease } from "./release";

/**
 * Pure rules for the Android in-app update: the download's states, when a background download may
 * start, which files in the updates folder to keep, and whether a finished download is the published
 * APK. lib/app-update/update-controller.ts applies them through the platform adapter.
 */

export type UpdateFailure = "download" | "verify" | "install";

export type UpdatePhase =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "downloading"; release: AndroidRelease; received: number; total: number | null }>
  | Readonly<{ status: "ready"; release: AndroidRelease }>
  | Readonly<{ status: "failed"; release: AndroidRelease; reason: UpdateFailure }>;

export type UpdateEvent =
  | Readonly<{ type: "start"; release: AndroidRelease; received: number; total: number | null }>
  | Readonly<{ type: "progress"; received: number; total: number | null }>
  /** The download stopped without an error (paused off Wi-Fi); its partial file stays for resuming. */
  | Readonly<{ type: "paused" }>
  | Readonly<{ type: "verified"; release: AndroidRelease }>
  | Readonly<{ type: "failed"; release: AndroidRelease; reason: UpdateFailure }>
  /** The file is gone or superseded by a newer release. */
  | Readonly<{ type: "discard" }>;

export const IDLE_PHASE: UpdatePhase = { status: "idle" };

export function nextUpdatePhase(phase: UpdatePhase, event: UpdateEvent): UpdatePhase {
  switch (event.type) {
    case "start":
      // One shared download: a second start while one runs changes nothing.
      if (phase.status === "downloading") return phase;
      return { status: "downloading", release: event.release, received: event.received, total: event.total };
    case "progress":
      if (phase.status !== "downloading") return phase;
      if (phase.received === event.received && phase.total === event.total) return phase;
      return { ...phase, received: event.received, total: event.total };
    case "paused":
      return phase.status === "downloading" ? IDLE_PHASE : phase;
    case "verified":
      return { status: "ready", release: event.release };
    case "failed":
      return { status: "failed", release: event.release, reason: event.reason };
    case "discard":
      return IDLE_PHASE;
  }
}

/** Whole percent downloaded, or null while the total size is unknown. */
export function downloadPercent(received: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((received / total) * 100)));
}

export type NetworkSnapshot = Readonly<{
  type: string;
  isConnected: boolean | null;
  /** Android reports a metered Wi-Fi (a phone hotspot, a capped network) as expensive. */
  isConnectionExpensive: boolean | null;
}>;

/** Only a connected Wi-Fi that Android reports as unmetered. Unknown counts as metered. */
export function isUnmeteredWifi(network: NetworkSnapshot | null): boolean {
  return (
    network !== null &&
    network.type === "wifi" &&
    network.isConnected !== false &&
    network.isConnectionExpensive === false
  );
}

/**
 * Whether a background download starts for the newer release. Never on cellular or metered
 * networks, never twice, and never again after a download that failed verification: that one waits
 * for the user's Try again so a broken file is not fetched on every return to the app.
 */
export function shouldAutoDownload(input: {
  enabled: boolean;
  update: AndroidRelease | null;
  phase: UpdatePhase;
  network: NetworkSnapshot | null;
}): boolean {
  const { enabled, update, phase, network } = input;
  if (!enabled || !update || !isUnmeteredWifi(network)) return false;
  if (phase.status === "idle") return true;
  if (phase.status === "failed") return phase.reason === "download" && phase.release.versionCode === update.versionCode;
  return false;
}

// Files in the updates folder, one set per version code. The APK is written as `<code>.apk.part`.
// After verification `<code>.json` records its release, then the part file becomes `<code>.apk`, so
// an `.apk` with its `.json` is always a verified download.
export const updateFileNames = {
  partial: (versionCode: number) => `${versionCode}.apk.part`,
  ready: (versionCode: number) => `${versionCode}.apk`,
  meta: (versionCode: number) => `${versionCode}.json`,
};

const UPDATE_FILE = /^([1-9]\d{0,9})\.(apk\.part|apk|json)$/;

export type UpdateFileEntry = Readonly<{ name: string; size: number }>;

export type UpdateFilePlan = Readonly<{
  /** File names to delete. */
  remove: string[];
  /** Version code of a verified APK to offer for install. Its `.json` still has to parse. */
  ready: number | null;
  /** A partial download to resume. */
  partial: Readonly<{ versionCode: number; size: number }> | null;
}>;

/**
 * What to keep in the updates folder. Files for the installed version or older, unknown files and
 * empty partials go. Only the newest version's files stay, and once the published release is known,
 * only that release's. A verified APK replaces its partial; an APK or record without the other is an
 * interrupted finish, so the partial (if any) is resumed and verified again.
 */
export function planUpdateFiles(
  entries: readonly UpdateFileEntry[],
  installedVersionCode: number,
  latestVersionCode: number | null,
): UpdateFilePlan {
  const remove: string[] = [];
  const kept: { name: string; size: number; code: number; kind: string }[] = [];
  for (const entry of entries) {
    const match = UPDATE_FILE.exec(entry.name);
    const code = match ? Number(match[1]) : NaN;
    if (!match || code <= installedVersionCode || (latestVersionCode !== null && code !== latestVersionCode)) {
      remove.push(entry.name);
      continue;
    }
    kept.push({ name: entry.name, size: entry.size, code, kind: match[2] });
  }
  const target = kept.reduce<number | null>((max, file) => (max === null || file.code > max ? file.code : max), null);
  const files = new Map<string, { name: string; size: number }>();
  for (const file of kept) {
    if (file.code === target) files.set(file.kind, file);
    else remove.push(file.name);
  }
  if (target === null) return { remove, ready: null, partial: null };

  const apk = files.get("apk");
  const meta = files.get("json");
  const part = files.get("apk.part");
  if (apk && meta) {
    if (part) remove.push(part.name);
    return { remove, ready: target, partial: null };
  }
  if (apk) remove.push(apk.name);
  if (meta) remove.push(meta.name);
  if (part && part.size > 0) return { remove, ready: null, partial: { versionCode: target, size: part.size } };
  if (part) remove.push(part.name);
  return { remove, ready: null, partial: null };
}

export type DownloadResponse = Readonly<{ status: number; headers: Readonly<Record<string, string>> }>;

function header(response: DownloadResponse, name: string): string | undefined {
  const key = Object.keys(response.headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : response.headers[key];
}

/**
 * What the HTTP status means for the file. A resumed download needs 206: a server that ignored the
 * Range header sent the whole APK again, which was appended to the partial file, and 416 means the
 * partial no longer matches. Both restart from an empty file.
 */
export function downloadOutcome(status: number, resumedFrom: number): "ok" | "restart" | "fail" {
  if (resumedFrom > 0) {
    if (status === 206) return "ok";
    if (status === 200 || status === 416) return "restart";
    return "fail";
  }
  return status === 200 ? "ok" : "fail";
}

/**
 * The size the finished file must have: the manifest's size, otherwise the HTTP length. Null when
 * neither is known; Android's signature check still refuses an APK that is not Hafiz's.
 */
export function expectedApkSize(
  release: AndroidRelease,
  response: DownloadResponse | null,
  resumedFrom: number,
): number | null {
  if (release.size !== undefined) return release.size;
  if (!response) return null;
  const range = /\/(\d+)\s*$/.exec(header(response, "content-range") ?? "");
  if (range) return Number(range[1]);
  const length = Number(header(response, "content-length"));
  if (!Number.isSafeInteger(length) || length <= 0) return null;
  if (response.status === 206) return resumedFrom + length;
  return response.status === 200 ? length : null;
}

/** Size and MD5 (computed natively) against what is known. Nothing known passes. */
export function isVerifiedDownload(input: {
  expectedSize: number | null;
  expectedMd5: string | undefined;
  actualSize: number | null;
  actualMd5: string | null | undefined;
}): boolean {
  const { expectedSize, expectedMd5, actualSize, actualMd5 } = input;
  if (actualSize === null || actualSize <= 0) return false;
  if (expectedSize !== null && actualSize !== expectedSize) return false;
  if (expectedMd5 !== undefined && actualMd5?.toLowerCase() !== expectedMd5) return false;
  return true;
}

/** What the Home card and the Settings row show on Android. */
export type UpdateView =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "available"; release: AndroidRelease }>
  | Readonly<{ kind: "downloading"; release: AndroidRelease; percent: number | null }>
  | Readonly<{ kind: "ready"; release: AndroidRelease }>
  | Readonly<{ kind: "failed"; release: AndroidRelease; reason: UpdateFailure }>;

/**
 * A download in any state wins over the published release, so a verified file restored at start
 * offers Install update even before (or without) a successful release check.
 */
export function updateView(phase: UpdatePhase, available: AndroidRelease | null): UpdateView {
  switch (phase.status) {
    case "downloading":
      return { kind: "downloading", release: phase.release, percent: downloadPercent(phase.received, phase.total) };
    case "ready":
      return { kind: "ready", release: phase.release };
    case "failed":
      return { kind: "failed", release: phase.release, reason: phase.reason };
    case "idle":
      return available ? { kind: "available", release: available } : { kind: "none" };
  }
}

/** Whole megabytes (1 MB = 1,000,000 bytes, as Android shows file sizes), at least 1. */
export function megabytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1_000_000));
}
