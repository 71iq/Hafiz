import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { DEFAULT_TRANSLATION_LANGUAGE } from "@/lib/translations/languages";
import { SettingsProvider, useSettings } from "@/lib/settings/context";

type SettingRow = {
  key: string;
  value: string;
};

type RunResult = {
  changes: number;
  lastInsertRowId: number;
};

type SettingsFixture = {
  settings: Map<string, string>;
  getAllAsync: jest.Mock<Promise<SettingRow[]>, [string, readonly unknown[] | undefined]>;
  runAsync: jest.Mock<Promise<RunResult>, [string, readonly unknown[] | undefined]>;
};

const mockSetColorScheme = jest.fn<void, [string]>();
const mockImportTranslation = jest.fn<Promise<void>, [unknown, string]>(() => Promise.resolve());
const mockEnqueueSync = jest.fn<Promise<void>, [unknown, ...unknown[]]>(() => Promise.resolve());
const mockUseDatabase = jest.fn<SettingsFixture, []>();
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const windowGetItem = jest.fn<string | null, [string]>();

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ setColorScheme: mockSetColorScheme }),
  vars: (variables: Record<string, string>) => variables,
}));

jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockUseDatabase(),
}));

jest.mock("@/lib/translations/import", () => ({
  importTranslation: (...args: Parameters<typeof mockImportTranslation>) => mockImportTranslation(...args),
}));

jest.mock("@/lib/database/sync-queue", () => ({
  enqueueSync: (...args: Parameters<typeof mockEnqueueSync>) => mockEnqueueSync(...args),
}));

function createFixture(savedAyahMarkers?: string): SettingsFixture {
  const settings = new Map<string, string>([
    ["translation_language", DEFAULT_TRANSLATION_LANGUAGE],
    ["translation_active_lang", DEFAULT_TRANSLATION_LANGUAGE],
  ]);

  if (savedAyahMarkers !== undefined) {
    settings.set("show_ayah_markers", savedAyahMarkers);
  }

  const getAllAsync = jest.fn<Promise<SettingRow[]>, [string, readonly unknown[] | undefined]>(
    async (_query, boundKeys = []) => {
      const keys = boundKeys.filter((key): key is string => typeof key === "string");
      return keys.flatMap((key) => {
        const value = settings.get(key);
        return value === undefined ? [] : [{ key, value }];
      });
    },
  );

  const runAsync = jest.fn<Promise<RunResult>, [string, readonly unknown[] | undefined]>(async (query, params = []) => {
    if (query.startsWith("INSERT OR REPLACE INTO user_settings")) {
      const [key, value] = params;
      if (typeof key !== "string" || typeof value !== "string") {
        throw new Error("Unexpected user setting write parameters");
      }
      settings.set(key, value);
    }
    return { changes: 1, lastInsertRowId: 0 };
  });

  return { settings, getAllAsync, runAsync };
}

function SettingsWrapper({ children }: { children: React.ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}

async function renderLoadedSettings(fixture: SettingsFixture) {
  mockUseDatabase.mockReturnValue(fixture);
  const rendered = renderHook(() => useSettings(), { wrapper: SettingsWrapper });
  await waitFor(() => expect(rendered.result.current.isLoaded).toBe(true));
  return rendered;
}

describe("settings ayah-marker hydration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, "OS", "web");
    windowGetItem.mockReturnValue(null);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: { getItem: windowGetItem } },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it.each(["web", "android"] as const)(
    "keeps the true default when the saved value is absent on %s",
    async (platform) => {
      jest.replaceProperty(Platform, "OS", platform);
      const fixture = createFixture();
      const { result } = await renderLoadedSettings(fixture);

      expect(result.current.showAyahMarkers).toBe(true);
      expect(fixture.getAllAsync.mock.calls[0]?.[1]).toContain("show_ayah_markers");
    },
  );

  it.each(["web", "android"] as const)("hydrates saved true on %s", async (platform) => {
    jest.replaceProperty(Platform, "OS", platform);
    const fixture = createFixture("true");
    const { result } = await renderLoadedSettings(fixture);

    expect(result.current.showAyahMarkers).toBe(true);
  });

  it.each(["web", "android"] as const)("hydrates saved false on %s", async (platform) => {
    jest.replaceProperty(Platform, "OS", platform);
    const fixture = createFixture("false");
    const { result } = await renderLoadedSettings(fixture);

    expect(result.current.showAyahMarkers).toBe(false);
  });

  it.each(["", "TRUE", "0", "yes"])("keeps the true default for malformed saved value %j", async (savedValue) => {
    const fixture = createFixture(savedValue);
    const { result } = await renderLoadedSettings(fixture);

    expect(result.current.showAyahMarkers).toBe(true);
  });

  it("writes literal false and hydrates it after a full remount", async () => {
    const fixture = createFixture();
    const firstRender = await renderLoadedSettings(fixture);

    await act(async () => {
      firstRender.result.current.setShowAyahMarkers(false);
      await Promise.resolve();
    });

    expect(firstRender.result.current.showAyahMarkers).toBe(false);
    expect(fixture.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR REPLACE INTO user_settings"),
      expect.arrayContaining(["show_ayah_markers", "false"]),
    );
    expect(mockEnqueueSync).not.toHaveBeenCalled();

    firstRender.unmount();
    const secondRender = await renderLoadedSettings(fixture);
    expect(secondRender.result.current.showAyahMarkers).toBe(false);
  });

  it("does not import translation content when the saved languages already match", async () => {
    const fixture = createFixture();
    await renderLoadedSettings(fixture);

    expect(mockImportTranslation).not.toHaveBeenCalled();
  });
});
