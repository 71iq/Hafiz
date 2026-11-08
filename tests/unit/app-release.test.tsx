import React from "react";
import { Linking, Platform } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppReleaseCard } from "@/components/app-update/AppReleaseCard";
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
let mockLocale: "en" | "ar" = "en";
jest.mock("@/lib/i18n/useStrings", () => ({
  ...jest.requireActual("@/lib/i18n/useStrings"),
  useStrings: () => jest.requireActual("@/lib/i18n/strings").strings[mockLocale],
}));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => ({ isDark: false, isRTL: mockLocale === "ar" }) }));

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

beforeEach(() => {
  resetAndroidReleaseCheck();
  mockLocale = "en";
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

  it("shows an update on Android when a newer release is published and opens that APK", async () => {
    Platform.OS = "android";
    renderCard();

    fireEvent.press(await screen.findByText(strings[locale].appUpdateButton));
    expect(fetchMock).toHaveBeenCalledWith(ANDROID_RELEASE_MANIFEST_URL, { cache: "no-store" });
    expect(Linking.openURL).toHaveBeenCalledWith("https://hafizquran.app/downloads/android/hafiz-1.0.3-4.apk");
    expect(screen.getByText(strings[locale].appUpdateSubtitle.replace("{{version}}", "1.0.3"))).toBeTruthy();
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
