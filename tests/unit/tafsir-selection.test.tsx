import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
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

type PickerProps = ComponentProps<typeof TafsirSourcePicker>;
let mockPickerProps: PickerProps | undefined;
let mockNetInfo: { isConnected: boolean | null; isInternetReachable: boolean | null } = {
  isConnected: true,
  isInternetReachable: true,
};
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
const download: TafsirSourceId = "razi";
const installed: TafsirSourceId = "qurtubi";

jest.mock("@react-native-community/netinfo", () => ({
  useNetInfo: () => mockNetInfo,
  fetch: async () => mockNetInfo,
  addEventListener: () => () => undefined,
}));
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
      return React.createElement(actual.TafsirSourcePicker, props);
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
      <OperationNoticeProvider ready>
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
  const s = strings[language];
  const prefix = owner === "settings" ? "[Settings]" : "[ReadingSettingsSheet]";
  function label(sourceId: TafsirSourceId) {
    const source = AVAILABLE_TAFSIR_SOURCES.find((value) => value.id === sourceId);
    if (!source) throw new Error("Missing source fixture");
    return stringByKey(s, source.labelKey, source.id);
  }
  function row(view: ReturnType<typeof render>, sourceId: TafsirSourceId) {
    const found = view
      .UNSAFE_getAllByType(DisclosureRow)
      .find((item) => String(item.props.accessibilityLabel).startsWith(label(sourceId)));
    if (!found) throw new Error("Missing row for " + sourceId);
    return found;
  }
  async function open() {
    const view = render(
      owner === "settings" ? <SettingsScreen /> : <ReadingSettingsSheet visible onClose={() => undefined} />,
      { wrapper: Wrapper },
    );
    await act(async () => {});
    fireEvent.press(view.getByText(s.tafseerSourceLabel));
    await act(async () => {});
    expect(picker().visible).toBe(true);
    return view;
  }
  beforeEach(() => {
    jest.clearAllMocks();
    mockPickerProps = undefined;
    mockNetInfo = { isConnected: true, isInternetReachable: true };
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
  afterEach(async () => {
    try {
      await act(async () => pending.resolve());
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

  it("splits installed and downloadable sources and offers a plain Download", async () => {
    const view = await open();
    expect(view.getByText(s.tafsirPickerOnDevice)).toBeTruthy();
    expect(view.getByText(s.tafsirPickerAvailable)).toBeTruthy();
    expect(view.getByText(s.tafseerDownloadHint)).toBeTruthy();
    expect(row(view, download).props.accessibilityLabel).toBe(`${label(download)}, ${s.tafseerDownloadAction}`);
    expect(row(view, installed).props.accessibilityLabel).toBe(`${label(installed)}, ${s.tafseerDownloaded}`);
    expect(view.queryByText(/MB/)).toBeNull();
  });

  it("downloads before selecting, keeps installed rows usable and closes after success", async () => {
    const view = await open();
    fireEvent.press(row(view, download));
    expect(ensureTafsirSourceImported).toHaveBeenCalledWith(mockDatabase, download);
    expect(mockSetSource).not.toHaveBeenCalled();
    expect(row(view, download).props.disabled).toBe(true);
    expect(row(view, installed).props.disabled).toBe(false);
    expect(row(view, "tahrir-tanwir").props.disabled).toBe(true);
    await act(async () => pending.resolve());
    expect(mockSetSource).toHaveBeenCalledWith(download);
    expect(picker().visible).toBe(false);
  });

  it("shows a failed download inline with Retry and keeps the sheet open", async () => {
    const view = await open();
    fireEvent.press(row(view, download));
    expectedWarnings = 1;
    const error = new Error("Synthetic import failure");
    await act(async () => pending.reject(error));
    expect(warn).toHaveBeenCalledWith(`${prefix} Failed to import tafsir source:`, error);
    expect(mockSetSource).not.toHaveBeenCalled();
    expect(picker().visible).toBe(true);
    expect(view.getByText(s.tafsirDownloadFailed)).toBeTruthy();
    pending = deferred();
    jest.mocked(ensureTafsirSourceImported).mockReturnValue(pending.promise);
    fireEvent.press(view.getByText(s.detailRetry));
    expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve());
    expect(mockSetSource).toHaveBeenCalledWith(download);
    expect(picker().visible).toBe(false);
  });

  it("explains an offline failure truthfully", async () => {
    mockNetInfo = { isConnected: false, isInternetReachable: false };
    const view = await open();
    fireEvent.press(row(view, download));
    expectedWarnings = 1;
    await act(async () => pending.reject(new Error("Synthetic offline failure")));
    expect(view.getByText(s.tafsirDownloadOffline)).toBeTruthy();
    expect(view.queryByText(s.tafsirDownloadFailed)).toBeNull();
  });

  it("does not select a download that finishes after the picker closed", async () => {
    const view = await open();
    fireEvent.press(row(view, download));
    act(() => picker().onClose());
    expect(picker().visible).toBe(false);
    await act(async () => pending.resolve());
    expect(mockSetSource).not.toHaveBeenCalled();
    expect(view.queryByText(s.tafsirDownloadFailed)).toBeNull();
  });

  it("lets a newer installed choice win over a late download", async () => {
    const view = await open();
    fireEvent.press(row(view, download));
    fireEvent.press(row(view, installed));
    await act(async () => {});
    expect(mockSetSource).toHaveBeenCalledWith(installed);
    expect(picker().visible).toBe(false);
    await act(async () => pending.resolve());
    expect(mockSetSource).toHaveBeenCalledTimes(1);
  });

  it("does not select after the owner unmounts mid-download", async () => {
    const view = await open();
    fireEvent.press(row(view, download));
    view.unmount();
    await act(async () => pending.resolve());
    expect(mockSetSource).not.toHaveBeenCalled();
  });

  it("reports a synchronous settings failure on the row without closing", async () => {
    const view = await open();
    const error = new Error("Synthetic settings callback failure");
    expectedWarnings = 1;
    mockSetSource.mockImplementationOnce(() => {
      throw error;
    });
    fireEvent.press(row(view, installed));
    await act(async () => {});
    expect(warn).toHaveBeenCalledWith(`${prefix} Failed to import tafsir source:`, error);
    expect(picker().visible).toBe(true);
    expect(view.getByText(s.tafseerSourceImportFailed)).toBeTruthy();
    fireEvent.press(view.getByText(s.detailRetry));
    await act(async () => {});
    expect(mockSetSource).toHaveBeenCalledTimes(2);
    expect(picker().visible).toBe(false);
  });

  it("closes the already selected included source without another import", async () => {
    const view = await open();
    fireEvent.press(row(view, "muyassar"));
    expect(picker().visible).toBe(false);
    expect(ensureTafsirSourceImported).not.toHaveBeenCalled();
    expect(mockSetSource).not.toHaveBeenCalled();
  });
});
