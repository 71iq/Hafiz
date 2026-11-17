import React from "react";
import { Linking, Platform } from "react-native";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAppReleaseRows } from "@/components/app-update/use-app-release-row";
import { resetWebRevision } from "@/lib/app-update/build-info";
import { AppReleaseCard } from "@/components/app-update/AppReleaseCard";
import { AppUpdateHost } from "@/components/app-update/AppUpdateHost";
import { resetUpdateController } from "@/lib/app-update/update-controller";
import { dispatchUpdateEvent, getUpdateState } from "@/lib/app-update/update-store";
import {
  ANDROID_LATEST_APK_URL,
  ANDROID_RELEASE_MANIFEST_URL,
  newerAndroidRelease,
  parseAndroidRelease,
} from "@/lib/app-update/release";
import { strings } from "@/lib/i18n/strings";
import { resetAndroidReleaseCheck } from "@/lib/app-update/use-android-update";

const mockApplication = {
  applicationId: "com.anonymous.hafiz",
  nativeBuildVersion: "3",
  nativeApplicationVersion: "1.0.2",
};
// Getters read the current values; the mock factory runs before this module's constants exist.
jest.mock("expo-application", () => ({
  get applicationId() {
    return mockApplication.applicationId;
  },
  get nativeBuildVersion() {
    return mockApplication.nativeBuildVersion;
  },
  get nativeApplicationVersion() {
    return mockApplication.nativeApplicationVersion;
  },
}));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.0.1" } } }));
let mockLocale: "en" | "ar" = "en";
let mockAutoDownload = false;
jest.mock("@/lib/i18n/useStrings", () => ({
  ...jest.requireActual("@/lib/i18n/useStrings"),
  useStrings: () => jest.requireActual("@/lib/i18n/strings").strings[mockLocale],
}));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    isDark: false,
    isRTL: mockLocale === "ar",
    uiLanguage: mockLocale,
    isLoaded: true,
    autoDownloadUpdates: mockAutoDownload,
    themeColors: { surfaceMid: "#eee" },
  }),
}));

// The Android adapter (file system, installer, network, notifications) is replaced; the controller
// and its rules run for real.
const mockPlatform = {
  supported: true,
  listFiles: jest.fn(async () => []),
  deleteFile: jest.fn(async () => undefined),
  // Only the verified APK exists, so a download starts from the beginning.
  fileInfo: jest.fn(async (name: string) =>
    name.endsWith(".apk") ? { exists: true, size: 1000, md5: null } : { exists: false, size: null, md5: null },
  ),
  readText: jest.fn(async () => ""),
  writeText: jest.fn(async () => undefined),
  moveFile: jest.fn(async () => undefined),
  download: jest.fn(() => ({ result: new Promise(() => undefined), pause: jest.fn(async () => undefined) })),
  launchInstaller: jest.fn(async () => undefined),
  getNetwork: jest.fn(async () => ({ type: "wifi", isConnected: true, isConnectionExpensive: false })),
  subscribeNetwork: jest.fn(() => () => undefined),
  isAppInBackground: jest.fn(() => false),
  notifyUpdateReady: jest.fn(async () => undefined),
};
jest.mock("@/lib/app-update/update-platform", () => ({
  get appUpdatePlatform() {
    return mockPlatform;
  },
}));

const release = {
  versionCode: 4,
  versionName: "1.0.3",
  apk: "/downloads/android/hafiz-1.0.3-4.apk",
  sha256: "a".repeat(64),
};
const originalOS = Platform.OS;
let fetchMock: jest.Mock;

function renderCard() {
  return render(<AppReleaseCard />);
}

function renderWithHost(children?: React.ReactNode) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <AppUpdateHost />
      {children}
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  resetAndroidReleaseCheck();
  resetUpdateController();
  jest.clearAllMocks();
  mockLocale = "en";
  mockAutoDownload = false;
  mockApplication.applicationId = "com.anonymous.hafiz";
  mockApplication.nativeBuildVersion = "3";
  fetchMock = jest.fn(async () => ({ ok: true, json: async () => release }));
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});
afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

describe("Android release manifest", () => {
  it("accepts a same-origin APK and rejects anything else", () => {
    expect(parseAndroidRelease(release)).toEqual(release);
    expect(() => parseAndroidRelease({ ...release, apk: "https://evil.example/hafiz.apk" })).toThrow();
    expect(() => parseAndroidRelease({ ...release, apk: "/downloads/android/../x.apk" })).toThrow();
    expect(() => parseAndroidRelease({ ...release, sha256: "xyz" })).toThrow();
    expect(() => parseAndroidRelease({ ...release, versionCode: 1.5 })).toThrow();
  });

  it("offers only a strictly newer version code", () => {
    expect(newerAndroidRelease(release, 3)).toEqual(release);
    expect(newerAndroidRelease(release, 4)).toBeNull();
    expect(newerAndroidRelease(release, 5)).toBeNull();
    expect(newerAndroidRelease(release, null)).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("app release card (%s)", (locale) => {
  beforeEach(() => {
    mockLocale = locale;
  });

  it("offers the APK download on the web without checking for updates", () => {
    Platform.OS = "web";
    renderCard();

    fireEvent.press(screen.getByText(strings[locale].appDownloadButton));
    expect(Linking.openURL).toHaveBeenCalledWith(ANDROID_LATEST_APK_URL);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads a newer release inside the app on Android and never opens the browser", async () => {
    Platform.OS = "android";
    renderCard();

    expect(await screen.findByText(strings[locale].appUpdateSubtitle.replace("{{version}}", "1.0.3"))).toBeTruthy();
    fireEvent.press(screen.getByText(strings[locale].appUpdateButton));
    expect(fetchMock).toHaveBeenCalledWith(ANDROID_RELEASE_MANIFEST_URL, { cache: "no-store" });
    await waitFor(() =>
      expect(mockPlatform.download).toHaveBeenCalledWith(
        "https://hafizquran.app/downloads/android/hafiz-1.0.3-4.apk",
        "4.apk.part",
        0,
        expect.any(Function),
      ),
    );
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(await screen.findByText(strings[locale].appUpdateDownloadingTitle)).toBeTruthy();
    expect(screen.queryByText(strings[locale].appUpdateButton)).toBeNull();
  });

  it("shows the download size and progress, then Install update", async () => {
    Platform.OS = "android";
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ...release, size: 412_000_000 }) }));
    renderCard();
    const size = locale === "ar" ? "٤١٢ ميغابايت" : "412 MB";
    expect(
      await screen.findByText(
        strings[locale].appUpdateSubtitleSize.replace("{{version}}", "1.0.3").replace("{{size}}", size),
      ),
    ).toBeTruthy();

    act(() => dispatchUpdateEvent({ type: "start", release, received: 420, total: 1000 }));
    const percent = locale === "ar" ? "٤٢٪" : "42%";
    expect(
      screen.getByText(
        strings[locale].appUpdateDownloadingProgress.replace("{{version}}", "1.0.3").replace("{{progress}}", percent),
      ),
    ).toBeTruthy();

    act(() => dispatchUpdateEvent({ type: "verified", release }));
    fireEvent.press(screen.getByText(strings[locale].appUpdateInstallButton));
    await waitFor(() => expect(mockPlatform.launchInstaller).toHaveBeenCalledWith("4.apk"));
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("shows a failure with Try again", async () => {
    Platform.OS = "android";
    renderCard();
    await screen.findByText(strings[locale].appUpdateButton);
    act(() => dispatchUpdateEvent({ type: "failed", release, reason: "verify" }));
    expect(screen.getByText(strings[locale].appUpdateFailedVerify)).toBeTruthy();
    fireEvent.press(screen.getByText(strings[locale].sharedTryAgain));
    await waitFor(() => expect(mockPlatform.download).toHaveBeenCalled());
  });
});

describe("install prompt", () => {
  it("asks to install a verified download; Later keeps Install update reachable", async () => {
    Platform.OS = "android";
    renderWithHost(<AppReleaseCard />);
    act(() => dispatchUpdateEvent({ type: "verified", release }));
    expect(await screen.findByText(strings.en.appUpdateInstallNow)).toBeTruthy();
    expect(screen.getByText(strings.en.appUpdateReadyMessage.replace("{{version}}", "1.0.3"))).toBeTruthy();

    fireEvent.press(screen.getByText(strings.en.appUpdateLater));
    expect(getUpdateState().promptDismissedVersion).toBe(4);
    await waitFor(() => expect(screen.queryByText(strings.en.appUpdateInstallNow)).toBeNull());
    expect(screen.getByText(strings.en.appUpdateInstallButton)).toBeTruthy();
    expect(mockPlatform.launchInstaller).not.toHaveBeenCalled();
  });

  it("Install now opens Android's installer", async () => {
    Platform.OS = "android";
    renderWithHost();
    act(() => dispatchUpdateEvent({ type: "verified", release }));
    fireEvent.press(await screen.findByText(strings.en.appUpdateInstallNow));
    await waitFor(() => expect(mockPlatform.launchInstaller).toHaveBeenCalledWith("4.apk"));
  });

  it("shows the size before a download on a metered network", async () => {
    Platform.OS = "android";
    mockPlatform.getNetwork.mockResolvedValueOnce({ type: "cellular", isConnected: true, isConnectionExpensive: true });
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ...release, size: 412_000_000 }) }));
    renderWithHost(<AppReleaseCard />);
    fireEvent.press(await screen.findByText(strings.en.appUpdateButton));
    expect(
      await screen.findByText(
        strings.en.appUpdateMeteredMessage.replace("{{version}}", "1.0.3").replace("{{size}}", "412 MB"),
      ),
    ).toBeTruthy();
    expect(mockPlatform.download).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText(strings.en.appUpdateDownloadNow));
    await waitFor(() => expect(mockPlatform.download).toHaveBeenCalled());
  });

  it("downloads in the background after the release check when the setting is on", async () => {
    Platform.OS = "android";
    mockAutoDownload = true;
    renderWithHost();
    await waitFor(() =>
      expect(mockPlatform.download).toHaveBeenCalledWith(expect.any(String), "4.apk.part", 0, expect.any(Function)),
    );
    expect(getUpdateState().phase.status).toBe("downloading");
  });

  it("does not download in the background when the setting is off", async () => {
    Platform.OS = "android";
    renderWithHost();
    await waitFor(() => expect(getUpdateState().latest).not.toBeNull());
    await act(async () => undefined);
    expect(mockPlatform.download).not.toHaveBeenCalled();
  });

  it("renders nothing in the side-by-side QA build", () => {
    Platform.OS = "android";
    mockApplication.applicationId = "com.anonymous.hafiz.qa";
    render(<AppUpdateHost />);
    expect(screen.toJSON()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPlatform.listFiles).not.toHaveBeenCalled();
  });
});

it("stays hidden on Android when the installed build is current", async () => {
  Platform.OS = "android";
  mockApplication.nativeBuildVersion = "4";
  renderCard();

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByText(strings.en.appUpdateButton)).toBeNull();
});

it("never checks from the side-by-side QA build", () => {
  Platform.OS = "android";
  mockApplication.applicationId = "com.anonymous.hafiz.qa";
  renderCard();

  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.toJSON()).toBeNull();
});

describe("Settings > About release rows (W14)", () => {
  beforeEach(() => resetWebRevision());

  it("shows the exported web version and revision separately from the latest APK", async () => {
    Platform.OS = "web";
    fetchMock.mockImplementation(async (url: string) =>
      url === "/__release.json"
        ? { ok: true, json: async () => ({ commit: "0123456789abcdef0123456789abcdef01234567" }) }
        : { ok: true, json: async () => release },
    );
    const { result } = renderHook(() => useAppReleaseRows());
    await waitFor(() => expect(result.current[0].description).toBe("Web build 0123456"));
    expect(result.current.map((row) => row.key)).toEqual(["web-version", "apk"]);
    expect(result.current[0].title).toBe("Version 1.0.1");
    // The version line is information, not a button; the APK row opens the download.
    expect(result.current[0].onPress).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalledWith(ANDROID_RELEASE_MANIFEST_URL, expect.anything());
  });

  it("offers Update, then Install update, in the Android row", async () => {
    Platform.OS = "android";
    const { result } = renderHook(() => useAppReleaseRows());
    await waitFor(() => expect(result.current[0].title).toBe(strings.en.appUpdateTitle));
    act(() => result.current[0].onPress?.());
    await waitFor(() => expect(mockPlatform.download).toHaveBeenCalled());
    expect(Linking.openURL).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current[0].title).toBe(strings.en.appUpdateDownloadingTitle));
    expect(result.current[0].onPress).toBeUndefined();

    act(() => dispatchUpdateEvent({ type: "verified", release }));
    expect(result.current[0].title).toBe(strings.en.appUpdateInstallButton);
    act(() => result.current[0].onPress?.());
    await waitFor(() => expect(mockPlatform.launchInstaller).toHaveBeenCalledWith("4.apk"));
  });

  it("shows the installed iOS version without checking for updates", () => {
    Platform.OS = "ios";
    const { result } = renderHook(() => useAppReleaseRows());
    expect(result.current).toHaveLength(1);
    expect(result.current[0].description).toBe("Version 1.0.2");
    expect(result.current[0].onPress).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
