import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { redirectSystemPath } from "@/app/+native-intent";
import { openReminderRoute } from "@/lib/notifications/reminder-route";
import {
  parseWidgetTapPath,
  peekPendingWidgetTap,
  redirectWidgetTapPath,
  resetWidgetTapsForTests,
  takeLaunchWidgetTap,
  useWidgetTaps,
} from "@/lib/widget/tap";

const mockDb = { name: "synthetic" };
let mockPathname = "/";
let mockNavigationKey: string | undefined = "root";

jest.mock("expo-router", () => ({
  usePathname: () => mockPathname,
  useRootNavigationState: () => (mockNavigationKey ? { key: mockNavigationKey } : undefined),
}));
jest.mock("@/lib/database/provider", () => ({ useDatabaseStatus: () => ({ db: mockDb, isReady: true }) }));
jest.mock("@/lib/notifications/reminder-route", () => ({ openReminderRoute: jest.fn(async () => undefined) }));
jest.mock("@/lib/widget/platform", () => ({ widgetPlatform: { supported: true } }));

let mockLaunchUrl: string | null = null;

beforeEach(() => {
  resetWidgetTapsForTests();
  mockLaunchUrl = null;
  jest.spyOn(Linking, "getInitialURL").mockImplementation(async () => mockLaunchUrl);
  jest.mocked(openReminderRoute).mockClear();
  mockPathname = "/";
  mockNavigationKey = "root";
});

describe("parseWidgetTapPath", () => {
  it.each([
    ["hafiz://widget?to=wird", "wird"],
    ["hafiz://widget?to=home", "home"],
    ["hafiz://widget/?to=wird", "wird"],
    ["/widget?to=wird", "wird"],
    ["widget?to=wird", "wird"],
    ["/widget/?to=home", "home"],
    ["hafiz://widget?to=settings", "home"],
    ["hafiz://widget", "home"],
    ["/widget?from=launcher&to=wird", "wird"],
  ])("reads %s as %s", (path, tap) => {
    expect(parseWidgetTapPath(path)).toBe(tap);
  });

  it.each([
    "hafiz://auth/callback",
    "/widgets?to=wird",
    "/hifz/review",
    "hafiz://widget/extra?to=wird",
    "https://hafizquran.app/widget?to=wird",
  ])("ignores %s", (path) => {
    expect(parseWidgetTapPath(path)).toBeNull();
  });
});

describe("redirectWidgetTapPath", () => {
  it("keeps the target and goes to the root entry on a cold start", () => {
    expect(redirectWidgetTapPath("hafiz://widget?to=wird", true)).toBe("/");
    expect(peekPendingWidgetTap()).toBe("wird");
  });

  it("stays where the app is on a warm start", () => {
    expect(redirectWidgetTapPath("hafiz://widget?to=home", false)).toBeNull();
    expect(peekPendingWidgetTap()).toBe("home");
  });

  it("takes the launch link once, whether Expo Router or the app reads it first", () => {
    takeLaunchWidgetTap("hafiz://widget?to=wird");
    expect(peekPendingWidgetTap()).toBe("wird");
    resetWidgetTapsForTests();
    expect(redirectWidgetTapPath("hafiz://widget?to=wird", true)).toBe("/");
    takeLaunchWidgetTap("hafiz://widget?to=home");
    expect(peekPendingWidgetTap()).toBe("wird");
    takeLaunchWidgetTap(null);
    takeLaunchWidgetTap("hafiz://open?surah=18");
    expect(peekPendingWidgetTap()).toBe("wird");
  });

  it("leaves other paths alone", () => {
    expect(redirectWidgetTapPath("/hifz/review", true)).toBeUndefined();
    expect(peekPendingWidgetTap()).toBeNull();
  });
});

describe("redirectSystemPath", () => {
  it("routes widget links and still handles OAuth callbacks", () => {
    expect(redirectSystemPath({ path: "hafiz://widget?to=wird", initial: true })).toBe("/");
    expect(redirectSystemPath({ path: "hafiz://auth/callback#access_token=x", initial: true })).toBe("/(tabs)/home");
    expect(redirectSystemPath({ path: "hafiz://auth/callback", initial: false })).toBeNull();
    expect(redirectSystemPath({ path: "/open?surah=18", initial: true })).toBe("/open?surah=18");
  });
});

describe("useWidgetTaps", () => {
  it("opens the target after the root redirect on a cold start", async () => {
    redirectWidgetTapPath("hafiz://widget?to=wird", true);
    const hook = renderHook(() => useWidgetTaps());
    expect(openReminderRoute).not.toHaveBeenCalled();
    mockPathname = "/home";
    hook.rerender({});
    await waitFor(() => expect(openReminderRoute).toHaveBeenCalledWith(mockDb, "wird"));
    expect(peekPendingWidgetTap()).toBeNull();
  });

  it("opens the launch link when Expo Router gave up on it on a cold start", async () => {
    mockLaunchUrl = "hafiz://widget?to=wird";
    const hook = renderHook(() => useWidgetTaps());
    await waitFor(() => expect(peekPendingWidgetTap()).toBe("wird"));
    mockPathname = "/home";
    hook.rerender({});
    await waitFor(() => expect(openReminderRoute).toHaveBeenCalledWith(mockDb, "wird"));
    expect(openReminderRoute).toHaveBeenCalledTimes(1);
  });

  it("does not open a launch link Expo Router already handled a second time", async () => {
    mockLaunchUrl = "hafiz://widget?to=wird";
    redirectWidgetTapPath("hafiz://widget?to=wird", true);
    mockPathname = "/home";
    renderHook(() => useWidgetTaps());
    await waitFor(() => expect(openReminderRoute).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openReminderRoute).toHaveBeenCalledTimes(1);
    expect(peekPendingWidgetTap()).toBeNull();
  });

  it("opens a warm tap where the app already is", async () => {
    mockPathname = "/settings";
    renderHook(() => useWidgetTaps());
    act(() => {
      redirectWidgetTapPath("hafiz://widget?to=home", false);
    });
    await waitFor(() => expect(openReminderRoute).toHaveBeenCalledWith(mockDb, "home"));
  });

  it("waits for the navigation state", () => {
    mockPathname = "/home";
    mockNavigationKey = undefined;
    redirectWidgetTapPath("hafiz://widget?to=wird", true);
    renderHook(() => useWidgetTaps());
    expect(openReminderRoute).not.toHaveBeenCalled();
    expect(peekPendingWidgetTap()).toBe("wird");
  });

  it.each(["/onboarding", "/flashcards/session", "/hifz/review", "/hifz/sabaq", "/hifz/setup"])(
    "drops the tap on %s",
    (pathname) => {
      mockPathname = pathname;
      redirectWidgetTapPath("hafiz://widget?to=wird", false);
      renderHook(() => useWidgetTaps());
      expect(openReminderRoute).not.toHaveBeenCalled();
      expect(peekPendingWidgetTap()).toBeNull();
    },
  );
});
