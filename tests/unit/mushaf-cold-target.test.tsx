import React, { type ComponentProps } from "react";
import { Dimensions } from "react-native";
import { act, cleanup, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import MushafScreen from "@/app/(tabs)/mushaf";
import type { PageMushaf } from "@/components/mushaf/PageMushaf";
import type { useSettings } from "@/lib/settings/context";

// The harness follows tests/unit/hifz-transitions.test.tsx. Its PageMushaf mock drops goToPageRef
// jumps until the pages have loaded, as the real component does, and applies the currentPage prop
// once they have.
type PageProps = ComponentProps<typeof PageMushaf>;
let mockPageProps: PageProps | undefined;
let mockPagesLoaded = false;
let mockSetPagesLoaded: ((loaded: boolean) => void) | null = null;
const mockSettings: Partial<ReturnType<typeof useSettings>> = {};
const mockGoToPage = jest.fn<void, [number]>();
const mockForbidden = jest.fn<never, unknown[]>(() => {
  throw new Error("Unexpected fixture side effect");
});
const mockWord = { navigateToAyah: null, detailWord: null, setNavigateToAyah: jest.fn(), closeDetail: jest.fn() };
const mockSelection = { selection: null };
const mockChrome = { visible: true, setVisible: jest.fn(), setImmersive: jest.fn() };
const pageSQL = "SELECT surah, ayah, text_qcf2 FROM quran_text WHERE v2_page = ? ORDER BY surah, ayah";
const targetPageSQL = "SELECT v2_page FROM quran_text WHERE surah = ? AND ayah = ?";
const mockDatabase = {
  getAllAsync: jest.fn(async (sql: string) => {
    if (sql !== pageSQL) return mockForbidden(sql);
    return [];
  }),
  getFirstAsync: jest.fn(async (sql: string, params?: unknown[]) => {
    // Al-Kahf 18:84 is on page 303 of the King Fahd Complex mushaf.
    if (sql === targetPageSQL && params?.[0] === 18 && params?.[1] === 84) return { v2_page: 303 };
    if (sql !== "SELECT value FROM user_settings WHERE key = 'last_mushaf_position'") return mockForbidden(sql);
    return null;
  }),
  runAsync: mockForbidden,
};
let mockPendingTarget: { surah: number; ayah: number } | null = null;
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");

jest.mock("expo-router", () => ({
  // The reader consumes its pending target on focus.
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual<typeof import("react")>("react").useEffect(effect, [effect]),
  router: { push: (...a: unknown[]) => mockForbidden(...a) },
}));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useIsFocused: () => true,
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
jest.mock("@/lib/hifz/use-weak-spots", () => ({
  useWeakSpotsLoader: () => undefined,
  useWeakSpotMarker: () => () => false,
}));
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
jest.mock("@/lib/deep-link", () => ({
  consumePendingDeepLink: () => {
    const target = mockPendingTarget;
    mockPendingTarget = null;
    return target;
  },
  peekPendingDeepLink: () => mockPendingTarget,
  subscribePendingDeepLink: () => () => undefined,
}));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: (select: (state: { user: null }) => unknown) => select({ user: null }),
}));
jest.mock("@/lib/quran-foundation/config", () => ({
  isQfContentEnabled: () => false,
  isRecitationEnabled: () => false,
}));
jest.mock("@/lib/audio/ayah-audio", () => ({
  useAyahAudio: () => ({
    rangeState: {
      active: false,
      playing: false,
      paused: false,
      loading: false,
      currentAyah: null,
      currentIndex: 0,
      totalAyahs: 0,
    },
    stop: jest.fn(),
    togglePause: jest.fn(),
    getAyahState: () => ({ active: false, playing: false, loading: false }),
    toggleAyah: jest.fn(),
    playRange: jest.fn(),
  }),
}));
jest.mock("@/lib/fonts/loader", () => ({ loadQuranPageFont: async () => undefined }));
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
      const { goToPageRef, onPageChange, currentPage } = props;
      const [loaded, setLoaded] = React.useState(mockPagesLoaded);
      mockSetPagesLoaded = setLoaded;
      const shownPage = React.useRef(1);
      React.useEffect(() => {
        if (!goToPageRef || !onPageChange) throw new Error("Missing reader navigation contract");
        goToPageRef.current = (page: number) => {
          mockGoToPage(page);
          // The real jumpToPage returns early while pageData is still empty.
          if (!loaded) return;
          shownPage.current = page;
          onPageChange(page);
        };
        return () => {
          goToPageRef.current = null;
        };
      }, [goToPageRef, loaded, onPageChange]);
      React.useEffect(() => {
        if (!loaded || currentPage === undefined || currentPage === shownPage.current) return;
        shownPage.current = currentPage;
        onPageChange?.(currentPage);
      }, [currentPage, loaded, onPageChange]);
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
jest.mock("@/components/mushaf/PageViewNavigationSheet", () => ({
  PageLayoutMenu: () => null,
  pageLayoutMenuItems: () => [],
}));
jest.mock("@/components/mushaf/WordTooltip", () => ({ FloatingWordTooltip: () => null }));
jest.mock("@/components/mushaf/SelectionActionBar", () => ({ SelectionActionBar: () => null }));
jest.mock("@/components/mushaf/WebSelectionMenu", () => ({ WebSelectionMenu: () => null }));
jest.mock("@/components/mushaf/BookmarksSheet", () => ({ BookmarksSheet: () => null }));
jest.mock("@/components/SearchCommand", () => ({ SearchCommand: () => null }));
jest.mock("@/components/ui/Toast", () => ({ Toast: () => null }));

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
describe.each(cases)("Cold page-view target $language/$width", ({ language, width }) => {
  let errors: jest.SpyInstance;
  let warnings: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockPageProps = undefined;
    mockPagesLoaded = false;
    mockSetPagesLoaded = null;
    Object.assign(mockSettings, {
      uiLanguage: language,
      isRTL: language === "ar",
      isDark: false,
      isLoaded: true,
      viewMode: "page",
      pageScroll: "vertical",
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

  it("opens the target ayah's page when the target arrives before the pages have loaded", async () => {
    // The continue reading card, Search, /open links and other screens hand over 18:84 this way.
    mockPendingTarget = { surah: 18, ayah: 84 };
    render(<MushafScreen />, { wrapper: Wrapper });
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(10);
      });
    }
    expect(mockDatabase.getFirstAsync).toHaveBeenCalledWith(targetPageSQL, [18, 84]);
    expect(mockPageProps?.currentPage).toBe(303);

    await act(async () => {
      mockSetPagesLoaded?.(true);
    });
    expect(mockPageProps?.currentPage).toBe(303);
  });
});
