import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import React from "react";
import { Dimensions, I18nManager } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import SettingsScreen from "@/app/(tabs)/settings";
import { ReadingSettingsSheet } from "@/components/mushaf/ReadingSettingsSheet";
import { FONT_SIZE_STEPS, type useSettings } from "@/lib/settings/context";
import { DirectionProvider } from "@/lib/ui/direction";
import { toArabicNumber } from "@/lib/arabic";

const mockCalls: string[] = [];
const mockRemoteAccess = jest.fn<never, unknown[]>(() => {
  throw new Error("Remote access forbidden in stepper fixture");
});
const mockDatabase = {
  getFirstAsync: jest.fn(async () => null),
  getAllAsync: jest.fn(async () => []),
  runAsync: jest.fn(() => {
    throw new Error("Database write forbidden in stepper fixture");
  }),
};
const mockSetFont = jest.fn((index: number) => {
  mockCalls.push(`set:${index}`);
});
const mockStart = jest.fn(() => {
  mockCalls.push("start");
});
const mockSettings: Partial<ReturnType<typeof useSettings>> = { setFontSizeIndex: mockSetFont, fontSizeIndex: 4 };
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");
const labels = {
  en: { decrease: "Decrease Arabic font size", increase: "Increase Arabic font size" },
  ar: { decrease: "تصغير الخط العربي", increase: "تكبير الخط العربي" },
};
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/database/init", () => ({
  ensureTafsirSourceImported: (...args: unknown[]) => mockRemoteAccess(...args),
}));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => ({ ...actual.useSettings(), ...mockSettings }) };
});
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockRemoteAccess, setParams: mockRemoteAccess }),
  useLocalSearchParams: () => ({ category: "general" }),
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
function Wrapper({ children }: React.PropsWithChildren) {
  const window = Dimensions.get("window");
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: window.width, height: window.height },
        insets: { top: 0, left: 0, bottom: 0, right: 0 },
      }}
    >
      <OperationNoticeProvider ready={true}>
        <DirectionProvider dir={mockSettings.isRTL ? "rtl" : "ltr"}>{children}</DirectionProvider>
      </OperationNoticeProvider>
    </SafeAreaProvider>
  );
}
const cases = [
  { owner: "settings", language: "en", width: 390 },
  { owner: "settings", language: "ar", width: 390 },
  { owner: "settings", language: "en", width: 1280 },
  { owner: "settings", language: "ar", width: 1280 },
  { owner: "reading", language: "en", width: 390 },
  { owner: "reading", language: "ar", width: 390 },
  { owner: "reading", language: "en", width: 1280 },
  { owner: "reading", language: "ar", width: 1280 },
] satisfies { owner: "settings" | "reading"; language: "en" | "ar"; width: number }[];
function configure(language: "en" | "ar", width: number) {
  Object.assign(mockSettings, {
    uiLanguage: language,
    isRTL: language === "ar",
    isDark: false,
    fontSizeIndex: 4,
    viewMode: "verse",
    pageScroll: "vertical",
  });
  const screen = { width, height: 844, scale: 1, fontScale: 1 };
  Dimensions.set({ window: screen, screen });
  jest.replaceProperty(I18nManager, "isRTL", language === "ar");
}
beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  if (typeof globalThis.fetch === "function")
    jest.spyOn(globalThis, "fetch").mockImplementation(() => mockRemoteAccess("fetch"));
});
afterEach(() => {
  try {
    cleanup();
    expect(mockRemoteAccess).not.toHaveBeenCalled();
    expect(mockDatabase.runAsync).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
    Dimensions.set({ window: originalWindow, screen: originalScreen });
  }
});
describe.each(cases)("$owner $language/$width reading stepper", ({ owner, language, width }) => {
  beforeEach(() => configure(language, width));
  const element = (locked = false) =>
    owner === "settings" ? (
      <SettingsScreen />
    ) : (
      <ReadingSettingsSheet
        visible
        fontSizeLocked={locked}
        onClose={() => undefined}
        onFontSizeChangeStart={mockStart}
      />
    );
  async function open() {
    const view = render(element(), { wrapper: Wrapper });
    await act(async () => {});
    return view;
  }
  it("keeps all ten existing level labels and owner-specific spacing", async () => {
    const view = await open();
    expect(FONT_SIZE_STEPS).toHaveLength(10);
    for (let index = 0; index < FONT_SIZE_STEPS.length; index++) {
      mockSettings.fontSizeIndex = index;
      view.rerender(element());
      const number = (n: number) => (language === "ar" ? toArabicNumber(n) : String(n));
      expect(
        view.getByText([number(index + 1), number(FONT_SIZE_STEPS.length)].join(owner === "settings" ? "/" : " / ")),
      ).toBeTruthy();
    }
  });
  it("names each button and keeps its direction-specific callback and order", async () => {
    const view = await open();
    const decrease = view.getByRole("button", { name: labels[language].decrease });
    const increase = view.getByRole("button", { name: labels[language].increase });
    expect(decrease.props.accessibilityState?.disabled).toBe(false);
    expect(increase.props.accessibilityState?.disabled).toBe(false);
    fireEvent.press(decrease);
    expect(mockCalls).toEqual(owner === "reading" ? ["start", "set:3"] : ["set:3"]);
    mockCalls.length = 0;
    fireEvent.press(increase);
    expect(mockCalls).toEqual(owner === "reading" ? ["start", "set:5"] : ["set:5"]);
  });
  it.each([0, FONT_SIZE_STEPS.length - 1])("disables only the outward action at level index %i", async (index) => {
    mockSettings.fontSizeIndex = index;
    const view = await open();
    const decrease = view.getByRole("button", { name: labels[language].decrease });
    const increase = view.getByRole("button", { name: labels[language].increase });
    expect(decrease.props.accessibilityState?.disabled).toBe(index === 0);
    expect(increase.props.accessibilityState?.disabled).toBe(index === FONT_SIZE_STEPS.length - 1);
    fireEvent.press(index === 0 ? decrease : increase);
    expect(mockSetFont).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
    fireEvent.press(index === 0 ? increase : decrease);
    expect(mockSetFont).toHaveBeenCalledWith(index === 0 ? 1 : index - 1);
  });
});
describe.each(cases.filter(({ owner }) => owner === "reading"))(
  "locked sheet $language/$width",
  ({ language, width }) => {
    it("exposes both actions as disabled and suppresses start/setting callbacks", async () => {
      configure(language, width);
      const view = render(
        <ReadingSettingsSheet visible fontSizeLocked onClose={() => undefined} onFontSizeChangeStart={mockStart} />,
        { wrapper: Wrapper },
      );
      await act(async () => {});
      for (const name of [labels[language].decrease, labels[language].increase]) {
        const button = view.getByRole("button", { name });
        expect(button.props.accessibilityState?.disabled).toBe(true);
        fireEvent.press(button);
      }
      expect(mockSetFont).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
    });
  },
);
