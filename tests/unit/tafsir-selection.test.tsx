import { Toast } from "@/components/ui/Toast";
import { OperationNoticeOverlay, OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import React, { type ComponentProps } from "react";
import { Dimensions, I18nManager } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import SettingsScreen from "@/app/(tabs)/settings";
import { ReadingSettingsSheet } from "@/components/mushaf/ReadingSettingsSheet";
import { TafsirSourcePicker } from "@/components/settings/TafsirSourcePicker";
import { DisclosureRow } from "@/components/ui/MirroredRow";
import { ensureTafsirSourceImported } from "@/lib/database/init";
import { DirectionProvider } from "@/lib/ui/direction";
import { strings } from "@/lib/i18n/strings";
import { stringByKey } from "@/lib/i18n/useStrings";
import type { useSettings } from "@/lib/settings/context";
import { AVAILABLE_TAFSIR_SOURCES, type TafsirSourceId } from "@/lib/tafsir/sources";

let mockNoticeReady = true;

type PickerProps = ComponentProps<typeof TafsirSourcePicker>;
let mockPickerProps: PickerProps | undefined;
const mockSelectionResults: Promise<boolean>[] = [];
const mockRemoteAccess = jest.fn<never, unknown[]>(() => {
  throw new Error("Remote service forbidden in local selection fixture");
});
const mockDatabase = {
  getFirstAsync: jest.fn(async () => null),
  getAllAsync: jest.fn(async () => [{ source: "qurtubi", count: 6234 }]),
  runAsync: jest.fn(() => {
    throw new Error("Database writes forbidden in selection fixture");
  }),
};
const mockSetSource = jest.fn<void, [TafsirSourceId]>();
const mockSettings: Partial<ReturnType<typeof useSettings>> = {
  setTafseerSource: mockSetSource,
  tafseerSource: "muyassar",
  uiLanguage: "en",
  isRTL: false,
};
const mockRouter = { push: mockRemoteAccess, setParams: mockRemoteAccess };
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");
const sourceA: TafsirSourceId = "qurtubi";
const sourceB: TafsirSourceId = "zilal";

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/database/init", () => ({ ensureTafsirSourceImported: jest.fn() }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => ({ ...actual.useSettings(), ...mockSettings }) };
});
jest.mock("@/components/settings/TafsirSourcePicker", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const actual = jest.requireActual<typeof import("@/components/settings/TafsirSourcePicker")>(
    "@/components/settings/TafsirSourcePicker",
  );
  return {
    ...actual,
    TafsirSourcePicker: (props: PickerProps) => {
      mockPickerProps = props;
      return React.createElement(actual.TafsirSourcePicker, {
        ...props,
        onSelect: (sourceId: TafsirSourceId) => {
          const result = props.onSelect(sourceId);
          mockSelectionResults.push(result);
          return result;
        },
      });
    },
  };
});
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ category: "content" }),
}));
jest.mock("@/lib/auth/config", () => ({ isEmailAuthFlowsEnabled: () => false }));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: () => ({ user: null, profile: null, isLoading: false, signOut: mockRemoteAccess }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  supabase: new Proxy({}, { get: () => mockRemoteAccess }),
}));
jest.mock("@/lib/quran-foundation/config", () => {
  const actual = jest.requireActual<typeof import("@/lib/quran-foundation/config")>("@/lib/quran-foundation/config");
  return { ...actual, isQfContentEnabled: () => false, isQfSyncEnabled: () => false };
});
jest.mock("@/lib/quran-foundation/user", () => ({
  beginQfOAuthConnection: (...args: unknown[]) => mockRemoteAccess(...args),
  disconnectQfUser: (...args: unknown[]) => mockRemoteAccess(...args),
  getQfConnectionStatus: (...args: unknown[]) => mockRemoteAccess(...args),
  getQfLinkedIdentityState: (...args: unknown[]) => mockRemoteAccess(...args),
}));
jest.mock("@/lib/quran-foundation/user-sync", () => ({
  fullQfUserSync: (...args: unknown[]) => mockRemoteAccess(...args),
  runInitialQfUserSync: (...args: unknown[]) => mockRemoteAccess(...args),
}));
jest.mock("@/components/profile/ProfileIdentity", () => ({ ProfileIdentity: () => null }));
jest.mock("@/components/settings/TranslationLanguagePicker", () => ({ TranslationLanguagePicker: () => null }));
jest.mock("@/components/settings/ReciterPicker", () => ({ ReciterPicker: () => null }));
jest.mock("@/lib/fonts/loader", () => ({
  isQuranPageFontLoaded: () => true,
  loadQuranPageFont: (...args: unknown[]) => mockRemoteAccess(...args),
  quranPageFontName: () => "SyntheticFont",
  quranPageFontPaletteStyle: () => ({}),
  quranPageMarkerFontPaletteStyle: () => ({}),
}));

function deferred() {
  let complete: (() => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  return {
    promise,
    resolve() {
      if (!complete) throw new Error("Missing resolve");
      complete();
    },
    reject(error: Error) {
      if (!fail) throw new Error("Missing reject");
      fail(error);
    },
  };
}
function picker() {
  if (!mockPickerProps) throw new Error("Missing actual picker props");
  return mockPickerProps;
}
function Wrapper({ children }: React.PropsWithChildren) {
  const window = Dimensions.get("window");
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: window.width, height: window.height },
        insets: { top: 0, left: 0, bottom: 0, right: 0 },
      }}
    >
      <OperationNoticeProvider ready={mockNoticeReady}>
        <DirectionProvider dir={mockSettings.isRTL ? "rtl" : "ltr"}>{children}</DirectionProvider>
      </OperationNoticeProvider>
    </SafeAreaProvider>
  );
}
const cases = [
  { owner: "settings", language: "ar", width: 390 },
  { owner: "settings", language: "en", width: 1280 },
  { owner: "reading", language: "ar", width: 390 },
  { owner: "reading", language: "en", width: 1280 },
] satisfies { owner: "settings" | "reading"; language: "ar" | "en"; width: number }[];

describe.each(cases)("$owner $language/$width tafsir selection", ({ owner, language, width }) => {
  let pending: ReturnType<typeof deferred>;
  let warn: jest.SpyInstance;
  let errors: jest.SpyInstance;
  let expectedWarnings: number;
  const prefix =
    owner === "settings"
      ? "[Settings] Failed to import tafsir source:"
      : "[ReadingSettingsSheet] Failed to import tafsir source:";
  function label(sourceId: TafsirSourceId) {
    const source = AVAILABLE_TAFSIR_SOURCES.find((value) => value.id === sourceId);
    if (!source) throw new Error("Missing source fixture");
    return stringByKey(strings[language], source.labelKey, source.id);
  }
  async function open() {
    const view = render(
      owner === "settings" ? <SettingsScreen /> : <ReadingSettingsSheet visible onClose={() => undefined} />,
      { wrapper: Wrapper },
    );
    await act(async () => {});
    fireEvent.press(view.getByText(strings[language].tafseerSourceLabel));
    await act(async () => {});
    expect(picker().visible).toBe(true);
    return view;
  }
  function begin(view: ReturnType<typeof render>) {
    fireEvent.press(view.getByText(label(sourceA)));
    const result = mockSelectionResults.at(-1);
    if (!result) throw new Error("No selection result");
    return result;
  }
  function expectBusy(view: ReturnType<typeof render>, busy: boolean) {
    const rows = view.UNSAFE_getAllByType(DisclosureRow);
    expect(rows).toHaveLength(AVAILABLE_TAFSIR_SOURCES.length);
    expect(rows.every((row) => row.props.disabled === busy)).toBe(true);
    expect(picker().importingSource).toBe(busy ? sourceA : null);
  }
  beforeEach(() => {
    mockNoticeReady = true;
    jest.clearAllMocks();
    mockPickerProps = undefined;
    mockSelectionResults.length = 0;
    expectedWarnings = 0;
    Object.assign(mockSettings, { uiLanguage: language, isRTL: language === "ar", tafseerSource: "muyassar" });
    mockSetSource.mockReset().mockImplementation((source) => {
      mockSettings.tafseerSource = source;
    });
    pending = deferred();
    jest.mocked(ensureTafsirSourceImported).mockReset().mockReturnValue(pending.promise);
    const screen = { width, height: 844, scale: 1, fontScale: 1 };
    Dimensions.set({ window: screen, screen });
    jest.replaceProperty(I18nManager, "isRTL", language === "ar");
    if (typeof globalThis.fetch === "function")
      jest.spyOn(globalThis, "fetch").mockImplementation(() => mockRemoteAccess("fetch"));
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    try {
      cleanup();
      expect(mockRemoteAccess).not.toHaveBeenCalled();
      expect(mockDatabase.runAsync).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(expectedWarnings);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
      Dimensions.set({ window: originalWindow, screen: originalScreen });
    }
  });
  it("imports before selecting, disables real rows and closes after success", async () => {
    const view = await open();
    const result = begin(view);
    expectBusy(view, true);
    expect(mockSetSource).not.toHaveBeenCalled();
    expect(ensureTafsirSourceImported).toHaveBeenCalledWith(mockDatabase, sourceA);
    await act(async () => {
      pending.resolve();
      await result;
    });
    await expect(result).resolves.toBe(true);
    expect(mockSetSource).toHaveBeenCalledWith(sourceA);
    expect(picker().importingSource).toBeNull();
    expect(picker().selectedSource).toBe(sourceA);
    expect(picker().visible).toBe(false);
  }, 10000);
  it("reports import failure without selecting or closing", async () => {
    const view = await open();
    const result = begin(view);
    const error = new Error("Synthetic import failure");
    expectedWarnings = 1;
    await act(async () => {
      pending.reject(error);
      await result;
    });
    await expect(result).resolves.toBe(false);
    expect(mockSetSource).not.toHaveBeenCalled();
    expectBusy(view, false);
    expect(picker().visible).toBe(true);
    expect(warn).toHaveBeenCalledWith(prefix, error);
    expect(view.getByText(strings[language].tafseerSourceImportFailed, { includeHiddenElements: true })).toBeTruthy();
    const retry = deferred();
    jest.mocked(ensureTafsirSourceImported).mockReturnValue(retry.promise);
    const retried = begin(view);
    expectBusy(view, true);
    expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(2);
    await act(async () => {
      retry.resolve();
      await retried;
    });
    await expect(retried).resolves.toBe(true);
    expect(mockSetSource).toHaveBeenCalledWith(sourceA);
  });
  it("rejects a selection after the busy render and disables other real rows", async () => {
    const view = await open();
    const result = begin(view);
    expectBusy(view, true);
    fireEvent.press(view.getByText(label(sourceB)));
    let blocked: boolean | undefined;
    await act(async () => {
      blocked = await picker().onSelect(sourceB);
    });
    expect(blocked).toBe(false);
    expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve();
      await result;
    });
    await expect(result).resolves.toBe(true);
  });
  it("reports a synchronous settings callback failure and clears busy state", async () => {
    const view = await open();
    const error = new Error("Synthetic settings callback failure");
    expectedWarnings = 1;
    mockSetSource.mockImplementationOnce(() => {
      throw error;
    });
    const result = begin(view);
    await act(async () => {
      pending.resolve();
      await result;
    });
    await expect(result).resolves.toBe(false);
    expect(mockSetSource).toHaveBeenCalledWith(sourceA);
    expect(picker().selectedSource).toBe("muyassar");
    expect(picker().visible).toBe(true);
    expectBusy(view, false);
    expect(warn).toHaveBeenCalledWith(prefix, error);
    const retry = deferred();
    jest.mocked(ensureTafsirSourceImported).mockReturnValue(retry.promise);
    const retried = begin(view);
    expectBusy(view, true);
    await act(async () => {
      retry.resolve();
      await retried;
    });
    await expect(retried).resolves.toBe(true);
    expect(mockSetSource).toHaveBeenCalledTimes(2);
  });
  it("keeps a pending import active after the picker closes", async () => {
    const view = await open();
    const result = begin(view);
    act(() => picker().onClose());
    expect(picker().visible).toBe(false);
    expect(picker().importingSource).toBe(sourceA);
    await act(async () => {
      pending.resolve();
      await result;
    });
    await expect(result).resolves.toBe(true);
    expect(mockSetSource).toHaveBeenCalledWith(sourceA);
    expect(picker().visible).toBe(false);
    expect(picker().importingSource).toBeNull();
  });
  it("hands one failure notice from the real picker to its sheet and root", async () => {
    const view = await open();
    const result = begin(view);
    expectedWarnings = 1;
    jest.useFakeTimers();
    try {
      await act(async () => {
        pending.reject(new Error("Synthetic nested picker failure"));
        await result;
      });
      const activeSlots = () =>
        view.UNSAFE_queryAllByType(OperationNoticeOverlay).filter((slot) => slot.findAllByType(Toast).length > 0);
      expect(view.UNSAFE_getAllByType(Toast)).toHaveLength(1);
      expect(activeSlots()).toHaveLength(1);
      const pickerId: unknown = activeSlots()[0].props.overlayId;
      act(() => picker().onClose());
      expect(view.UNSAFE_getAllByType(Toast)).toHaveLength(1);
      expect(view.getByText(strings[language].tafseerSourceImportFailed)).toBeTruthy();
      if (owner === "reading") {
        expect(activeSlots()).toHaveLength(1);
        expect(activeSlots()[0].props.overlayId).not.toBe(pickerId);
      } else {
        expect(activeSlots()).toHaveLength(0);
      }
      view.rerender(<></>);
      expect(activeSlots()).toHaveLength(0);
      expect(view.UNSAFE_getAllByType(Toast)).toHaveLength(1);
      expect(view.getByText(strings[language].tafseerSourceImportFailed)).toBeTruthy();
    } finally {
      view.unmount();
      jest.useRealTimers();
    }
  });
  it("retains a deferred failure after the owner disappears and readiness recovers", async () => {
    const view = await open();
    const result = begin(view);
    expectedWarnings = 1;
    jest.useFakeTimers();
    try {
      mockNoticeReady = false;
      view.rerender(<></>);
      await act(async () => {
        pending.reject(new Error("Synthetic retired SQLite failure"));
        await result;
      });
      await expect(result).resolves.toBe(false);
      expect(mockSetSource).not.toHaveBeenCalled();
      act(() => jest.advanceTimersByTime(5000));
      expect(view.queryByText(strings[language].tafseerSourceImportFailed)).toBeNull();
      mockNoticeReady = true;
      view.rerender(<></>);
      expect(view.getByText(strings[language].tafseerSourceImportFailed)).toBeTruthy();
    } finally {
      view.unmount();
      jest.useRealTimers();
    }
  });
  it("preserves selection completion after the owner unmounts", async () => {
    const view = await open();
    const result = begin(view);
    view.unmount();
    await act(async () => {
      pending.resolve();
      await result;
    });
    await expect(result).resolves.toBe(true);
    expect(mockSetSource).toHaveBeenCalledWith(sourceA);
  });
  it("blocks same-render and stale callbacks until the first import settles", async () => {
    const view = await open();
    const other = deferred();
    jest.mocked(ensureTafsirSourceImported).mockImplementation((database, source) => {
      expect(database).toBe(mockDatabase);
      if (source === sourceA) return pending.promise;
      if (source === sourceB) return other.promise;
      throw new Error("Unexpected concurrent source fixture");
    });
    const staleSelect = picker().onSelect;
    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    try {
      await act(async () => {
        first = staleSelect(sourceA);
        second = staleSelect(sourceB);
      });
      expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(1);
      await expect(second).resolves.toBe(false);
      expectBusy(view, true);
      let blocked: boolean | undefined;
      await act(async () => {
        blocked = await staleSelect(sourceB);
      });
      expect(blocked).toBe(false);
      expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(1);
      expectBusy(view, true);
      await act(async () => {
        pending.resolve();
        await first;
      });
      await expect(first).resolves.toBe(true);
      expect(mockSetSource).toHaveBeenCalledTimes(1);
      expect(mockSetSource).toHaveBeenCalledWith(sourceA);
      expect(picker().importingSource).toBeNull();
    } finally {
      await act(async () => {
        pending.resolve();
        other.resolve();
        await Promise.all([first, second]);
      });
    }
  });

  it("closes the already selected included source without another import", async () => {
    const view = await open();
    const index = AVAILABLE_TAFSIR_SOURCES.findIndex((source) => source.id === "muyassar");
    const row = view.UNSAFE_getAllByType(DisclosureRow)[index];
    if (!row) throw new Error("Missing selected source row");
    fireEvent.press(row);
    expect(picker().visible).toBe(false);
    expect(mockSelectionResults).toHaveLength(0);
    expect(ensureTafsirSourceImported).not.toHaveBeenCalled();
    expect(mockSetSource).not.toHaveBeenCalled();
  });
});
