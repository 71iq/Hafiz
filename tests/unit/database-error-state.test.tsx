import React from "react";
import { Dimensions, I18nManager } from "react-native";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import TabLayout from "@/app/(tabs)/_layout";
import FlashcardSessionScreenWrapper from "@/app/flashcards/session";
import OnboardingScreen from "@/app/onboarding";
import ProfileScreen from "@/app/profile/index";
import PublicProfileScreen from "@/app/profile/[userId]";
import { AppNavigation } from "@/components/ui/AppNavigation";
import { LoadingScreen } from "@/components/LoadingScreen";
import { sanitizeDatabaseErrorDetails } from "@/components/ui/DatabaseErrorState";
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
  retry: jest.fn(),
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
      const RealDateTimeFormat = Intl.DateTimeFormat;
      jest.spyOn(Intl, "DateTimeFormat").mockImplementation(((
        ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
      ) => {
        const formatter = new RealDateTimeFormat(...args);
        const resolved = formatter.resolvedOptions();
        return {
          ...formatter,
          resolvedOptions: () => ({ ...resolved, locale: language === "ar" ? "ar-SA" : "en-US" }),
        } as Intl.DateTimeFormat;
      }) as unknown as typeof Intl.DateTimeFormat);
      const width = language === "ar" ? 390 : 1280;
      Dimensions.set({
        window: { width, height: 844, scale: 1, fontScale: 1 },
        screen: { width, height: 844, scale: 1, fontScale: 1 },
      });
      const titleLanguage = titleOwner === "startup" ? language : contextLanguage;
      const message = "Isolated SQLite failure: تعذر الفتح\nretain literal details";
      mockStatus.error = message;
      const view = render(<Screen />);
      const s = strings[titleLanguage];
      for (const isReady of [false, true]) {
        mockStatus.isReady = isReady;
        view.rerender(<Screen />);
        const title = view.getByText(s.databaseError);
        expect(view.queryByText(strings[titleLanguage === "ar" ? "en" : "ar"].databaseError)).toBeNull();
        expect(title.props.className).toContain("text-red-600");
        expect(flattenStyle(title.props.style)).toEqual(
          expect.objectContaining({ fontFamily: "Manrope_700Bold", fontSize: 18 }),
        );
        expect(view.queryByText(message)).toBeNull();
        fireEvent.press(view.getByText(s.databaseShowDetails));
        expect(view.getByText(message)).toBeTruthy();
        fireEvent.press(view.getByText(s.databaseHideDetails));
        expect(view.queryByText(message)).toBeNull();
        jest.mocked(mockStatus.retry).mockClear();
        fireEvent.press(view.getByText(s.databaseRetry));
        expect(mockStatus.retry).toHaveBeenCalledTimes(1);
        const rootClass = profile
          ? "flex-1 items-center justify-center bg-surface px-6 dark:bg-surface-dark"
          : "flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-6";
        const container = view.toJSON();
        if (!container || Array.isArray(container)) throw new Error("Expected one native startup root");
        expect(container.type).toBe("View");
        expect(container.props.className).toBe(rootClass);
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

describe("database error details", () => {
  it("masks account and device data but keeps the failure text", () => {
    const raw =
      "SQLite open failed for person@example.com at /data/user/0/app.hafiz/databases/hafiz.db via https://x.test/a?token=abc";
    const shown = sanitizeDatabaseErrorDetails(raw);
    expect(shown).toContain("SQLite open failed");
    expect(shown).toContain("hafiz.db");
    expect(shown).not.toContain("person@example.com");
    expect(shown).not.toContain("/data/user/0");
    expect(shown).not.toContain("token=abc");
  });

  it("caps very long details", () => {
    expect(sanitizeDatabaseErrorDetails("x ".repeat(1000)).length).toBeLessThanOrEqual(603);
  });
});
