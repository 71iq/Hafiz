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
import { stringByKey } from "@/lib/i18n/useStrings";
import type { useSettings } from "@/lib/settings/context";
import { AVAILABLE_TAFSIR_SOURCES, type TafsirSourceId } from "@/lib/tafsir/sources";

type PickerProps = ComponentProps<typeof TafsirSourcePicker>;
let mockPickerProps: PickerProps | undefined;
let mockRows: { source: TafsirSourceId; text: string }[] = [];
const mockSelectionResults: Promise<boolean>[] = [];
const mockForbidden = jest.fn<never, unknown[]>(() => {
  throw new Error("Unexpected fixture side effect");
});
const mockSetSource = jest.fn<void, [TafsirSourceId]>();
const mockToast = jest.fn<void, [string]>();
const mockTafsirRead = jest.fn(async () => mockRows.map((row) => ({ ...row })));
const mockDatabase = {
  getFirstAsync: jest.fn(async (sql: string) => {
    if (!sql.trimStart().startsWith("SELECT")) return mockForbidden(sql);
    return null;
  }),
  getAllAsync: jest.fn(async (sql: string) => {
    if (sql === "SELECT source, text FROM tafseer WHERE surah = ? AND ayah = ?") return mockTafsirRead();
    if (sql === "SELECT source, COUNT(*) as count FROM tafseer GROUP BY source")
      return [{ source: "qurtubi", count: 6234 }];
    return mockForbidden(sql);
  }),
  runAsync: mockForbidden,
};
const mockSettings: Partial<ReturnType<typeof useSettings>> = {
  setTafseerSource: mockSetSource,
  tafseerSource: "muyassar",
};
const mockSelection = { isBookmarked: () => false, showToast: mockToast, refreshBookmarks: mockForbidden };
const mockAudio = {
  getAyahState: () => ({ active: false, playing: false, loading: false }),
  toggleAyah: mockForbidden,
};
const target = { surah: 1, ayah: 1 };
const sourceA: TafsirSourceId = "qurtubi";
const sourceB: TafsirSourceId = "zilal";
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/database/init", () => ({ ensureTafsirSourceImported: jest.fn() }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => ({ ...actual.useSettings(), ...mockSettings }) };
});
jest.mock("@/lib/selection/context", () => ({ useSelection: () => mockSelection }));
jest.mock("@/lib/audio/ayah-audio", () => ({ useAyahAudio: () => mockAudio }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfContentEnabled: () => false }));
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
      return React.createElement(actual.TafsirSourcePicker, {
        ...props,
        onSelect: (source: TafsirSourceId) => {
          const result = props.onSelect(source);
          mockSelectionResults.push(result);
          return result;
        },
      });
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
      if (!resolveValue) throw new Error("Missing resolver");
      resolveValue();
    },
    reject(error: Error) {
      if (!rejectValue) throw new Error("Missing rejecter");
      rejectValue(error);
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
      <DirectionProvider dir={mockSettings.isRTL ? "rtl" : "ltr"}>{children}</DirectionProvider>
    </SafeAreaProvider>
  );
}
const cases = [
  { language: "ar", width: 390 },
  { language: "en", width: 1280 },
] satisfies { language: "ar" | "en"; width: number }[];
describe.each(cases)("ayah tafsir $language/$width", ({ language, width }) => {
  let pending: ReturnType<typeof deferred>;
  let warn: jest.SpyInstance;
  let errors: jest.SpyInstance;
  let expectedWarnings: number;
  function label(id: TafsirSourceId) {
    const source = AVAILABLE_TAFSIR_SOURCES.find((s) => s.id === id);
    if (!source) throw new Error("Missing fixture source");
    return stringByKey(strings[language], source.labelKey, id);
  }
  async function open() {
    const view = render(<AyahDetailModal target={target} onClose={() => undefined} />, { wrapper: Wrapper });
    await act(async () => {});
    fireEvent.press(view.getByRole("button", { name: strings[language].tafseerManageSources }));
    await act(async () => {});
    expect(picker().visible).toBe(true);
    return view;
  }
  function begin(view: ReturnType<typeof render>) {
    fireEvent.press(view.getByText(label(sourceA)));
    const result = mockSelectionResults.at(-1);
    if (!result) throw new Error("Missing selection promise");
    return result;
  }
  function busy(view: ReturnType<typeof render>, value: boolean) {
    const rows = view.UNSAFE_getAllByType(DisclosureRow);
    expect(rows).toHaveLength(AVAILABLE_TAFSIR_SOURCES.length);
    expect(rows.every((row) => row.props.disabled === value)).toBe(true);
    expect(picker().importingSource).toBe(value ? sourceA : null);
    expect(
      view.getByRole("button", { name: strings[language].tafseerManageSources }).props.accessibilityState?.disabled ??
        view.getByRole("button", { name: strings[language].tafseerManageSources }).props.disabled,
    ).toBe(value);
  }
  async function complete(result: Promise<boolean>) {
    mockRows.push({ source: sourceA, text: "Synthetic imported tafsir body" });
    await act(async () => {
      pending.resolve();
      await result;
    });
    await expect(result).resolves.toBe(true);
  }
  beforeEach(() => {
    jest.clearAllMocks();
    mockPickerProps = undefined;
    mockSelectionResults.length = 0;
    expectedWarnings = 0;
    mockRows = [{ source: "muyassar", text: "Synthetic initial tafsir body" }];
    Object.assign(mockSettings, { uiLanguage: language, isRTL: language === "ar", tafseerSource: "muyassar" });
    mockSetSource.mockReset();
    pending = deferred();
    jest.mocked(ensureTafsirSourceImported).mockReset().mockReturnValue(pending.promise);
    const screen = { width, height: 844, scale: 1, fontScale: 1 };
    Dimensions.set({ window: screen, screen });
    jest.replaceProperty(I18nManager, "isRTL", language === "ar");
    if (typeof globalThis.fetch === "function")
      jest.spyOn(globalThis, "fetch").mockImplementation(() => mockForbidden("fetch"));
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    try {
      cleanup();
      expect(mockForbidden).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(expectedWarnings);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
      Dimensions.set({ window: originalWindow, screen: originalScreen });
    }
  });
  it("imports before saving, updates local selection and reloads displayed tafsir", async () => {
    const view = await open();
    const reads = mockTafsirRead.mock.calls.length;
    const result = begin(view);
    busy(view, true);
    expect(mockSetSource).not.toHaveBeenCalled();
    expect(ensureTafsirSourceImported).toHaveBeenCalledWith(mockDatabase, sourceA);
    expect(mockTafsirRead).toHaveBeenCalledTimes(reads);
    await complete(result);
    expect(mockSetSource).toHaveBeenCalledWith(sourceA);
    expect(picker().selectedSource).toBe(sourceA);
    expect(picker().visible).toBe(false);
    expect(mockTafsirRead).toHaveBeenCalledTimes(reads + 1);
    expect(view.getByText("Synthetic imported tafsir body")).toBeTruthy();
  });
  it("reports import failure without save or reload and permits successful retry", async () => {
    const view = await open();
    const reads = mockTafsirRead.mock.calls.length;
    const result = begin(view);
    const error = new Error("Synthetic import failure");
    expectedWarnings = 1;
    await act(async () => {
      pending.reject(error);
      await result;
    });
    await expect(result).resolves.toBe(false);
    busy(view, false);
    expect(picker().visible).toBe(true);
    expect(picker().selectedSource).toBe("muyassar");
    expect(mockSetSource).not.toHaveBeenCalled();
    expect(mockTafsirRead).toHaveBeenCalledTimes(reads);
    expect(warn).toHaveBeenCalledWith("[AyahDetailModal] Failed to import tafsir source:", error);
    expect(mockToast).toHaveBeenCalledWith(strings[language].tafseerSourceImportFailed);
    pending = deferred();
    jest.mocked(ensureTafsirSourceImported).mockReturnValue(pending.promise);
    const retry = begin(view);
    await complete(retry);
    expect(mockSetSource).toHaveBeenCalledTimes(1);
  });
  it("retains selection on a synchronous setter failure and releases the guard for retry", async () => {
    const view = await open();
    const reads = mockTafsirRead.mock.calls.length;
    const error = new Error("Synthetic setter failure");
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
    busy(view, false);
    expect(picker().selectedSource).toBe("muyassar");
    expect(mockTafsirRead).toHaveBeenCalledTimes(reads);
    expect(warn).toHaveBeenCalledWith("[AyahDetailModal] Failed to import tafsir source:", error);
    expect(mockToast).toHaveBeenCalledWith(strings[language].tafseerSourceImportFailed);
    pending = deferred();
    jest.mocked(ensureTafsirSourceImported).mockReturnValue(pending.promise);
    const retry = begin(view);
    await complete(retry);
    expect(mockSetSource).toHaveBeenCalledTimes(2);
  });
  it("returns true for the current available row without import, save or reload", async () => {
    await open();
    const reads = mockTafsirRead.mock.calls.length;
    await expect(picker().onSelect("muyassar")).resolves.toBe(true);
    expect(ensureTafsirSourceImported).not.toHaveBeenCalled();
    expect(mockSetSource).not.toHaveBeenCalled();
    expect(mockTafsirRead).toHaveBeenCalledTimes(reads);
  });
  it("closes the current included row through the actual picker without invoking selection", async () => {
    const view = await open();
    const index = AVAILABLE_TAFSIR_SOURCES.findIndex((s) => s.id === "muyassar");
    const row = view.UNSAFE_getAllByType(DisclosureRow)[index];
    if (!row) throw new Error("Missing current row");
    fireEvent.press(row);
    expect(picker().visible).toBe(false);
    expect(mockSelectionResults).toHaveLength(0);
    expect(ensureTafsirSourceImported).not.toHaveBeenCalled();
  });
  it("imports an already selected source when this ayah has no available row", async () => {
    mockRows = [];
    mockSettings.tafseerSource = sourceA;
    const view = await open();
    const reads = mockTafsirRead.mock.calls.length;
    let result: Promise<boolean> | undefined;
    await act(async () => {
      result = picker().onSelect(sourceA);
    });
    expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(1);
    if (!result) throw new Error("Missing result");
    await complete(result);
    expect(mockTafsirRead).toHaveBeenCalledTimes(reads + 1);
    expect(view.getByText("Synthetic imported tafsir body")).toBeTruthy();
  });
  it("blocks busy rendered rows and rejects selecting the current available source while busy", async () => {
    const view = await open();
    const result = begin(view);
    busy(view, true);
    let blocked: boolean | undefined;
    await act(async () => {
      fireEvent.press(view.getByText(label(sourceB)));
      blocked = await picker().onSelect("muyassar");
    });
    expect(blocked).toBe(false);
    expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(1);
    await complete(result);
  });
  it("blocks same-render and stale callbacks until the first import settles", async () => {
    const view = await open();
    const other = deferred();
    jest.mocked(ensureTafsirSourceImported).mockImplementation((db, source) => {
      expect(db).toBe(mockDatabase);
      if (source === sourceA) return pending.promise;
      if (source === sourceB) return other.promise;
      throw new Error("Unexpected source");
    });
    const stale = picker().onSelect;
    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    try {
      await act(async () => {
        first = stale(sourceA);
        second = stale(sourceB);
      });
      expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(1);
      await expect(second).resolves.toBe(false);
      busy(view, true);
      await expect(stale(sourceB)).resolves.toBe(false);
      expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(1);
      if (!first) throw new Error("Missing result");
      await complete(first);
      expect(mockSetSource).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        pending.resolve();
        other.resolve();
        await Promise.all([first, second]);
      });
    }
  });
  it("blocks the current cached-source shortcut in the same render as a new import", async () => {
    const view = await open();
    const stale = picker().onSelect;
    let first: Promise<boolean> | undefined;
    let cached: Promise<boolean> | undefined;
    try {
      await act(async () => {
        first = stale(sourceA);
        cached = stale("muyassar");
      });
      await expect(cached).resolves.toBe(false);
      expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(1);
      busy(view, true);
      if (!first) throw new Error("Missing result");
      await complete(first);
    } finally {
      await act(async () => {
        pending.resolve();
        await first;
      });
    }
  });
  it("keeps the import active after picker close and completes the existing reload", async () => {
    const view = await open();
    const reads = mockTafsirRead.mock.calls.length;
    const result = begin(view);
    act(() => picker().onClose());
    expect(picker().visible).toBe(false);
    expect(picker().importingSource).toBe(sourceA);
    await complete(result);
    expect(mockTafsirRead).toHaveBeenCalledTimes(reads + 1);
    expect(mockSetSource).toHaveBeenCalledWith(sourceA);
  });
  it("preserves save completion after the modal owner unmounts", async () => {
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
  it("keeps an available source pill local without importing, saving or reloading", async () => {
    mockRows.push({ source: sourceB, text: "Synthetic alternate tafsir body" });
    const view = render(<AyahDetailModal target={target} onClose={() => undefined} />, { wrapper: Wrapper });
    await act(async () => {});
    const reads = mockTafsirRead.mock.calls.length;
    fireEvent.press(view.getByText(label(sourceB)));
    expect(view.getByText("Synthetic alternate tafsir body")).toBeTruthy();
    expect(picker().selectedSource).toBe(sourceB);
    expect(mockSetSource).not.toHaveBeenCalled();
    expect(ensureTafsirSourceImported).not.toHaveBeenCalled();
    expect(mockTafsirRead).toHaveBeenCalledTimes(reads);
  });
});
