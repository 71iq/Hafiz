import React, { memo, useLayoutEffect } from "react";
import { Dimensions, I18nManager, Platform, Text } from "react-native";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { SurahHeader } from "@/components/mushaf/SurahHeader";
import { MushafPage, type PageLineLayout } from "@/components/mushaf/MushafPage";

type Settings = ReturnType<typeof useSettings>;
type Counter = "font" | "theme" | "actions" | "header" | "page" | "control";
const mockCounts: Record<Counter, number> = { font: 0, theme: 0, actions: 0, header: 0, page: 0, control: 0 };
const changedCounts = { font: 1, theme: 1, actions: 1, header: 2, page: 1, control: 0 };
const noCounts = { font: 0, theme: 0, actions: 0, header: 0, page: 0, control: 0 };
const mockMeasurementContext = React.createContext<Counter | null>(null);
let latest: Settings | undefined;
let saved: Map<string, string>;
let frames: FrameRequestCallback[];
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");
const mockSetColorScheme = jest.fn();
const mockEnqueueSync = jest.fn<Promise<void>, unknown[]>(async () => undefined);
const mockImportTranslation = jest.fn<Promise<void>, unknown[]>(async () => {
  throw new Error("Translation imports forbidden in this fixture");
});
const mockLoadFont = jest.fn<Promise<void>, unknown[]>(async () => {
  throw new Error("Font loading forbidden in this cached-font fixture");
});
const mockSelection = {
  getHighlightColor: () => undefined,
  getWordHighlightColor: () => undefined,
  selectAyah: jest.fn(),
};
const mockDatabase = {
  getAllAsync: jest.fn<Promise<{ key: string; value: string }[]>, [string, readonly unknown[]]>(async (query, keys) => {
    if (!query.includes("FROM user_settings")) throw new Error("Unexpected settings read");
    return keys.flatMap((key) => {
      if (typeof key !== "string") throw new Error("Unexpected settings key");
      const value = saved.get(key);
      return value === undefined ? [] : [{ key, value }];
    });
  }),
  runAsync: jest.fn<Promise<{ changes: number; lastInsertRowId: number }>, [string, readonly unknown[]]>(
    async (query, parameters) => {
      if (!query.startsWith("INSERT OR REPLACE INTO user_settings")) throw new Error("Unexpected settings write");
      const [key, value] = parameters;
      if (typeof key !== "string" || typeof value !== "string") throw new Error("Unexpected setting parameters");
      saved.set(key, value);
      return { changes: 1, lastInsertRowId: 0 };
    },
  ),
  // Syncable settings commit with their queue entry; the queue module is mocked below.
  withTransactionAsync: async (task: (transaction: unknown) => Promise<void>) => task(mockDatabase),
};

// Preserve the real context value; count committed useSettings call effects.
// SurahHeader calls it twice, through useStrings and its own field read.
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  const runtime = jest.requireActual<typeof import("react")>("react");
  function useMeasuredSettings() {
    const settings = actual.useSettings();
    const id = runtime.useContext(mockMeasurementContext);
    runtime.useLayoutEffect(() => {
      if (id) mockCounts[id]++;
    });
    return settings;
  }
  return { ...actual, useSettings: useMeasuredSettings };
});

jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDatabase,
  useDatabaseStatus: () => ({ db: mockDatabase, isReady: true, progress: null, error: null }),
}));
jest.mock("nativewind", () => ({
  useColorScheme: () => ({ setColorScheme: mockSetColorScheme }),
  vars: (variables: Record<string, string>) => variables,
}));
jest.mock("@/lib/database/sync-queue", () => ({ enqueueSync: (...args: unknown[]) => mockEnqueueSync(...args) }));
jest.mock("@/lib/translations/import", () => ({
  importTranslation: (...args: unknown[]) => mockImportTranslation(...args),
}));
jest.mock("@/lib/selection/context", () => ({ useSelection: () => mockSelection }));
jest.mock("@/components/mushaf/SurahInfoModal", () => ({ SurahInfoModal: () => null }));
jest.mock("@/components/mushaf/WordToken", () => ({ WordToken: () => null }));
jest.mock("@/lib/fonts/loader", () => ({
  isSurahNameFontLoaded: () => true,
  loadSurahNameFont: (...args: unknown[]) => mockLoadFont(...args),
  surahNameGlyph: () => undefined,
  surahNameBismillahGlyphs: () => "Fixture-Bismillah",
  surahNameFontName: () => "Fixture-Surah-Font",
  isQuranPageFontLoaded: () => true,
  loadQuranPageFont: (...args: unknown[]) => mockLoadFont(...args),
  quranPageFontName: () => "Fixture-Page-Font",
  quranPageFontPaletteStyle: () => ({}),
  quranPageMarkerFontPaletteStyle: () => ({}),
}));

const FontProbe = memo(function FontProbe() {
  const value = useSettings().fontSizeIndex;
  return <Text testID="font-index">{value}</Text>;
});
const ThemeProbe = memo(function ThemeProbe() {
  const value = useSettings().theme;
  return <Text testID="theme">{value}</Text>;
});
const ActionsProbe = memo(function ActionsProbe() {
  const setter = useSettings().setFontSizeIndex;
  return <Text>{typeof setter}</Text>;
});
const Control = memo(function Control({ label }: { label: string }) {
  useLayoutEffect(() => {
    mockCounts.control++;
  });
  return <Text>{label}</Text>;
});
function CaptureSettings() {
  const value = useSettings();
  useLayoutEffect(() => {
    latest = value;
  });
  return null;
}
function current() {
  if (!latest) throw new Error("Settings were not captured");
  return latest;
}
function measure(id: Counter, children: React.ReactNode) {
  return <mockMeasurementContext.Provider value={id}>{children}</mockMeasurementContext.Provider>;
}
function resetCounts() {
  Object.assign(mockCounts, noCounts);
}
const pageSurahs: React.ComponentProps<typeof MushafPage>["surahMap"] = new Map();
const layout: PageLineLayout[] = [
  { line_number: 1, line_type: "basmallah", is_centered: 1, first_word_id: null, last_word_id: null, surah_number: 2 },
];
function subject(controlLabel = "Unsubscribed control") {
  return (
    <SettingsProvider>
      <CaptureSettings />
      {measure("font", <FontProbe />)}
      {measure("theme", <ThemeProbe />)}
      {measure("actions", <ActionsProbe />)}
      {measure(
        "header",
        <SurahHeader
          surahNumber={2}
          nameArabic="اسم تجريبي"
          nameEnglish="Fixture name"
          ayahCount={3}
          revelationType="Makkiyah"
          hideBismillah
          compact
        />,
      )}
      {measure(
        "page",
        <MushafPage
          pageNumber={1}
          ayahs={[]}
          surahMap={pageSurahs}
          fontSize={22}
          lineHeight={40}
          width={390}
          lineLayout={layout}
          usePageWords={false}
        />,
      )}
      {measure("control", <Control label={controlLabel} />)}
    </SettingsProvider>
  );
}
async function settle() {
  await act(async () => {
    for (let step = 0; frames.length && step < 10; step++) {
      const pending = frames.splice(0);
      pending.forEach((callback) => callback(0));
      await Promise.resolve();
    }
  });
  expect(frames).toHaveLength(0);
}
async function open() {
  const view = render(subject());
  await waitFor(() => expect(current().isLoaded).toBe(true));
  await settle();
  const stable = { ...mockCounts };
  await settle();
  expect(mockCounts).toEqual(stable);
  for (const count of Object.values(mockCounts)) expect(count).toBeGreaterThan(0);
  resetCounts();
  mockDatabase.runAsync.mockClear();
  mockEnqueueSync.mockClear();
  return view;
}
type Action = {
  name: string;
  key: string;
  apply: (settings: Settings) => void;
  value: (settings: Settings) => unknown;
  expected: string | number;
};
function actions(language: "en" | "ar"): Action[] {
  return [
    {
      name: "font size",
      key: "font_size_index",
      apply: (s) => s.setFontSizeIndex(3),
      value: (s) => s.fontSizeIndex,
      expected: 3,
    },
    { name: "theme", key: "theme", apply: (s) => s.setTheme("dark"), value: (s) => s.theme, expected: "dark" },
    {
      name: "UI language",
      key: "ui_language",
      apply: (s) => s.setUiLanguage(language === "en" ? "ar" : "en"),
      value: (s) => s.uiLanguage,
      expected: language === "en" ? "ar" : "en",
    },
    {
      name: "daily review limit",
      key: "daily_review_limit",
      apply: (s) => s.setDailyReviewLimit(30),
      value: (s) => s.dailyReviewLimit,
      expected: 30,
    },
    {
      name: "focus speed",
      key: "focus_scroll_speed",
      apply: (s) => s.setFocusScrollSpeed(1.25),
      value: (s) => s.focusScrollSpeed,
      expected: 1.25,
    },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  latest = undefined;
  frames = [];
  jest.replaceProperty(Platform, "OS", "android");
  const screen = { width: 390, height: 844, scale: 1, fontScale: 1 };
  Dimensions.set({ window: screen, screen });
  jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  if (typeof globalThis.fetch === "function")
    jest.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Remote calls forbidden in render fixture");
    });
});
afterEach(() => {
  cleanup();
  expect(mockLoadFont).not.toHaveBeenCalled();
  expect(mockImportTranslation).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

describe.each(["en", "ar"] satisfies ("en" | "ar")[])(
  "post-hydration committed settings-hook effects from %s",
  (language) => {
    beforeEach(() => {
      saved = new Map([
        ["ui_language", language],
        ["theme", "white"],
        ["font_size_index", "2"],
        ["translation_language", "en"],
        ["translation_active_lang", "en"],
        ["daily_review_limit", "20"],
        ["focus_scroll_speed", "1"],
      ]);
      jest.replaceProperty(I18nManager, "isRTL", language === "ar");
    });
    it.each(actions(language))(
      "measures changed $name hook effects and a repeated same-value update",
      async (action) => {
        const view = await open();
        const initialSetter = current().setFontSizeIndex;
        expect(current().uiLanguage).toBe(language);
        await act(async () => action.apply(current()));
        await settle();
        expect(action.value(current())).toBe(action.expected);
        expect(current().setFontSizeIndex).toBe(initialSetter);
        expect(mockCounts).toEqual(changedCounts);
        expect(saved.get(action.key)).toBe(String(action.expected));
        expect(mockDatabase.runAsync).toHaveBeenCalledTimes(1);
        expect(mockEnqueueSync).toHaveBeenCalledTimes(action.key === "daily_review_limit" ? 1 : 0);
        expect(view.getByText(current().uiLanguage === "ar" ? "اسم تجريبي" : "Fixture name")).toBeTruthy();
        expect(view.getByText("Fixture-Bismillah")).toBeTruthy();
        resetCounts();
        await act(async () => action.apply(current()));
        await settle();
        expect(mockCounts).toEqual(noCounts);
        expect(action.value(current())).toBe(action.expected);
        expect(mockDatabase.runAsync).toHaveBeenCalledTimes(2);
        expect(mockEnqueueSync).toHaveBeenCalledTimes(action.key === "daily_review_limit" ? 2 : 0);
      },
    );
    it("calibrates changed control props and parent-triggered context publication", async () => {
      const view = await open();
      const previous = current();
      view.rerender(subject("Changed control"));
      await settle();
      expect(mockCounts).toEqual({ ...changedCounts, control: 1 });
      expect(current()).not.toBe(previous);
      expect(current().setFontSizeIndex).toBe(previous.setFontSizeIndex);
      expect(current().fontSizeIndex).toBe(previous.fontSizeIndex);
      expect(current().theme).toBe(previous.theme);
      expect(current().uiLanguage).toBe(previous.uiLanguage);
      expect(mockDatabase.runAsync).not.toHaveBeenCalled();
      expect(mockEnqueueSync).not.toHaveBeenCalled();
      expect(view.getByText("Changed control")).toBeTruthy();
    });

    it("keeps invalid font-size updates outside both commits and persistence", async () => {
      await open();
      await act(async () => {
        current().setFontSizeIndex(-1);
        current().setFontSizeIndex(10);
      });
      await settle();
      expect(current().fontSizeIndex).toBe(2);
      expect(mockCounts).toEqual(noCounts);
      expect(mockDatabase.runAsync).not.toHaveBeenCalled();
      expect(mockEnqueueSync).not.toHaveBeenCalled();
    });
  },
);
