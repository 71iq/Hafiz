import { Platform } from "react-native";
import type { DownloadResponse, NetworkSnapshot } from "@/lib/app-update/download-plan";
import type { AndroidRelease } from "@/lib/app-update/release";
import {
  confirmMeteredDownload,
  dismissInstallPrompt,
  installUpdate,
  maybeAutoDownload,
  requestUpdateDownload,
  resetUpdateController,
  restoreUpdateFiles,
  retryUpdate,
  setUpdateReadyNotice,
  startUpdateDownload,
} from "@/lib/app-update/update-controller";
import { getUpdateState, setUpdateState } from "@/lib/app-update/update-store";
import { resetAndroidReleaseCheck } from "@/lib/app-update/use-android-update";

jest.mock("expo-application", () => ({ applicationId: "com.anonymous.hafiz", nativeBuildVersion: "3" }));

type FakeFile = { size: number; md5: string; text?: string };
type FakeDownload = {
  url: string;
  name: string;
  resumeFrom: number;
  onProgress: (received: number, total: number | null) => void;
  resolve: (response: DownloadResponse | null) => void;
  reject: (error: Error) => void;
  pause: jest.Mock;
};

const mockFiles = new Map<string, FakeFile>();
const mockDownloads: FakeDownload[] = [];
const mockNetworkListeners = new Set<(network: NetworkSnapshot) => void>();
let mockNetwork: NetworkSnapshot | null = null;
const mockPlatform = {
  supported: true,
  listFiles: jest.fn(async () => [...mockFiles].map(([name, file]) => ({ name, size: file.size }))),
  deleteFile: jest.fn(async (name: string) => void mockFiles.delete(name)),
  fileInfo: jest.fn(async (name: string, { md5 }: { md5: boolean }) => {
    const file = mockFiles.get(name);
    return file
      ? { exists: true, size: file.size, md5: md5 ? file.md5 : null }
      : { exists: false, size: null, md5: null };
  }),
  readText: jest.fn(async (name: string) => mockFiles.get(name)?.text ?? ""),
  writeText: jest.fn(
    async (name: string, text: string) => void mockFiles.set(name, { size: text.length, md5: "", text }),
  ),
  moveFile: jest.fn(async (from: string, to: string) => {
    mockFiles.set(to, mockFiles.get(from)!);
    mockFiles.delete(from);
  }),
  download: jest.fn(
    (url: string, name: string, resumeFrom: number, onProgress: (received: number, total: number | null) => void) => {
      let resolve!: (response: DownloadResponse | null) => void;
      let reject!: (error: Error) => void;
      const result = new Promise<DownloadResponse | null>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const pause = jest.fn(async () => resolve(null));
      mockDownloads.push({ url, name, resumeFrom, onProgress, resolve, reject, pause });
      return { result, pause };
    },
  ),
  launchInstaller: jest.fn(async () => undefined),
  getNetwork: jest.fn(async () => mockNetwork),
  subscribeNetwork: jest.fn((listener: (network: NetworkSnapshot) => void) => {
    mockNetworkListeners.add(listener);
    return () => void mockNetworkListeners.delete(listener);
  }),
  isAppInBackground: jest.fn(() => false),
  notifyUpdateReady: jest.fn(async () => undefined),
};
jest.mock("@/lib/app-update/update-platform", () => ({
  get appUpdatePlatform() {
    return mockPlatform;
  },
}));

const WIFI: NetworkSnapshot = { type: "wifi", isConnected: true, isConnectionExpensive: false };
const CELLULAR: NetworkSnapshot = { type: "cellular", isConnected: true, isConnectionExpensive: true };
const MD5 = "0123456789abcdef0123456789abcdef";
const release: AndroidRelease = {
  versionCode: 4,
  versionName: "1.0.3",
  apk: "/downloads/android/hafiz-1.0.3-4.apk",
  sha256: "a".repeat(64),
  size: 1000,
  md5: MD5,
};
const APK_URL = "https://hafizquran.app/downloads/android/hafiz-1.0.3-4.apk";
const originalOS = Platform.OS;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const phase = () => getUpdateState().phase;

/** Writes the body the server sent and finishes the download. */
async function finish(index: number, { bytes, md5 = MD5, status }: { bytes: number; md5?: string; status?: number }) {
  await flush();
  const download = mockDownloads[index];
  const previous = download.resumeFrom > 0 ? (mockFiles.get(download.name)?.size ?? 0) : 0;
  mockFiles.set(download.name, { size: previous + bytes, md5 });
  download.resolve({ status: status ?? (download.resumeFrom > 0 ? 206 : 200), headers: {} });
  await flush();
}

beforeEach(() => {
  Platform.OS = "android";
  resetAndroidReleaseCheck();
  resetUpdateController();
  mockFiles.clear();
  mockDownloads.length = 0;
  mockNetworkListeners.clear();
  mockNetwork = WIFI;
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  setUpdateState((current) => ({ ...current, latest: { at: Date.now(), release } }));
});
afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

describe("in-app download", () => {
  it("downloads the manifest's APK with progress, verifies it and marks it ready", async () => {
    const run = startUpdateDownload(release, { auto: false });
    await flush();
    expect(mockPlatform.download).toHaveBeenCalledWith(APK_URL, "4.apk.part", 0, expect.any(Function));
    expect(phase()).toEqual({ status: "downloading", release, received: 0, total: 1000 });

    mockDownloads[0].onProgress(420, 1000);
    expect(phase()).toMatchObject({ status: "downloading", received: 420, total: 1000 });

    await finish(0, { bytes: 1000 });
    await run;
    expect(mockPlatform.fileInfo).toHaveBeenCalledWith("4.apk.part", { md5: true });
    expect(phase()).toEqual({ status: "ready", release });
    expect([...mockFiles.keys()].sort()).toEqual(["4.apk", "4.json"]);
    expect(JSON.parse(mockFiles.get("4.json")!.text!)).toEqual(release);
  });

  it("shares one download between callers", async () => {
    const first = startUpdateDownload(release, { auto: false });
    const second = startUpdateDownload(release, { auto: true });
    expect(second).toBe(first);
    await finish(0, { bytes: 1000 });
    await first;
    expect(mockPlatform.download).toHaveBeenCalledTimes(1);
  });

  it("deletes a file whose MD5 or size differs and shows the failure", async () => {
    const run = startUpdateDownload(release, { auto: false });
    await finish(0, { bytes: 1000, md5: "f".repeat(32) });
    await run;
    expect(phase()).toEqual({ status: "failed", release, reason: "verify" });
    expect(mockFiles.size).toBe(0);
  });

  it("verifies against the HTTP size when the manifest has no size or md5", async () => {
    const plain: AndroidRelease = { ...release, size: undefined, md5: undefined };
    const run = startUpdateDownload(plain, { auto: false });
    await flush();
    mockFiles.set("4.apk.part", { size: 999, md5: "" });
    mockDownloads[0].resolve({ status: 200, headers: { "Content-Length": "1000" } });
    await run;
    expect(mockPlatform.fileInfo).toHaveBeenLastCalledWith("4.apk.part", { md5: false });
    expect(phase()).toEqual({ status: "failed", release: plain, reason: "verify" });
  });

  it("resumes a partial file and starts over when the server ignores the range", async () => {
    mockFiles.set("4.apk.part", { size: 400, md5: "" });
    const run = startUpdateDownload(release, { auto: false });
    await flush();
    expect(mockDownloads[0].resumeFrom).toBe(400);
    expect(phase()).toMatchObject({ received: 400, total: 1000 });

    await finish(0, { bytes: 1000, status: 200 });
    expect(mockDownloads[1].resumeFrom).toBe(0);
    await finish(1, { bytes: 1000 });
    await run;
    expect(phase()).toEqual({ status: "ready", release });
  });

  it("keeps the partial file after a dropped connection so Try again resumes it", async () => {
    const run = startUpdateDownload(release, { auto: false });
    await flush();
    mockFiles.set("4.apk.part", { size: 300, md5: "" });
    mockDownloads[0].reject(new Error("socket closed"));
    await run;
    expect(phase()).toEqual({ status: "failed", release, reason: "download" });
    expect(mockFiles.has("4.apk.part")).toBe(true);

    await retryUpdate();
    await flush();
    expect(mockDownloads[1].resumeFrom).toBe(300);
  });

  it("deletes an error page instead of keeping it", async () => {
    const run = startUpdateDownload(release, { auto: false });
    await finish(0, { bytes: 120, status: 404 });
    await run;
    expect(phase()).toEqual({ status: "failed", release, reason: "download" });
    expect(mockFiles.size).toBe(0);
  });
});

describe("app start", () => {
  it("restores a verified download and deletes files for installed or older versions", async () => {
    mockFiles.set("4.apk", { size: 1000, md5: MD5 });
    mockFiles.set("4.json", { size: 1, md5: "", text: JSON.stringify(release) });
    mockFiles.set("3.apk", { size: 1000, md5: "" });
    mockFiles.set("3.json", { size: 1, md5: "", text: "{}" });
    mockFiles.set("2.apk.part", { size: 10, md5: "" });
    await restoreUpdateFiles();
    expect(phase()).toEqual({ status: "ready", release });
    expect([...mockFiles.keys()].sort()).toEqual(["4.apk", "4.json"]);
  });

  it("discards a verified APK whose record cannot be read", async () => {
    mockFiles.set("4.apk", { size: 1000, md5: MD5 });
    mockFiles.set("4.json", { size: 1, md5: "", text: "not json" });
    await restoreUpdateFiles();
    expect(phase()).toEqual({ status: "idle" });
    expect(mockFiles.size).toBe(0);
  });
});

describe("install", () => {
  async function readyRelease() {
    const run = startUpdateDownload(release, { auto: false });
    await finish(0, { bytes: 1000 });
    await run;
  }

  it("opens Android's installer and keeps the ready state when it returns", async () => {
    await readyRelease();
    await installUpdate();
    expect(mockPlatform.launchInstaller).toHaveBeenCalledWith("4.apk");
    expect(phase()).toEqual({ status: "ready", release });
    // Installing from the prompt or the card closes the prompt for this launch.
    expect(getUpdateState().promptDismissedVersion).toBe(4);
    await installUpdate();
    expect(mockPlatform.launchInstaller).toHaveBeenCalledTimes(2);
  });

  it("shows a failure when the installer cannot open, and Try again opens it again", async () => {
    await readyRelease();
    mockPlatform.launchInstaller.mockRejectedValueOnce(new Error("No activity"));
    await installUpdate();
    expect(phase()).toEqual({ status: "failed", release, reason: "install" });
    await retryUpdate();
    expect(mockPlatform.launchInstaller).toHaveBeenCalledTimes(2);
    expect(phase()).toEqual({ status: "ready", release });
  });

  it("downloads again when Android cleared the file", async () => {
    await readyRelease();
    mockFiles.delete("4.apk");
    await installUpdate();
    expect(mockPlatform.launchInstaller).not.toHaveBeenCalled();
    expect(phase()).toEqual({ status: "failed", release, reason: "download" });
  });

  it("Later hides the prompt for that version only", async () => {
    await readyRelease();
    dismissInstallPrompt();
    expect(getUpdateState().promptDismissedVersion).toBe(4);
    expect(phase()).toEqual({ status: "ready", release });
  });

  it("posts one ready notification only while Hafiz is in the background", async () => {
    setUpdateReadyNotice((ready) => ({ title: "Update ready", body: ready.versionName, channelName: "App updates" }));
    mockPlatform.isAppInBackground.mockReturnValue(true);
    await readyRelease();
    expect(mockPlatform.notifyUpdateReady).toHaveBeenCalledWith({
      title: "Update ready",
      body: "1.0.3",
      channelName: "App updates",
    });
    mockPlatform.isAppInBackground.mockReturnValue(false);
  });

  it("does not notify while Hafiz is open", async () => {
    setUpdateReadyNotice(() => ({ title: "t", body: "b", channelName: "c" }));
    await readyRelease();
    expect(mockPlatform.notifyUpdateReady).not.toHaveBeenCalled();
  });
});

describe("network rules", () => {
  it("downloads in the background only on unmetered Wi-Fi and pauses when that ends", async () => {
    mockNetwork = CELLULAR;
    await maybeAutoDownload(true);
    expect(mockPlatform.download).not.toHaveBeenCalled();

    mockNetwork = WIFI;
    await maybeAutoDownload(false);
    expect(mockPlatform.download).not.toHaveBeenCalled();

    await maybeAutoDownload(true);
    await flush();
    expect(mockPlatform.download).toHaveBeenCalledTimes(1);
    for (const listener of mockNetworkListeners) listener(CELLULAR);
    await flush();
    expect(mockDownloads[0].pause).toHaveBeenCalled();
    expect(phase()).toEqual({ status: "idle" });
  });

  it("does not start a background download when Wi-Fi ends before the request", async () => {
    const run = startUpdateDownload(release, { auto: true });
    for (const listener of mockNetworkListeners) listener(CELLULAR);
    await run;
    expect(mockPlatform.download).not.toHaveBeenCalled();
    expect(phase()).toEqual({ status: "idle" });
  });

  it("does not download in the background when the installed build is current", async () => {
    setUpdateState((current) => ({ ...current, latest: { at: Date.now(), release: { ...release, versionCode: 3 } } }));
    await maybeAutoDownload(true);
    expect(mockPlatform.download).not.toHaveBeenCalled();
  });

  it("asks before a manual download on a metered network", async () => {
    mockNetwork = CELLULAR;
    await requestUpdateDownload(release);
    expect(getUpdateState().meteredConfirm).toEqual(release);
    expect(mockPlatform.download).not.toHaveBeenCalled();

    confirmMeteredDownload();
    await flush();
    expect(getUpdateState().meteredConfirm).toBeNull();
    expect(mockPlatform.download).toHaveBeenCalledTimes(1);
    // A download the person asked for is not paused by the network watcher.
    expect(mockNetworkListeners.size).toBe(0);
  });

  it("starts a manual download on unmetered Wi-Fi without asking", async () => {
    await requestUpdateDownload(release);
    await flush();
    expect(getUpdateState().meteredConfirm).toBeNull();
    expect(mockPlatform.download).toHaveBeenCalledTimes(1);
  });
});
