import React from "react";
import { Dimensions, I18nManager } from "react-native";
import { cleanup, render } from "@testing-library/react-native";
import TabLayout from "@/app/(tabs)/_layout";
import FlashcardSessionScreenWrapper from "@/app/flashcards/session";
import VocabSessionScreenWrapper from "@/app/flashcards/vocab";
import OnboardingScreen from "@/app/onboarding";
import ProfileScreen from "@/app/profile/index";
import PublicProfileScreen from "@/app/profile/[userId]";
import { AppNavigation } from "@/components/ui/AppNavigation";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useDatabaseStatus } from "@/lib/database/provider";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { strings } from "@/lib/i18n/strings";
import { flattenStyle } from "../rtl/rtl-test-utils";

type Language = "en" | "ar";
const mockStatus: ReturnType<typeof useDatabaseStatus> = {
  db: null,
  isReady: false,
  progress: { step: "isolated startup", current: 2, total: 7 },
  error: null,
};
const mockSettings: Pick<ReturnType<typeof useSettings>, "uiLanguage"> = { uiLanguage: "en" };
const mockDatabaseAccess = jest.fn(() => {
  throw new Error("Startup error/loading must not access database");
});
const mockRemoteAccess = jest.fn((property: string) => {
  throw new Error("Startup UI must not access remote service: " + property);
});
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");

jest.mock("@/lib/database/provider", () => ({
  useDatabaseStatus: () => mockStatus,
  useDatabase: () => mockDatabaseAccess(),
}));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => mockSettings };
});
// The navigation module needs native Worklets and must never mount before database readiness.
jest.mock("@/components/ui/AppNavigation", () => ({
  AppNavigation: jest.fn(() => {
    throw new Error("Navigation must not mount before database readiness");
  }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  supabase: new Proxy({}, { get: (_target, property) => mockRemoteAccess(String(property)) }),
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ userId: "isolated-profile" }),
}));

const routes = [
  { name: "tabs", Screen: TabLayout, titleOwner: "context", profile: false },
  { name: "session", Screen: FlashcardSessionScreenWrapper, titleOwner: "context", profile: false },
  { name: "vocab", Screen: VocabSessionScreenWrapper, titleOwner: "startup", profile: false },
  { name: "onboarding", Screen: OnboardingScreen, titleOwner: "context", profile: false },
  { name: "profile", Screen: ProfileScreen, titleOwner: "startup", profile: true },
  { name: "public profile", Screen: PublicProfileScreen, titleOwner: "startup", profile: true },
];
const cases = routes.flatMap((route) => (["ar", "en"] as const).map((language) => ({ ...route, language })));

describe("route database-error presentation", () => {
  beforeEach(() => {
    mockDatabaseAccess.mockClear();
    mockRemoteAccess.mockClear();
    jest.mocked(AppNavigation).mockClear();
    mockStatus.error = null;
    mockStatus.isReady = false;
  });
  afterEach(() => {
    cleanup();
    Dimensions.set({ window: originalWindow, screen: originalScreen });
    jest.restoreAllMocks();
  });

  it.each(cases)(
    "$name uses its $language title owner, error layout and readiness precedence",
    ({ Screen, language, titleOwner, profile }) => {
      const contextLanguage: Language = language === "ar" ? "en" : "ar";
      mockSettings.uiLanguage = contextLanguage;
      jest.replaceProperty(I18nManager, "isRTL", language === "ar");
      const width = language === "ar" ? 390 : 1280;
      Dimensions.set({
        window: { width, height: 844, scale: 1, fontScale: 1 },
        screen: { width, height: 844, scale: 1, fontScale: 1 },
      });
      const titleLanguage = titleOwner === "startup" ? language : contextLanguage;
      const message = "Isolated SQLite failure: تعذر الفتح\nretain literal details";
      mockStatus.error = message;
      const view = render(<Screen />);
      for (const isReady of [false, true]) {
        mockStatus.isReady = isReady;
        view.rerender(<Screen />);
        const title = view.getByText(strings[titleLanguage].databaseError);
        const details = view.getByText(message);
        expect(view.queryByText(strings[titleLanguage === "ar" ? "en" : "ar"].databaseError)).toBeNull();
        expect(title.props.className).toBe(profile ? "mb-2 text-red-600" : "text-red-600 mb-4");
        expect(flattenStyle(title.props.style)).toEqual({ fontFamily: "Manrope_700Bold", fontSize: 18 });
        expect(details.props.className).toBe(profile ? "text-center text-red-500" : "text-red-500 text-center");
        expect(flattenStyle(details.props.style)).toEqual({
          fontFamily: "Manrope_400Regular",
          fontSize: profile ? 14 : 15,
        });
        const rootClass = profile
          ? "flex-1 items-center justify-center bg-surface px-6 dark:bg-surface-dark"
          : "flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-6";
        const container = view.toJSON();
        if (!container || Array.isArray(container)) throw new Error("Expected one native startup root");
        expect(container.type).toBe("View");
        expect(container.props.className).toBe(rootClass);
        expect(container.children).toHaveLength(2);
        expect(view.UNSAFE_queryByType(LoadingScreen)).toBeNull();
        expect(view.UNSAFE_queryByType(SettingsProvider)).toBeNull();
        expect(mockDatabaseAccess).not.toHaveBeenCalled();
        expect(mockRemoteAccess).not.toHaveBeenCalled();
        expect(AppNavigation).not.toHaveBeenCalled();
      }
      mockStatus.error = null;
      mockStatus.isReady = false;
      view.rerender(<Screen />);
      expect(view.queryByText(message)).toBeNull();
      expect(view.UNSAFE_getByType(LoadingScreen).props.progress).toBe(mockStatus.progress);
      expect(view.UNSAFE_queryByType(SettingsProvider)).toBeNull();
      expect(mockDatabaseAccess).not.toHaveBeenCalled();
      expect(mockRemoteAccess).not.toHaveBeenCalled();
      expect(AppNavigation).not.toHaveBeenCalled();
    },
  );
});
