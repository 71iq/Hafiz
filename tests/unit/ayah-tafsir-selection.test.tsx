import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import React, { type ComponentProps } from "react";
import { Dimensions, I18nManager } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AyahDetailModal } from "@/components/mushaf/AyahDetailModal";
import { TafsirSourcePicker } from "@/components/settings/TafsirSourcePicker";
import { DisclosureRow } from "@/components/ui/MirroredRow";
import { ensureTafsirSourceImported } from "@/lib/database/init";
import { DirectionProvider } from "@/lib/ui/direction";
import { strings } from "@/lib/i18n/strings";
import { interpolate, stringByKey } from "@/lib/i18n/useStrings";
import type { useSettings } from "@/lib/settings/context";
import { AVAILABLE_TAFSIR_SOURCES, type TafsirSourceId } from "@/lib/tafsir/sources";

type PickerProps = ComponentProps<typeof TafsirSourcePicker>;
let mockPickerProps: PickerProps | undefined;
let mockRows: { source: TafsirSourceId; text: string }[] = [];
let mockTafsirFailure: Error | null = null;
let mockQiraat: { text: string; ayah_group: string | null } | null = null;
let mockSupabaseConfigured = false;
const mockForbidden = jest.fn<never, unknown[]>(() => {
  throw new Error("Unexpected fixture side effect");
});
const mockSetSource = jest.fn<void, [TafsirSourceId]>();
const mockToast = jest.fn<void, [string]>();
const mockNavigateToAyah = jest.fn();
const mockRouterNavigate = jest.fn();
const mockTafsirRead = jest.fn(async () => {
  if (mockTafsirFailure) throw mockTafsirFailure;
  return mockRows.map((row) => ({ ...row }));
});
const mockDatabase = {
  getFirstAsync: jest.fn(async (sql: string, params?: number[]) => {
    if (!sql.trimStart().startsWith("SELECT")) return mockForbidden(sql);
    if (sql.includes("FROM translations")) return { text_en: "Synthetic translation body" };
    if (sql.includes("JOIN surahs")) {
      return { text_uthmani: "نص", text_qcf2: "a b", v2_page: 1, surah_name_arabic: "الفاتحة", surah_name_english: "Al-Fatihah" };
    }
    if (sql.includes("surah > ?")) return params?.[2] === 1 ? { surah: 1, ayah: 2 } : null;
    if (sql.includes("qiraat_encyclopedia")) return mockQiraat;
    return null;
  }),
  getAllAsync: jest.fn(async (sql: string) => {
    if (sql === "SELECT source, text FROM tafseer WHERE surah = ? AND ayah = ?") return mockTafsirRead();
    if (sql === "SELECT source, COUNT(*) as count FROM tafseer GROUP BY source") return [];
    return mockForbidden(sql);
  }),
  runAsync: mockForbidden,
};
const mockSettings: Partial<ReturnType<typeof useSettings>> = {
  setTafseerSource: mockSetSource,
  tafseerSource: "muyassar",
  translationLanguage: "en",
};
const mockSelection = { isBookmarked: () => false, showToast: mockToast, refreshBookmarks: mockForbidden };
const mockAudio = {
  getAyahState: () => ({ active: false, playing: false, loading: false }),
  toggleAyah: mockForbidden,
};
const target = { surah: 1, ayah: 1 };
const download: TafsirSourceId = "qurtubi";
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");

jest.mock("expo-router", () => ({ router: { navigate: (...args: unknown[]) => mockRouterNavigate(...args) } }));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/database/init", () => ({ ensureTafsirSourceImported: jest.fn() }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => ({ ...actual.useSettings(), ...mockSettings }) };
});
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => mockSupabaseConfigured, supabase: {} }));
jest.mock("@/lib/selection/context", () => ({ useSelection: () => mockSelection }));
jest.mock("@/lib/audio/ayah-audio", () => ({ useAyahAudio: () => mockAudio }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfContentEnabled: () => false, isRecitationEnabled: () => false }));
jest.mock("@/components/reflections/ReflectionsSection", () => ({ ReflectionsSection: () => null }));
jest.mock("@/components/notes/PrivateNotesSection", () => ({ PrivateNotesSection: () => null }));
jest.mock("@/components/mushaf/word-tabs/QiraatTab", () => ({ QiraatTab: () => null }));
jest.mock("@/components/mushaf/ayah-tabs/HadithTab", () => ({ HadithTab: () => null }));
jest.mock("@/lib/selection/queries", () => ({
  addBookmark: (...a: unknown[]) => mockForbidden(...a),
  removeBookmark: (...a: unknown[]) => mockForbidden(...a),
  fetchSurahName: (...a: unknown[]) => mockForbidden(...a),
}));
jest.mock("@/lib/fonts/loader", () => ({
  isQuranPageFontLoaded: () => true,
  loadQuranPageFont: (...a: unknown[]) => mockForbidden(...a),
  quranPageFontName: () => "SyntheticFont",
  quranPageFontPaletteStyle: () => ({}),
  quranPageMarkerFontPaletteStyle: () => ({}),
}));
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

function deferred() {
  let resolveValue: (() => void) | undefined;
  let rejectValue: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return {
    promise,
    resolve() {
      resolveValue?.();
    },
    reject(error: Error) {
      rejectValue?.(error);
    },
  };
}
function picker() {
  if (!mockPickerProps) throw new Error("Missing picker");
  return mockPickerProps;
}
function Wrapper({ children }: React.PropsWithChildren) {
  const window = Dimensions.get("window");
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: window.width, height: window.height },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      <OperationNoticeProvider ready>
        <DirectionProvider dir={mockSettings.isRTL ? "rtl" : "ltr"}>{children}</DirectionProvider>
      </OperationNoticeProvider>
    </SafeAreaProvider>
  );
}
const cases = [
  { language: "ar", width: 390 },
  { language: "en", width: 1280 },
] satisfies { language: "ar" | "en"; width: number }[];

describe.each(cases)("ayah detail $language/$width", ({ language, width }) => {
  let pending: ReturnType<typeof deferred>;
  let warn: jest.SpyInstance;
  let expectedWarnings: number;
  const s = strings[language];
  function label(id: TafsirSourceId) {
    const source = AVAILABLE_TAFSIR_SOURCES.find((item) => item.id === id);
    if (!source) throw new Error("Missing fixture source");
    return stringByKey(s, source.labelKey, id);
  }
  function tabLabels(view: ReturnType<typeof render>) {
    return view.getAllByRole("tab").map((tab) => {
      const text = tab.findByType(require("react-native").Text);
      return String(text.props.children);
    });
  }
  async function renderModal(props: Partial<ComponentProps<typeof AyahDetailModal>> = {}) {
    const view = render(<AyahDetailModal target={target} onClose={() => undefined} {...props} />, { wrapper: Wrapper });
    await act(async () => {});
    return view;
  }
  async function openPicker() {
    const view = await renderModal();
    fireEvent.press(view.getByRole("button", { name: s.tafseerManageSources }));
    await act(async () => {});
    expect(picker().visible).toBe(true);
    return view;
  }
  function downloadRow(view: ReturnType<typeof render>) {
    const row = view
      .UNSAFE_getAllByType(DisclosureRow)
      .find((item) => String(item.props.accessibilityLabel).startsWith(label(download)));
    if (!row) throw new Error("Missing download row");
    return row;
  }
  beforeEach(() => {
    jest.clearAllMocks();
    mockPickerProps = undefined;
    mockTafsirFailure = null;
    mockQiraat = null;
    mockSupabaseConfigured = false;
    expectedWarnings = 0;
    mockRows = [{ source: "muyassar", text: "Synthetic initial tafsir body" }];
    Object.assign(mockSettings, {
      uiLanguage: language,
      isRTL: language === "ar",
      tafseerSource: "muyassar",
      translationLanguage: "en",
    });
    mockSetSource.mockReset();
    pending = deferred();
    jest.mocked(ensureTafsirSourceImported).mockReset().mockReturnValue(pending.promise);
    const screen = { width, height: 844, scale: 1, fontScale: 1 };
    Dimensions.set({ window: screen, screen });
    jest.replaceProperty(I18nManager, "isRTL", language === "ar");
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    try {
      await act(async () => pending.resolve());
      cleanup();
      expect(mockForbidden).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(expectedWarnings);
    } finally {
      jest.restoreAllMocks();
      Dimensions.set({ window: originalWindow, screen: originalScreen });
    }
  });

  it("orders text tabs and keeps Translation in either interface language", async () => {
    const view = await renderModal();
    const translationLabel = interpolate(s.ayahDetailTranslationTab, { language: "English" });
    expect(tabLabels(view)).toEqual([translationLabel, s.tafseer, s.privateNotes]);
  });

  it("offers Qira'at only with known data and Reflections only when the service is configured", async () => {
    mockQiraat = { text: "قرئ: نص", ayah_group: null };
    mockSupabaseConfigured = true;
    const view = await renderModal();
    expect(tabLabels(view).slice(-3)).toEqual([s.privateNotes, s.wordTabQiraat, s.reflections]);
  });

  it("downloads from the picker, saves the source and returns to the tafsir tab showing it", async () => {
    const view = await openPicker();
    const reads = mockTafsirRead.mock.calls.length;
    fireEvent.press(downloadRow(view));
    expect(ensureTafsirSourceImported).toHaveBeenCalledWith(mockDatabase, download);
    expect(mockSetSource).not.toHaveBeenCalled();
    mockRows.push({ source: download, text: "Synthetic imported tafsir body" });
    mockSettings.tafseerSource = download;
    await act(async () => pending.resolve());
    expect(mockSetSource).toHaveBeenCalledWith(download);
    expect(picker().visible).toBe(false);
    expect(mockTafsirRead).toHaveBeenCalledTimes(reads + 1);
    expect(view.getByText("Synthetic imported tafsir body")).toBeTruthy();
  });

  it("keeps a failed download inline in the picker with Retry and no toast", async () => {
    const view = await openPicker();
    fireEvent.press(downloadRow(view));
    expectedWarnings = 1;
    await act(async () => pending.reject(new Error("Synthetic import failure")));
    expect(mockSetSource).not.toHaveBeenCalled();
    expect(picker().visible).toBe(true);
    expect(view.getByText(s.tafsirDownloadFailed)).toBeTruthy();
    expect(view.getByText(s.detailRetry)).toBeTruthy();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does not save or reload when the picker closes before the download finishes", async () => {
    const view = await openPicker();
    const reads = mockTafsirRead.mock.calls.length;
    fireEvent.press(downloadRow(view));
    act(() => picker().onClose());
    await act(async () => pending.resolve());
    expect(mockSetSource).not.toHaveBeenCalled();
    expect(mockTafsirRead).toHaveBeenCalledTimes(reads);
  });

  it("keeps an available source chip local without importing, saving or reloading", async () => {
    mockRows.push({ source: "zilal", text: "Synthetic alternate tafsir body" });
    const view = await renderModal();
    const reads = mockTafsirRead.mock.calls.length;
    fireEvent.press(view.getByText(label("zilal")));
    expect(view.getByText("Synthetic alternate tafsir body")).toBeTruthy();
    expect(picker().selectedSource).toBe("zilal");
    expect(mockSetSource).not.toHaveBeenCalled();
    expect(ensureTafsirSourceImported).not.toHaveBeenCalled();
    expect(mockTafsirRead).toHaveBeenCalledTimes(reads);
  });

  it("names a missing preferred source and the one shown instead", async () => {
    mockSettings.tafseerSource = "zilal";
    const view = await renderModal();
    const notice = `${interpolate(s.tafsirSourceMissing, { name: label("zilal") })} ${interpolate(s.tafsirShowingSource, {
      name: label("muyassar"),
    })}`;
    expect(view.getByText(notice)).toBeTruthy();
    expect(view.getByText("Synthetic initial tafsir body")).toBeTruthy();
  });

  it("offers another tafsir when no source has text for the ayah", async () => {
    mockRows = [];
    const view = await renderModal();
    expect(view.getByText(s.noTafseerData)).toBeTruthy();
    fireEvent.press(view.getByText(s.tafsirGetAnother));
    await act(async () => {});
    expect(picker().visible).toBe(true);
  });

  it("shows a failed tafsir read as an error with Retry", async () => {
    mockTafsirFailure = new Error("Synthetic read failure");
    expectedWarnings = 1;
    const view = await renderModal();
    expect(view.getByText(s.tafsirLoadFailed)).toBeTruthy();
    expect(view.queryByText(s.noTafseerData)).toBeNull();
    mockTafsirFailure = null;
    fireEvent.press(view.getByText(s.detailRetry));
    await act(async () => {});
    expect(view.getByText("Synthetic initial tafsir body")).toBeTruthy();
  });

  it("steps ayahs without moving the reader, then offers Go to this ayah", async () => {
    const onClose = jest.fn();
    const view = await renderModal({ onClose });
    expect(view.queryByText(s.ayahDetailGoToAyah)).toBeNull();
    fireEvent.press(view.getByRole("button", { name: s.nextAyah }));
    await act(async () => {});
    expect(mockNavigateToAyah).not.toHaveBeenCalled();
    expect(mockRouterNavigate).not.toHaveBeenCalled();
    fireEvent.press(view.getByText(s.ayahDetailGoToAyah));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockRouterNavigate).toHaveBeenCalledWith("/(tabs)/mushaf");
  });
});
