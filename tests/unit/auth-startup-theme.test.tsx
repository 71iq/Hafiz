import React from "react";
import { Platform } from "react-native";
import { render, renderHook } from "@testing-library/react-native";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { useAuthDarkMode } from "@/components/auth/AuthScreenShell";
import { isSocialAuthEnabled } from "@/lib/auth/config";
import { isSupabaseConfigured } from "@/lib/supabase";
import { strings } from "@/lib/i18n/strings";
import { DirectionProvider } from "@/lib/ui/direction";
import { flattenStyle } from "../rtl/rtl-test-utils";

type MatchMediaResult = {
  matches: boolean;
};

type TestWindow = {
  localStorage: {
    getItem: (key: string) => string | null;
  };
  matchMedia?: (query: string) => MatchMediaResult;
  getComputedStyle?: (element: unknown) => { backgroundColor: string };
};

type TestDocument = {
  documentElement: object;
};

let mockColorScheme: "light" | "dark" = "light";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: mockColorScheme, setColorScheme: jest.fn() }),
}));

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: jest.fn(),
}));

jest.mock("@/lib/auth/config", () => ({
  isSocialAuthEnabled: jest.fn(),
}));

jest.mock("@/lib/auth/oauth", () => ({
  startAppOAuth: jest.fn(),
}));

jest.mock("@/lib/database/provider", () => ({
  useDatabaseStatus: () => ({ db: null }),
}));

jest.mock("@/lib/quran-foundation/config", () => ({
  isQfLoginEnabled: () => false,
}));

jest.mock("@/lib/quran-foundation/user-sync", () => ({
  runInitialQfUserSync: jest.fn(),
}));

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
const getItem = jest.fn<string | null, [string]>();

function installWindow(testWindow: TestWindow): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: testWindow,
  });
}

function installDocument(): TestDocument["documentElement"] {
  const documentElement = {};
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement },
  });
  return documentElement;
}

function restoreGlobalDescriptor(key: "window" | "document", descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, key);
  }
}

function renderGoogleButton(isDark?: boolean) {
  const rendered = render(
    <DirectionProvider dir="ltr">
      <OAuthButtons strings={strings.en} isDark={isDark} />
    </DirectionProvider>,
  );
  const button = rendered.getByLabelText(strings.en.authContinueWithGoogle);
  const style = button.props.style;
  const resolvedStyle = typeof style === "function" ? style({ pressed: false }) : style;
  return flattenStyle(resolvedStyle);
}

function expectBothConsumersToResolve(expectedIsDark: boolean, expectedBorderColor: string): void {
  const { result } = renderHook(() => useAuthDarkMode());
  expect(result.current).toBe(expectedIsDark);
  expect(renderGoogleButton().borderColor).toBe(expectedBorderColor);
}

describe("auth startup theme resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, "OS", "web");
    mockColorScheme = "light";
    jest.mocked(isSupabaseConfigured).mockReturnValue(true);
    jest.mocked(isSocialAuthEnabled).mockReturnValue(true);
    getItem.mockReset().mockReturnValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    restoreGlobalDescriptor("window", originalWindowDescriptor);
    restoreGlobalDescriptor("document", originalDocumentDescriptor);
  });

  it.each([
    ["dark", "light"],
    ["amoled", "light"],
    ["dark", "dark"],
    ["amoled", "dark"],
  ] as const)("treats cached %s as dark against NativeWind %s", (cachedTheme, nativeScheme) => {
    mockColorScheme = nativeScheme;
    getItem.mockReturnValue(cachedTheme);
    installWindow({ localStorage: { getItem } });

    expectBothConsumersToResolve(true, "#E5E7EB");
    expect(getItem).toHaveBeenCalledWith("hafiz_theme");
  });

  it.each([
    ["beige", "light"],
    ["beige", "dark"],
    ["white", "light"],
    ["white", "dark"],
  ] as const)("treats cached %s as light against NativeWind %s", (cachedTheme, nativeScheme) => {
    mockColorScheme = nativeScheme;
    getItem.mockReturnValue(cachedTheme);
    installWindow({ localStorage: { getItem } });

    expectBothConsumersToResolve(false, "#DFD9D1");
    expect(getItem).toHaveBeenCalledWith("hafiz_theme");
  });

  it.each([false, true])("uses the exact system media query when it matches %s", (matches) => {
    mockColorScheme = matches ? "light" : "dark";
    const matchMedia = jest.fn((query: string) => {
      expect(query).toBe("(prefers-color-scheme: dark)");
      return { matches };
    });
    getItem.mockReturnValue("system");
    installWindow({ localStorage: { getItem }, matchMedia });

    expectBothConsumersToResolve(matches, matches ? "#E5E7EB" : "#DFD9D1");
    expect(matchMedia).toHaveBeenCalledTimes(2);
  });

  it.each(["light", "dark"] as const)(
    "uses NativeWind for cached system without matchMedia, even with a dark document background, in %s mode",
    (nativeScheme) => {
      mockColorScheme = nativeScheme;
      getItem.mockReturnValue("system");
      const getComputedStyle = jest.fn(() => ({ backgroundColor: "rgb(10, 10, 10)" }));
      installDocument();
      installWindow({ localStorage: { getItem }, getComputedStyle });

      expectBothConsumersToResolve(nativeScheme === "dark", nativeScheme === "dark" ? "#E5E7EB" : "#DFD9D1");
      expect(getComputedStyle).not.toHaveBeenCalled();
    },
  );

  it.each([
    [null, "rgb(10, 10, 10)"],
    [null, "rgb(38, 38, 38)"],
    ["", "rgb(10, 10, 10)"],
    ["", "rgb(38, 38, 38)"],
    ["unknown", "rgb(10, 10, 10)"],
    ["unknown", "rgb(38, 38, 38)"],
    ["light", "rgb(10, 10, 10)"],
    ["light", "rgb(38, 38, 38)"],
  ] as const)(
    "uses the dark document fallback for cache %s and background %s while AuthScreenShell follows NativeWind",
    (cachedTheme, backgroundColor) => {
      mockColorScheme = "light";
      getItem.mockReturnValue(cachedTheme);
      const getComputedStyle = jest.fn(() => ({ backgroundColor }));
      const documentElement = installDocument();
      installWindow({ localStorage: { getItem }, getComputedStyle });

      expectBothConsumersToResolve(false, "#E5E7EB");
      expect(getComputedStyle).toHaveBeenCalledWith(documentElement);
    },
  );

  it.each(["light", "dark"] as const)(
    "uses each NativeWind fallback for an unrecognized document background in %s mode",
    (nativeScheme) => {
      mockColorScheme = nativeScheme;
      getItem.mockReturnValue("unknown");
      const getComputedStyle = jest.fn(() => ({ backgroundColor: "rgb(255, 255, 255)" }));
      const documentElement = installDocument();
      installWindow({ localStorage: { getItem }, getComputedStyle });

      expectBothConsumersToResolve(nativeScheme === "dark", nativeScheme === "dark" ? "#E5E7EB" : "#DFD9D1");
      expect(getComputedStyle).toHaveBeenCalledWith(documentElement);
    },
  );

  it.each(["light", "dark"] as const)("uses each NativeWind fallback without a document in %s mode", (nativeScheme) => {
    mockColorScheme = nativeScheme;
    getItem.mockReturnValue("unknown");
    installWindow({ localStorage: { getItem } });
    Reflect.deleteProperty(globalThis, "document");

    expectBothConsumersToResolve(nativeScheme === "dark", nativeScheme === "dark" ? "#E5E7EB" : "#DFD9D1");
  });

  it.each([
    ["android", "light"],
    ["android", "dark"],
    ["ios", "light"],
    ["ios", "dark"],
  ] as const)("does not read browser storage on %s with NativeWind %s", (platform, nativeScheme) => {
    jest.replaceProperty(Platform, "OS", platform);
    mockColorScheme = nativeScheme;
    getItem.mockReturnValue("dark");
    installWindow({ localStorage: { getItem } });

    expectBothConsumersToResolve(nativeScheme === "dark", nativeScheme === "dark" ? "#E5E7EB" : "#DFD9D1");
    expect(getItem).not.toHaveBeenCalled();
  });

  it.each(["light", "dark"] as const)("does not read browser storage without a window in %s mode", (nativeScheme) => {
    mockColorScheme = nativeScheme;
    getItem.mockReturnValue("dark");
    installWindow({ localStorage: { getItem } });
    Reflect.deleteProperty(globalThis, "window");

    expectBothConsumersToResolve(nativeScheme === "dark", nativeScheme === "dark" ? "#E5E7EB" : "#DFD9D1");
    expect(getItem).not.toHaveBeenCalled();
  });

  it.each([true, false])("lets explicit OAuth isDark=%s bypass browser lookup", (isDark) => {
    mockColorScheme = isDark ? "light" : "dark";
    const getComputedStyle = jest.fn(() => ({ backgroundColor: "rgb(10, 10, 10)" }));
    getItem.mockReturnValue(isDark ? "beige" : "dark");
    installWindow({ localStorage: { getItem }, getComputedStyle });

    const expectedBorderColor = isDark ? "#E5E7EB" : "#DFD9D1";
    expect(renderGoogleButton(isDark).borderColor).toBe(expectedBorderColor);
    expect(getItem).not.toHaveBeenCalled();
    expect(getComputedStyle).not.toHaveBeenCalled();
  });

  it("propagates an error accessing localStorage to both consumers", () => {
    const error = new Error("Storage access denied");
    installWindow({
      get localStorage(): TestWindow["localStorage"] {
        throw error;
      },
    });

    expect(() => renderHook(() => useAuthDarkMode())).toThrow(error);
    expect(() => renderGoogleButton()).toThrow(error);
  });

  it("propagates a getItem error to both consumers", () => {
    const error = new Error("Storage read failed");
    getItem.mockImplementation(() => {
      throw error;
    });
    installWindow({ localStorage: { getItem } });

    expect(() => renderHook(() => useAuthDarkMode())).toThrow(error);
    expect(() => renderGoogleButton()).toThrow(error);
  });
});
