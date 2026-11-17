import {
  IDLE_PHASE,
  downloadOutcome,
  downloadPercent,
  expectedApkSize,
  isUnmeteredWifi,
  isVerifiedDownload,
  nextUpdatePhase,
  planUpdateFiles,
  shouldAutoDownload,
  updateView,
  type NetworkSnapshot,
  type UpdatePhase,
} from "@/lib/app-update/download-plan";
import { parseAndroidRelease, type AndroidRelease } from "@/lib/app-update/release";

const release: AndroidRelease = {
  versionCode: 4,
  versionName: "1.0.3",
  apk: "/downloads/android/hafiz-1.0.3-4.apk",
  sha256: "a".repeat(64),
};
const withIntegrity: AndroidRelease = { ...release, size: 1000, md5: "0123456789abcdef0123456789abcdef" };
const wifi: NetworkSnapshot = { type: "wifi", isConnected: true, isConnectionExpensive: false };

describe("release manifest integrity fields", () => {
  it("accepts manifests with and without size and md5", () => {
    expect(parseAndroidRelease(release)).toEqual(release);
    expect(parseAndroidRelease(withIntegrity)).toEqual(withIntegrity);
  });

  it("rejects malformed size and md5", () => {
    expect(() => parseAndroidRelease({ ...release, size: 0 })).toThrow();
    expect(() => parseAndroidRelease({ ...release, size: 1.5 })).toThrow();
    expect(() => parseAndroidRelease({ ...release, md5: "ABC" })).toThrow();
    expect(() => parseAndroidRelease({ ...release, md5: "0".repeat(31) })).toThrow();
  });
});

describe("update states", () => {
  it("moves idle → downloading → ready, and keeps one download", () => {
    const downloading = nextUpdatePhase(IDLE_PHASE, { type: "start", release, received: 0, total: 1000 });
    expect(downloading).toEqual({ status: "downloading", release, received: 0, total: 1000 });
    expect(nextUpdatePhase(downloading, { type: "start", release: withIntegrity, received: 5, total: 5 })).toBe(
      downloading,
    );
    const progressed = nextUpdatePhase(downloading, { type: "progress", received: 500, total: 1000 });
    expect(progressed).toEqual({ status: "downloading", release, received: 500, total: 1000 });
    expect(nextUpdatePhase(progressed, { type: "progress", received: 500, total: 1000 })).toBe(progressed);
    expect(nextUpdatePhase(progressed, { type: "verified", release })).toEqual({ status: "ready", release });
  });

  it("pauses back to idle, fails with a reason and discards", () => {
    const downloading: UpdatePhase = { status: "downloading", release, received: 1, total: null };
    expect(nextUpdatePhase(downloading, { type: "paused" })).toBe(IDLE_PHASE);
    const ready: UpdatePhase = { status: "ready", release };
    expect(nextUpdatePhase(ready, { type: "paused" })).toBe(ready);
    expect(nextUpdatePhase(ready, { type: "progress", received: 1, total: 1 })).toBe(ready);
    expect(nextUpdatePhase(downloading, { type: "failed", release, reason: "verify" })).toEqual({
      status: "failed",
      release,
      reason: "verify",
    });
    expect(nextUpdatePhase(ready, { type: "discard" })).toBe(IDLE_PHASE);
  });

  it("reports whole percent only with a known total", () => {
    expect(downloadPercent(0, 1000)).toBe(0);
    expect(downloadPercent(499, 1000)).toBe(49);
    expect(downloadPercent(1200, 1000)).toBe(100);
    expect(downloadPercent(10, null)).toBeNull();
  });

  it("lets a download state win over the published release in the view", () => {
    expect(updateView(IDLE_PHASE, null)).toEqual({ kind: "none" });
    expect(updateView(IDLE_PHASE, release)).toEqual({ kind: "available", release });
    expect(updateView({ status: "downloading", release, received: 250, total: 1000 }, release)).toEqual({
      kind: "downloading",
      release,
      percent: 25,
    });
    expect(updateView({ status: "ready", release }, null)).toEqual({ kind: "ready", release });
    expect(updateView({ status: "failed", release, reason: "install" }, release)).toEqual({
      kind: "failed",
      release,
      reason: "install",
    });
  });
});

describe("automatic download decision", () => {
  it("needs the setting, a newer release and unmetered Wi-Fi", () => {
    expect(shouldAutoDownload({ enabled: true, update: release, phase: IDLE_PHASE, network: wifi })).toBe(true);
    expect(shouldAutoDownload({ enabled: false, update: release, phase: IDLE_PHASE, network: wifi })).toBe(false);
    expect(shouldAutoDownload({ enabled: true, update: null, phase: IDLE_PHASE, network: wifi })).toBe(false);
  });

  it("never runs on cellular, metered or unknown networks", () => {
    const cellular: NetworkSnapshot = { type: "cellular", isConnected: true, isConnectionExpensive: true };
    const hotspot: NetworkSnapshot = { ...wifi, isConnectionExpensive: true };
    const unknown: NetworkSnapshot = { ...wifi, isConnectionExpensive: null };
    const offline: NetworkSnapshot = { ...wifi, isConnected: false };
    for (const network of [cellular, hotspot, unknown, offline, null]) {
      expect(isUnmeteredWifi(network)).toBe(false);
      expect(shouldAutoDownload({ enabled: true, update: release, phase: IDLE_PHASE, network })).toBe(false);
    }
  });

  it("resumes after a dropped download but not after a bad file, and never twice", () => {
    const input = { enabled: true, update: release, network: wifi };
    expect(shouldAutoDownload({ ...input, phase: { status: "failed", release, reason: "download" } })).toBe(true);
    expect(shouldAutoDownload({ ...input, phase: { status: "failed", release, reason: "verify" } })).toBe(false);
    expect(shouldAutoDownload({ ...input, phase: { status: "downloading", release, received: 0, total: null } })).toBe(
      false,
    );
    expect(shouldAutoDownload({ ...input, phase: { status: "ready", release } })).toBe(false);
  });
});

describe("updates folder cleanup", () => {
  const file = (name: string, size = 10) => ({ name, size });

  it("restores a verified APK and drops its partial", () => {
    expect(planUpdateFiles([file("4.apk"), file("4.json"), file("4.apk.part")], 3, null)).toEqual({
      remove: ["4.apk.part"],
      ready: 4,
      partial: null,
    });
  });

  it("deletes files at or below the installed version, unknown files and superseded versions", () => {
    const plan = planUpdateFiles(
      [file("3.apk"), file("3.json"), file("2.apk.part"), file("notes.txt"), file("4.apk.part"), file("5.apk.part")],
      3,
      null,
    );
    expect(plan.remove.sort()).toEqual(["2.apk.part", "3.apk", "3.json", "4.apk.part", "notes.txt"]);
    expect(plan).toMatchObject({ ready: null, partial: { versionCode: 5, size: 10 } });
  });

  it("keeps only the published release once it is known", () => {
    const plan = planUpdateFiles([file("5.apk"), file("5.json"), file("6.apk.part")], 3, 5);
    expect(plan).toEqual({ remove: ["6.apk.part"], ready: 5, partial: null });
  });

  it("treats an APK or record without the other as unverified and resumes the partial", () => {
    expect(planUpdateFiles([file("4.json"), file("4.apk.part", 700)], 3, 4)).toEqual({
      remove: ["4.json"],
      ready: null,
      partial: { versionCode: 4, size: 700 },
    });
    expect(planUpdateFiles([file("4.apk"), file("4.apk.part", 0)], 3, null)).toEqual({
      remove: ["4.apk", "4.apk.part"],
      ready: null,
      partial: null,
    });
  });
});

describe("download response and verification", () => {
  it("requires 206 when resuming and restarts when the server ignored the range", () => {
    expect(downloadOutcome(200, 0)).toBe("ok");
    expect(downloadOutcome(404, 0)).toBe("fail");
    expect(downloadOutcome(206, 500)).toBe("ok");
    expect(downloadOutcome(200, 500)).toBe("restart");
    expect(downloadOutcome(416, 500)).toBe("restart");
    expect(downloadOutcome(500, 500)).toBe("fail");
  });

  it("expects the manifest size, otherwise the HTTP length", () => {
    expect(expectedApkSize(withIntegrity, { status: 200, headers: { "Content-Length": "5" } }, 0)).toBe(1000);
    expect(expectedApkSize(release, { status: 200, headers: { "Content-Length": "900" } }, 0)).toBe(900);
    expect(expectedApkSize(release, { status: 206, headers: { "content-length": "400" } }, 500)).toBe(900);
    expect(
      expectedApkSize(
        release,
        { status: 206, headers: { "Content-Range": "bytes 500-899/900", "Content-Length": "400" } },
        500,
      ),
    ).toBe(900);
    expect(expectedApkSize(release, { status: 200, headers: {} }, 0)).toBeNull();
    expect(expectedApkSize(release, null, 0)).toBeNull();
  });

  it("checks size and the native MD5 against what is known", () => {
    const md5 = withIntegrity.md5;
    expect(isVerifiedDownload({ expectedSize: 1000, expectedMd5: md5, actualSize: 1000, actualMd5: md5 })).toBe(true);
    expect(
      isVerifiedDownload({ expectedSize: 1000, expectedMd5: md5, actualSize: 1000, actualMd5: md5?.toUpperCase() }),
    ).toBe(true);
    expect(isVerifiedDownload({ expectedSize: 1000, expectedMd5: md5, actualSize: 999, actualMd5: md5 })).toBe(false);
    expect(
      isVerifiedDownload({ expectedSize: 1000, expectedMd5: md5, actualSize: 1000, actualMd5: "f".repeat(32) }),
    ).toBe(false);
    expect(isVerifiedDownload({ expectedSize: null, expectedMd5: undefined, actualSize: 1, actualMd5: null })).toBe(
      true,
    );
    expect(isVerifiedDownload({ expectedSize: null, expectedMd5: undefined, actualSize: 0, actualMd5: null })).toBe(
      false,
    );
  });
});
