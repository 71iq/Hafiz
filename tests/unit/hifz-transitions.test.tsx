import React, { type ComponentProps } from "react";
import { Dimensions } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import MushafScreen from "@/app/(tabs)/mushaf";
import type { PageMushaf } from "@/components/mushaf/PageMushaf";
import type { useSettings } from "@/lib/settings/context";
import { strings } from "@/lib/i18n/strings";

type PageProps = ComponentProps<typeof PageMushaf>;
let mockPageProps: PageProps | undefined;
const mockSettings: Partial<ReturnType<typeof useSettings>> = {};
let mockWordCounts = [3, 2];
const mockGoToPage = jest.fn<void, [number]>();
const mockForbidden = jest.fn<never, unknown[]>(() => {
  throw new Error("Unexpected fixture side effect");
});
const mockWord = { navigateToAyah: null, detailWord: null, setNavigateToAyah: jest.fn(), closeDetail: jest.fn() };
const mockSelection = { selection: null };
const mockChrome = { visible: true, setVisible: jest.fn(), setImmersive: jest.fn() };
const pageSQL = "SELECT surah, ayah, text_qcf2 FROM quran_text WHERE v2_page = ? ORDER BY surah, ayah";
const mockDatabase = {
  getAllAsync: jest.fn(async (sql: string) => {
    if (sql !== pageSQL) return mockForbidden(sql);
    return mockWordCounts.map((count, i) => ({
      surah: 1,
      ayah: i + 1,
      text_qcf2: [...Array.from({ length: count }, () => "WORD"), "MARKER"].join(" "),
    }));
  }),
  getFirstAsync: jest.fn(async (sql: string) => {
    if (sql !== "SELECT value FROM user_settings WHERE key = 'last_mushaf_position'") return mockForbidden(sql);
    return null;
  }),
  runAsync: mockForbidden,
};
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");

jest.mock("expo-router", () => ({
  useFocusEffect: () => undefined,
  router: { push: (...a: unknown[]) => mockForbidden(...a) },
}));
jest.mock("react-native-reanimated", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: number) => React.useRef({ value }).current,
    useAnimatedStyle: (style: () => object) => style(),
    withTiming: (value: number) => value,
  };
});
jest.mock("@shopify/flash-list", () => ({ FlashList: () => null }));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/database/user-settings", () => ({ writeUserSetting: jest.fn(async () => undefined) }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => ({ ...actual.useSettings(), ...mockSettings }) };
});
jest.mock("@/lib/word/context", () => ({
  WordInteractionProvider: ({ children }: React.PropsWithChildren) => children,
  useWordInteraction: () => mockWord,
}));
jest.mock("@/lib/selection/context", () => ({
  SelectionProvider: ({ children }: React.PropsWithChildren) => children,
  useSelection: () => mockSelection,
}));
jest.mock("@/lib/ui/chrome", () => ({ useChrome: () => mockChrome, useChromeActions: () => mockChrome }));
jest.mock("@/lib/deep-link", () => ({ consumePendingDeepLink: () => null, peekPendingDeepLink: () => null }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfContentEnabled: () => false, isRecitationEnabled: () => false }));
jest.mock("@/lib/audio/ayah-audio", () => ({
  useAyahAudio: () => ({
    rangeState: { active: false, playing: false, paused: false, loading: false, currentAyah: null, currentIndex: 0, totalAyahs: 0 },
    stop: jest.fn(),
    togglePause: jest.fn(),
    getAyahState: () => ({ active: false, playing: false, loading: false }),
    toggleAyah: jest.fn(),
    playRange: jest.fn(),
  }),
}));
jest.mock("@/lib/fonts/loader", () => ({ loadQuranPageFont: (...a: unknown[]) => mockForbidden(...a) }));
jest.mock("@/lib/mushaf/position", () => {
  const actual = jest.requireActual<typeof import("@/lib/mushaf/position")>("@/lib/mushaf/position");
  return {
    ...actual,
    loadMushafIndex: async () => ({ juzRows: [], hizbRows: [], surahByNumber: new Map(), pageByNumber: new Map() }),
  };
});
jest.mock("@/components/mushaf/PageMushaf", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    PageMushaf: (props: PageProps) => {
      mockPageProps = props;
      const { goToPageRef, onPageChange } = props;
      React.useEffect(() => {
        if (!goToPageRef || !onPageChange) throw new Error("Missing reader navigation contract");
        goToPageRef.current = (page: number) => {
          mockGoToPage(page);
          onPageChange(page);
        };
        return () => {
          goToPageRef.current = null;
        };
      }, [goToPageRef, onPageChange]);
      return null;
    },
  };
});
jest.mock("@/components/mushaf/SurahHeader", () => ({ SurahHeader: () => null }));
jest.mock("@/components/mushaf/AyahBlock", () => ({ AyahBlock: () => null }));
jest.mock("@/components/mushaf/GoToNavigator", () => ({ GoToNavigator: () => null }));
jest.mock("@/components/mushaf/MushafIndicator", () => ({ MushafIndicator: () => null }));
jest.mock("@/components/mushaf/MushafSlider", () => ({ MushafSlider: () => null }));
jest.mock("@/components/mushaf/FocusModeControls", () => ({ FocusModeControls: () => null }));
jest.mock("@/components/mushaf/WordDetailSheet", () => ({ WordDetailSheet: () => null }));
jest.mock("@/components/mushaf/RecitationRangeSheet", () => ({ RecitationRangeSheet: () => null }));
jest.mock("@/components/mushaf/ReadingSettingsSheet", () => ({ ReadingSettingsSheet: () => null }));
jest.mock("@/components/mushaf/PageViewNavigationSheet", () => ({ PageViewNavigationSheet: () => null }));
jest.mock("@/components/mushaf/WordTooltip", () => ({ FloatingWordTooltip: () => null }));
jest.mock("@/components/mushaf/SelectionActionBar", () => ({ SelectionActionBar: () => null }));
jest.mock("@/components/mushaf/WebSelectionMenu", () => ({ WebSelectionMenu: () => null }));
jest.mock("@/components/mushaf/BookmarksSheet", () => ({ BookmarksSheet: () => null }));
jest.mock("@/components/SearchCommand", () => ({ SearchCommand: () => null }));
jest.mock("@/components/ui/Toast", () => ({ Toast: () => null }));

function page() {
  const props = mockPageProps;
  if (!props || !props.goToPageRef || !props.onPageChange) throw new Error("Missing page fixture contract");
  return { ...props, goToPageRef: props.goToPageRef, onPageChange: props.onPageChange };
}
function progress() {
  const visibility = page().hifzVisibility;
  if (!visibility) throw new Error("Hifz is not enabled");
  return {
    revealedAyahCount: visibility.revealedAyahCount,
    activeAyahKey: visibility.activeAyahKey,
    activeVisibleWordCount: visibility.activeVisibleWordCount,
  };
}
const hidden = { revealedAyahCount: 0, activeAyahKey: null, activeVisibleWordCount: 0 };
function Wrapper({ children }: React.PropsWithChildren) {
  const w = Dimensions.get("window");
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: w.width, height: w.height },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}

const cases = [
  { language: "ar", width: 390 },
  { language: "en", width: 1280 },
] satisfies { language: "ar" | "en"; width: number }[];
describe.each(cases)("Hifz owner $language/$width", ({ language, width }) => {
  let errors: jest.SpyInstance;
  let warnings: jest.SpyInstance;
  const s = strings[language];
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockPageProps = undefined;
    mockWordCounts = [3, 2];
    Object.assign(mockSettings, {
      uiLanguage: language,
      isRTL: language === "ar",
      isDark: false,
      isLoaded: true,
      viewMode: "page",
      pageScroll: "horizontal",
      hifzAutoDelayMs: 1000,
      hifzAutoAdvancePage: false,
    });
    Dimensions.set({
      window: { width, height: 850, scale: 1, fontScale: 1 },
      screen: { width, height: 850, scale: 1, fontScale: 1 },
    });
    errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    warnings = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    expect(mockForbidden).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
    jest.useRealTimers();
    Dimensions.set({ window: originalWindow, screen: originalScreen });
  });
  async function open(enable = true) {
    const view = render(<MushafScreen />, { wrapper: Wrapper });
    await act(async () => {});
    if (enable) fireEvent.press(view.getByLabelText(s.hifzMode));
    return view;
  }
  function press(view: ReturnType<typeof render>, label: string) {
    fireEvent.press(view.getByRole("button", { name: label }));
  }
  async function tick(ms = 1000) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  }

  it("starts disabled and enables with a blank page", async () => {
    const view = await open(false);
    expect(page().hifzVisibility).toBeNull();
    fireEvent.press(view.getByLabelText(s.hifzMode));
    expect(progress()).toEqual(hidden);
    expect(view.getByRole("button", { name: s.hifzHidePreviousAyah })).toBeDisabled();
    expect(view.getByRole("button", { name: s.hifzRevealNextAyah })).toBeEnabled();
  });
  it("manual next reveals whole ayahs and clamps at the final ayah", async () => {
    const view = await open();
    press(view, s.hifzRevealNextAyah);
    expect(progress()).toEqual({ ...hidden, revealedAyahCount: 1 });
    press(view, s.hifzRevealNextAyah);
    expect(progress()).toEqual({ ...hidden, revealedAyahCount: 2 });
    expect(view.getByRole("button", { name: s.hifzRevealNextAyah })).toBeDisabled();
    press(view, s.hifzRevealNextAyah);
    expect(progress().revealedAyahCount).toBe(2);
  });
  it("auto reveals one word then manual next completes that ayah and pauses", async () => {
    const view = await open();
    press(view, s.hifzContinueAutoReveal);
    await tick(999);
    expect(progress()).toEqual(hidden);
    await tick(1);
    expect(progress()).toEqual({ ...hidden, activeAyahKey: "1:1", activeVisibleWordCount: 1 });
    press(view, s.hifzRevealNextAyah);
    expect(progress()).toEqual({ ...hidden, revealedAyahCount: 1 });
    await tick(4000);
    expect(progress().revealedAyahCount).toBe(1);
    expect(view.getByRole("button", { name: s.hifzContinueAutoReveal })).toBeOnTheScreen();
  });
  it("previous clears a partial ayah before decrementing fully revealed ayahs", async () => {
    const view = await open();
    press(view, s.hifzRevealNextAyah);
    press(view, s.hifzContinueAutoReveal);
    await tick();
    expect(progress()).toEqual({ ...hidden, revealedAyahCount: 1, activeAyahKey: "1:2", activeVisibleWordCount: 1 });
    press(view, s.hifzHidePreviousAyah);
    expect(progress()).toEqual({ ...hidden, revealedAyahCount: 1 });
    press(view, s.hifzHidePreviousAyah);
    expect(progress()).toEqual(hidden);
    expect(view.getByRole("button", { name: s.hifzHidePreviousAyah })).toBeDisabled();
  });
  it("zero-word ayahs complete on one tick without inventing a visible word", async () => {
    mockWordCounts = [0, 2];
    const view = await open();
    press(view, s.hifzContinueAutoReveal);
    await tick();
    expect(progress()).toEqual({ ...hidden, revealedAyahCount: 1 });
    await tick();
    expect(progress()).toEqual({ ...hidden, revealedAyahCount: 1, activeAyahKey: "1:2", activeVisibleWordCount: 1 });
    await tick();
    expect(progress()).toEqual({ ...hidden, revealedAyahCount: 2 });
    expect(view.getByRole("button", { name: s.hifzContinueAutoReveal })).toBeOnTheScreen();
  });
  it("empty pages keep auto running without progress or navigation", async () => {
    mockWordCounts = [];
    const view = await open();
    press(view, s.hifzContinueAutoReveal);
    await tick(3000);
    expect(progress()).toEqual(hidden);
    expect(mockGoToPage).not.toHaveBeenCalled();
    expect(view.getByRole("button", { name: s.hifzPauseAutoReveal })).toBeOnTheScreen();
  });
  it("completion stops immediately when automatic page advance is disabled", async () => {
    mockWordCounts = [1];
    const view = await open();
    press(view, s.hifzContinueAutoReveal);
    await tick();
    expect(progress()).toEqual({ ...hidden, revealedAyahCount: 1 });
    expect(view.getByRole("button", { name: s.hifzContinueAutoReveal })).toBeOnTheScreen();
    await tick(3000);
    expect(mockGoToPage).not.toHaveBeenCalled();
  });
  it("automatic page advance preserves the final revealed tick then resets on the next tick", async () => {
    mockSettings.hifzAutoAdvancePage = true;
    mockWordCounts = [1];
    const view = await open();
    press(view, s.hifzContinueAutoReveal);
    await tick();
    expect(page().currentPage).toBe(1);
    expect(progress().revealedAyahCount).toBe(1);
    expect(mockGoToPage).not.toHaveBeenCalled();
    expect(view.getByRole("button", { name: s.hifzPauseAutoReveal })).toBeOnTheScreen();
    await tick();
    expect(mockGoToPage).toHaveBeenCalledTimes(1);
    expect(mockGoToPage).toHaveBeenCalledWith(2);
    expect(page().currentPage).toBe(2);
    expect(progress()).toEqual(hidden);
    expect(view.getByRole("button", { name: s.hifzPauseAutoReveal })).toBeOnTheScreen();
  });
  it("page 604 stops on the final reveal instead of scheduling page 605", async () => {
    mockSettings.hifzAutoAdvancePage = true;
    mockWordCounts = [1];
    const view = await open();
    await act(async () => {
      page().onPageChange(604);
    });
    press(view, s.hifzContinueAutoReveal);
    await tick();
    expect(progress().revealedAyahCount).toBe(1);
    expect(page().currentPage).toBe(604);
    expect(view.getByRole("button", { name: s.hifzContinueAutoReveal })).toBeOnTheScreen();
    await tick(3000);
    expect(mockGoToPage).not.toHaveBeenCalled();
  });
  it("manual page changes reset progress and stop automatic reveal", async () => {
    const view = await open();
    press(view, s.hifzContinueAutoReveal);
    await tick();
    await act(async () => {
      page().onPageChange(3);
    });
    expect(progress()).toEqual(hidden);
    expect(view.getByRole("button", { name: s.hifzContinueAutoReveal })).toBeOnTheScreen();
    await tick(2000);
    expect(progress()).toEqual(hidden);
  });
  it("pause and resume retain partial progress", async () => {
    const view = await open();
    press(view, s.hifzContinueAutoReveal);
    await tick();
    press(view, s.hifzPauseAutoReveal);
    await tick(2000);
    expect(progress().activeVisibleWordCount).toBe(1);
    press(view, s.hifzContinueAutoReveal);
    await tick();
    expect(progress().activeVisibleWordCount).toBe(2);
  });
  it("disabling Hifz clears progress and timers before re-enabling", async () => {
    const view = await open();
    press(view, s.hifzContinueAutoReveal);
    await tick();
    fireEvent.press(view.getByLabelText(s.hifzMode));
    expect(page().hifzVisibility).toBeNull();
    await tick(2000);
    fireEvent.press(view.getByLabelText(s.hifzMode));
    expect(progress()).toEqual(hidden);
    expect(view.getByRole("button", { name: s.hifzContinueAutoReveal })).toBeOnTheScreen();
  });
  it("unmount clears pending timers", async () => {
    const view = await open();
    press(view, s.hifzContinueAutoReveal);
    await tick();
    view.unmount();
    // React act queues a microtask that Jest includes in its timer count.
    // Drain jobs without advancing any timeout or interval before checking cleanup.
    jest.runAllTicks();
    expect(jest.getTimerCount()).toBe(0);
  });
});
