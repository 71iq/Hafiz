import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { redirectSystemPath } from "@/app/+native-intent";
import { openEntryRoute } from "@/lib/navigation/entry-route";
import {
  consumePendingWidgetTap,
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

const mockContainer = { getRootState: () => ({ index: 0, routes: [{ key: "expo-root", name: "__root" }] }) };
jest.mock("expo-router", () => ({
  usePathname: () => mockPathname,
  useRootNavigationState: () => (mockNavigationKey ? { key: mockNavigationKey } : undefined),
  useNavigationContainerRef: () => mockContainer,
}));
jest.mock("@/lib/database/provider", () => ({ useDatabaseStatus: () => ({ db: mockDb, isReady: true }) }));
jest.mock("@/lib/navigation/entry-route", () => ({ openEntryRoute: jest.fn(async () => undefined) }));
jest.mock("@/lib/widget/platform", () => ({ widgetPlatform: { supported: true } }));

let mockLaunchUrl: string | null = null;
/** Clears a pending tap the way a handled tap does, without the hook. */
function setPendingNull() {
  consumePendingWidgetTap();
}

beforeEach(() => {
  resetWidgetTapsForTests();
  mockLaunchUrl = null;
  jest.spyOn(Linking, "getInitialURL").mockImplementation(async () => mockLaunchUrl);
  jest.mocked(openEntryRoute).mockClear();
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

  it("takes each numbered launch once, so a new launch in a living process still opens", () => {
    expect(redirectWidgetTapPath("hafiz://widget?to=wird&launch=101", true)).toBe("/");
    expect(peekPendingWidgetTap()).toBe("wird");
    takeLaunchWidgetTap("hafiz://widget?to=wird&launch=101");
    expect(peekPendingWidgetTap()).toBe("wird");
    // The same launch read again by the other reader is not a second tap.
    setPendingNull();
    takeLaunchWidgetTap("hafiz://widget?to=wird&launch=101");
    expect(peekPendingWidgetTap()).toBeNull();
    // A later launch has a new number.
    takeLaunchWidgetTap("hafiz://widget?to=home&launch=202");
    expect(peekPendingWidgetTap()).toBe("home");
  });

  it("takes a numbered warm tap once, even when the launch link of the same tap is read later", () => {
    expect(redirectWidgetTapPath("hafiz://widget?to=wird&launch=303", false)).toBeNull();
    expect(peekPendingWidgetTap()).toBe("wird");
    setPendingNull();
    takeLaunchWidgetTap("hafiz://widget?to=wird&launch=303");
    expect(peekPendingWidgetTap()).toBeNull();
    // An unnumbered warm link (a build before the numbers) opens each time, as before.
    redirectWidgetTapPath("hafiz://widget?to=home", false);
    expect(peekPendingWidgetTap()).toBe("home");
  });

  it("opens nothing for a launch whose link MainActivity cleared, as after a replay from Recents", () => {
    takeLaunchWidgetTap(null);
    expect(peekPendingWidgetTap()).toBeNull();
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
    expect(openEntryRoute).not.toHaveBeenCalled();
    mockPathname = "/home";
    hook.rerender({});
    await waitFor(() =>
      expect(openEntryRoute).toHaveBeenCalledWith(mockDb, "wird", { pathname: "/home", getRootState: expect.any(Function) }),
    );
    expect(peekPendingWidgetTap()).toBeNull();
  });

  it("opens the launch link when Expo Router gave up on it on a cold start", async () => {
    mockLaunchUrl = "hafiz://widget?to=wird";
    const hook = renderHook(() => useWidgetTaps());
    await waitFor(() => expect(peekPendingWidgetTap()).toBe("wird"));
    mockPathname = "/home";
    hook.rerender({});
    await waitFor(() => expect(openEntryRoute).toHaveBeenCalledWith(mockDb, "wird", expect.anything()));
    expect(openEntryRoute).toHaveBeenCalledTimes(1);
  });

  it("does not open a launch link Expo Router already handled a second time", async () => {
    mockLaunchUrl = "hafiz://widget?to=wird";
    redirectWidgetTapPath("hafiz://widget?to=wird", true);
    mockPathname = "/home";
    renderHook(() => useWidgetTaps());
    await waitFor(() => expect(openEntryRoute).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openEntryRoute).toHaveBeenCalledTimes(1);
    expect(peekPendingWidgetTap()).toBeNull();
  });

  it("opens a warm tap where the app already is", async () => {
    mockPathname = "/settings";
    renderHook(() => useWidgetTaps());
    act(() => {
      redirectWidgetTapPath("hafiz://widget?to=home", false);
    });
    await waitFor(() =>
      expect(openEntryRoute).toHaveBeenCalledWith(mockDb, "home", { pathname: "/settings", getRootState: expect.any(Function) }),
    );
  });

  it("waits for the navigation state", () => {
    mockPathname = "/home";
    mockNavigationKey = undefined;
    redirectWidgetTapPath("hafiz://widget?to=wird", true);
    renderHook(() => useWidgetTaps());
    expect(openEntryRoute).not.toHaveBeenCalled();
    expect(peekPendingWidgetTap()).toBe("wird");
  });

  it("hands every tap to the shared entry rules, which decide whether the screen it lands on is kept", async () => {
    mockPathname = "/flashcards/session";
    redirectWidgetTapPath("hafiz://widget?to=wird", false);
    renderHook(() => useWidgetTaps());
    await waitFor(() =>
      expect(openEntryRoute).toHaveBeenCalledWith(mockDb, "wird", { pathname: "/flashcards/session", getRootState: expect.any(Function) }),
    );
    expect(peekPendingWidgetTap()).toBeNull();
  });
});
