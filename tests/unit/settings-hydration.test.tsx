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
const mockImportTranslation = jest.fn<Promise<void>, [unknown, string, unknown?]>(() => Promise.resolve());
const mockEnqueueSync = jest.fn<Promise<void>, [unknown, ...unknown[]]>(() => Promise.resolve());
const mockUseDatabase = jest.fn<SettingsFixture, []>();
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const windowGetItem = jest.fn<string | null, [string]>();

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ setColorScheme: mockSetColorScheme }),
  vars: (variables: Record<string, string>) => variables,
}));

let mockIsReady = true;
jest.mock("@/lib/database/provider", () => ({
  useDatabaseStatus: () => ({ db: mockUseDatabase(), isReady: mockIsReady, progress: null, error: null }),
}));

jest.mock("@/lib/translations/import", () => ({
  TranslationImportCancelled: class TranslationImportCancelled extends Error {},
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
    mockIsReady = true;
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

describe("shared settings provider across database readiness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsReady = true;
    jest.replaceProperty(Platform, "OS", "android");
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("waits for a ready database without reading it", () => {
    const fixture = createFixture();
    mockIsReady = false;
    mockUseDatabase.mockReturnValue(fixture);
    const { result } = renderHook(() => useSettings(), { wrapper: SettingsWrapper });

    expect(result.current.isLoaded).toBe(false);
    expect(result.current.uiLanguage).toBe("en");
    expect(fixture.getAllAsync).not.toHaveBeenCalled();
  });

  it("keeps the loaded language while a connection restarts and reloads for the new one", async () => {
    const first = createFixture();
    first.settings.set("ui_language", "ar");
    const rendered = await renderLoadedSettings(first);
    expect(rendered.result.current.uiLanguage).toBe("ar");
    expect(rendered.result.current.isRTL).toBe(true);

    mockIsReady = false;
    rendered.rerender({});
    expect(rendered.result.current.isLoaded).toBe(false);
    expect(rendered.result.current.uiLanguage).toBe("ar");

    const second = createFixture();
    second.settings.set("ui_language", "en");
    mockUseDatabase.mockReturnValue(second);
    mockIsReady = true;
    rendered.rerender({});
    await waitFor(() => expect(rendered.result.current.isLoaded).toBe(true));
    expect(rendered.result.current.uiLanguage).toBe("en");
    expect(first.getAllAsync).toHaveBeenCalledTimes(1);
  });

  it("ignores settings read from a connection that was replaced mid-load", async () => {
    let releaseStale!: () => void;
    const stale = createFixture();
    stale.settings.set("ui_language", "ar");
    const staleRead = stale.getAllAsync.getMockImplementation()!;
    stale.getAllAsync.mockImplementationOnce(
      (query, keys) => new Promise((resolve) => (releaseStale = () => resolve(staleRead(query, keys)))),
    );
    mockUseDatabase.mockReturnValue(stale);
    const rendered = renderHook(() => useSettings(), { wrapper: SettingsWrapper });

    const current = createFixture();
    current.settings.set("ui_language", "en");
    mockUseDatabase.mockReturnValue(current);
    rendered.rerender({});
    await waitFor(() => expect(rendered.result.current.isLoaded).toBe(true));
    await act(async () => releaseStale());

    expect(rendered.result.current.uiLanguage).toBe("en");
    expect(rendered.result.current.isLoaded).toBe(true);
  });
});

describe("device-only preferences (C05)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsReady = true;
    jest.replaceProperty(Platform, "OS", "android");
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps every new device key off the sync classification", () => {
    const { isSyncableUserSetting } =
      jest.requireActual<typeof import("@/lib/database/user-settings")>("@/lib/database/user-settings");
    const { DEVICE_SETTING_KEYS } =
      jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
    for (const key of [...Object.values(DEVICE_SETTING_KEYS), "device_sync_restore_pause_user-1"]) {
      expect(isSyncableUserSetting(key)).toBe(false);
    }
  });

  it("uses defaults when nothing is saved", async () => {
    const { result } = await renderLoadedSettings(createFixture());
    expect(result.current).toMatchObject({
      bookmarksOrder: "recent",
      audioFollow: true,
      audioRepeatRange: 1,
      audioRepeatEach: 1,
      audioDelaySeconds: 1,
      hapticsEnabled: true,
      accountPromoDismissed: false,
    });
  });

  it("hydrates valid saved values", async () => {
    const fixture = createFixture();
    fixture.settings.set("device_bookmarks_order", "quran");
    fixture.settings.set("device_audio_follow", "false");
    fixture.settings.set("device_audio_repeat_range", "99");
    fixture.settings.set("device_audio_repeat_each", "3");
    fixture.settings.set("device_audio_delay_seconds", "0");
    fixture.settings.set("device_haptics_enabled", "false");
    fixture.settings.set("device_account_promo_dismissed_at", new Date(Date.now() - 60_000).toISOString());
    const { result } = await renderLoadedSettings(fixture);
    expect(result.current).toMatchObject({
      bookmarksOrder: "quran",
      audioFollow: false,
      audioRepeatRange: 99,
      audioRepeatEach: 3,
      audioDelaySeconds: 0,
      hapticsEnabled: false,
      accountPromoDismissed: true,
    });
  });

  it.each([
    ["device_bookmarks_order", "Quran"],
    ["device_audio_follow", "1"],
    ["device_audio_repeat_range", "100"],
    ["device_audio_repeat_each", "-1"],
    ["device_audio_delay_seconds", "1.5"],
    ["device_audio_delay_seconds", "31"],
    ["device_haptics_enabled", "TRUE"],
  ])("falls back to the default for malformed %s=%j", async (key, value) => {
    const fixture = createFixture();
    fixture.settings.set(key, value);
    const { result } = await renderLoadedSettings(fixture);
    expect(result.current).toMatchObject({
      bookmarksOrder: "recent",
      audioFollow: true,
      audioRepeatRange: 1,
      audioRepeatEach: 1,
      audioDelaySeconds: 1,
      hapticsEnabled: true,
    });
  });

  it.each([
    ["future", () => new Date(Date.now() + 86_400_000).toISOString()],
    ["expired", () => new Date(Date.now() - 15 * 86_400_000).toISOString()],
    ["garbage", () => "not-a-date"],
  ])("does not hide the account promotion for a %s dismissal", async (_label, value) => {
    const fixture = createFixture();
    fixture.settings.set("device_account_promo_dismissed_at", value());
    const { result } = await renderLoadedSettings(fixture);
    expect(result.current.accountPromoDismissed).toBe(false);
  });

  it("reverts a failed write only when no newer choice was made", async () => {
    const fixture = createFixture();
    const { result } = await renderLoadedSettings(fixture);
    let rejectFirst: (error: Error) => void = () => {};
    fixture.runAsync.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );

    act(() => result.current.setTheme("dark"));
    act(() => result.current.setTheme("amoled"));
    await act(async () => {
      rejectFirst(new Error("disk full"));
      await Promise.resolve();
    });
    expect(result.current.theme).toBe("amoled");

    fixture.runAsync.mockRejectedValueOnce(new Error("disk full"));
    await act(async () => {
      result.current.setTheme("beige");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.theme).toBe("amoled");
  });
});

describe("W14 settings write feedback and translation choice", () => {
  beforeEach(() => {
    mockIsReady = true;
    mockImportTranslation.mockReset().mockResolvedValue();
  });

  it("reverts a failed reader setting to the last value and announces only the key", async () => {
    const { subscribeSettingSaveFailed } = jest.requireActual("@/lib/settings/save-feedback");
    const failures: string[] = [];
    const unsubscribe = subscribeSettingSaveFailed((key: string) => failures.push(key));
    const fixture = createFixture();
    const { result } = await renderLoadedSettings(fixture);
    const setter = result.current.setPageScroll;
    fixture.runAsync.mockRejectedValueOnce(new Error("disk full"));
    await act(async () => {
      result.current.setPageScroll("horizontal");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.pageScroll).toBe("vertical");
    expect(failures).toEqual(["page_scroll"]);
    // The setter keeps its identity across value changes.
    expect(result.current.setPageScroll).toBe(setter);
    unsubscribe();
  });

  it("keeps the previous translation when an import fails", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const fixture = createFixture();
    const { result } = await renderLoadedSettings(fixture);
    const previous = result.current.translationLanguage;
    mockImportTranslation.mockRejectedValueOnce(new Error("synthetic import failure"));
    await act(async () => {
      await expect(result.current.setTranslationLanguage("fr")).rejects.toThrow("synthetic import failure");
    });
    expect(result.current.translationLanguage).toBe(previous);
    expect(fixture.settings.get("translation_language")).toBe(previous);
    expect(result.current.isTranslationLoading).toBe(false);
  });

  it("lets built-in English replace an import still in progress", async () => {
    const fixture = createFixture();
    const { result } = await renderLoadedSettings(fixture);
    let finishImport: () => void = () => {};
    mockImportTranslation.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishImport = resolve;
        }),
    );
    let importing: Promise<void> | undefined;
    act(() => {
      importing = result.current.setTranslationLanguage("fr");
    });
    expect(result.current.isTranslationLoading).toBe(true);
    await act(async () => {
      await result.current.setTranslationLanguage("en");
    });
    expect(result.current.translationLanguage).toBe("en");
    expect(result.current.isTranslationLoading).toBe(false);
    await act(async () => {
      finishImport();
      await importing;
    });
    // The finished import records its rows but cannot take the selection back.
    expect(result.current.translationLanguage).toBe("en");
    expect(fixture.settings.get("translation_language")).toBe("en");
    expect(fixture.settings.get("translation_active_lang")).toBe("fr");
  });
});

describe("failed setting writes restore the last committed value (C03)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsReady = true;
    jest.replaceProperty(Platform, "OS", "android");
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function deferredWrites(fixture: SettingsFixture) {
    const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
    fixture.runAsync.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          pending.push({ resolve: () => resolve({ changes: 1, lastInsertRowId: 0 }), reject });
        }),
    );
    return pending;
  }

  it("returns to the saved value when every overlapping write fails", async () => {
    const fixture = createFixture();
    const { result } = await renderLoadedSettings(fixture);
    const pending = deferredWrites(fixture);
    act(() => result.current.setAudioRepeatRange(2));
    act(() => result.current.setAudioRepeatRange(3));
    await act(async () => {
      pending[0].reject(new Error("disk"));
      pending[1].reject(new Error("disk"));
      await Promise.resolve();
    });
    expect(result.current.audioRepeatRange).toBe(1);
  });

  it("returns to an earlier write that succeeded when the newest one fails", async () => {
    const fixture = createFixture();
    const { result } = await renderLoadedSettings(fixture);
    const pending = deferredWrites(fixture);
    act(() => result.current.setAudioRepeatRange(2));
    act(() => result.current.setAudioRepeatRange(3));
    await act(async () => {
      pending[0].resolve();
      await Promise.resolve();
      pending[1].reject(new Error("disk"));
      await Promise.resolve();
    });
    expect(result.current.audioRepeatRange).toBe(2);
  });
});
