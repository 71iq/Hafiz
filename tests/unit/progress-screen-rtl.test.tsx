import { textStartStyle } from "@/lib/ui/direction";
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ScrollView } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import ProgressScreen from "@/app/(tabs)/progress";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getMemorizedAyahCardCount, getReviewStats, getTotalAyahCardCount } from "@/lib/fsrs/queries";
import { getAchievementDashboard } from "@/lib/achievements/queries";
import { getDefaultDeckProgress, getLocalSurahProgress } from "@/lib/profile/progress";
import { findAncestorByClassName, flattenStyle, type RtlTestNode } from "../rtl/rtl-test-utils";

const mockDatabase = { name: "isolated-progress-fixture" };
const mockSettings: {
  isDark: boolean;
  isRTL: boolean;
  uiLanguage: "ar" | "en";
  themeColors: Record<string, string>;
} = {
  isDark: false,
  isRTL: true,
  uiLanguage: "ar",
  themeColors: {
    surface: "#FFF8F1",
    surfaceLow: "#F9F3EB",
    surfaceMid: "#F0EBE3",
    surfaceHigh: "#E8E1DA",
    surfaceDim: "#DFD9D1",
    surfaceBright: "#FFFFFF",
  },
};
const mockAuthState: {
  user: { id: string } | null;
  isLoading: boolean;
  isInitialized: boolean;
} = {
  user: null,
  isLoading: false,
  isInitialized: true,
};

const mockRouterPush = jest.fn();

jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
  useRouter: () => ({ push: (...args: unknown[]) => mockRouterPush(...args) }),
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDatabase,
}));

jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return {
    ...actual,
    useSettings: () => mockSettings,
  };
});

jest.mock("@/lib/auth/store", () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: jest.fn(),
}));

jest.mock("@/lib/fsrs/review-events", () => ({
  subscribeReviewActivity: () => () => {},
}));

jest.mock("@/lib/sync/events", () => ({
  subscribeSyncCompleted: () => () => {},
}));

jest.mock("@/lib/fsrs/queries", () => ({
  getMemorizedAyahCardCount: jest.fn(),
  getReviewStats: jest.fn(),
  getTotalAyahCardCount: jest.fn(),
}));

// The wird streak comes from the habit overview, tested in habit-ui and habit-core.
jest.mock("@/lib/habit/use-habit-overview", () => ({
  useHabitOverview: () => ({ overview: null, failed: false, refresh: async () => {} }),
}));

jest.mock("@/lib/achievements/queries", () => ({
  getAchievementDashboard: jest.fn(),
}));

jest.mock("@/lib/profile/progress", () => ({
  getDefaultDeckProgress: jest.fn(),
  getLocalSurahProgress: jest.fn(),
}));

const achievementDashboardFixture = {
  items: [],
  unlockedCount: 2,
  totalCount: 2,
  recentUnlocks: [
    {
      achievementId: "first_review",
      unlockedAt: "2026-10-15T10:00:00.000Z",
      seenAt: null,
      localPayload: {},
      publicPayload: {},
    },
    {
      achievementId: "first_deck_created",
      unlockedAt: "2026-10-14T10:00:00.000Z",
      seenAt: null,
      localPayload: {},
      publicPayload: {},
    },
  ],
};

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function resolvePressableStyle(style: unknown) {
  return flattenStyle(typeof style === "function" ? style({ pressed: false }) : style);
}

function renderProgress() {
  return render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <ProgressScreen />
    </SafeAreaProvider>,
  );
}

function getRecentAchievementScroll(view: ReturnType<typeof render>): RtlTestNode {
  const scroll = view.UNSAFE_getAllByType(ScrollView).find((candidate) => candidate.props.horizontal === true);
  if (!scroll) throw new Error("ProgressScreen did not render a horizontal recent-achievement ScrollView");
  return scroll;
}

function getAchievementTitleIconRow(view: ReturnType<typeof render>, title: string) {
  return findAncestorByClassName(view.getByText(title), "items-center gap-3");
}

describe("ProgressScreen RTL behavior", () => {
  beforeEach(() => {
    mockSettings.isRTL = true;
    mockSettings.uiLanguage = "ar";
    mockSettings.isDark = false;
    mockAuthState.user = null;
    mockAuthState.isLoading = false;
    mockAuthState.isInitialized = true;
    jest.mocked(isSupabaseConfigured).mockReturnValue(false);
    jest.clearAllMocks();
    jest.mocked(getTotalAyahCardCount).mockResolvedValue(10);
    jest.mocked(getMemorizedAyahCardCount).mockResolvedValue(4);
    jest.mocked(getReviewStats).mockImplementation(async () => ({
      activity: [{ date: "2026-10-15", count: 2 }],
      activeDays: 1,
      totalReviews: 2,
      averageDailyReviews: 2,
      longestStreak: 1,
    }));
    jest.mocked(getAchievementDashboard).mockResolvedValue(achievementDashboardFixture);
    jest.mocked(getDefaultDeckProgress).mockResolvedValue([]);
    jest.mocked(getLocalSurahProgress).mockResolvedValue([]);
  });

  afterEach(() => {
    mockSettings.isRTL = true;
    mockSettings.uiLanguage = "ar";
    mockSettings.isDark = false;
    mockAuthState.user = null;
    mockAuthState.isLoading = false;
    mockAuthState.isInitialized = true;
    jest.mocked(isSupabaseConfigured).mockReturnValue(false);
    mockRouterPush.mockReset();
  });

  it("shows the configured signed-out prompt with localized LTR and RTL presentation", async () => {
    jest.mocked(isSupabaseConfigured).mockReturnValue(true);
    const arabic = renderProgress();

    await waitFor(() => expect(arabic.getByText("سجّل الدخول لمزامنة نتائجك")).toBeTruthy());
    await waitFor(() => expect(arabic.getByText("الإنجازات")).toBeTruthy());

    const arabicLabel = arabic.getByText("سجّل الدخول لمزامنة نتائجك");
    const arabicRow = findAncestorByClassName(arabicLabel, "items-center gap-3");
    const arabicButton = arabic.getByRole("button", { name: "تسجيل الدخول" });
    const arabicButtonText = arabic.getByText("تسجيل الدخول");
    const arabicButtonRow = findAncestorByClassName(arabicButtonText, "flex-row items-center gap-2");
    const arabicCard = findAncestorByClassName(arabicLabel, "mb-6");

    expect(flattenStyle(arabicRow.props.style)).toMatchObject({
      direction: "ltr",
      flexDirection: "row-reverse",
    });
    expect(flattenStyle(arabicLabel.props.style)).toMatchObject({
      ...textStartStyle(true),
      writingDirection: "rtl",
    });
    expect(arabicLabel.props.className).toContain("text-charcoal dark:text-neutral-100");
    expect(flattenStyle(arabicButtonRow.props.style)).toMatchObject({
      direction: "ltr",
      flexDirection: "row-reverse",
    });
    const arabicButtonChildren = React.Children.toArray(arabicButtonRow.props.children);
    expect(arabicButtonChildren).toHaveLength(2);
    expect(arabicButtonChildren[1]).toEqual(
      expect.objectContaining({ props: expect.objectContaining({ children: "تسجيل الدخول" }) }),
    );
    expect(arabicCard.props.className).toContain("mb-6 px-5 py-4");
    expect(arabicCard.props.className).toContain("rounded-4xl overflow-hidden");
    expect(arabicCard.props.className).toContain("bg-surface-low dark:bg-surface-dark-low");
    expect(resolvePressableStyle(arabicButton.props.style)).toMatchObject({
      backgroundColor: "#003638",
    });
    expect(flattenStyle(arabicButtonText.props.style)).toMatchObject({
      color: "#FDDC91",
      fontFamily: "Manrope_700Bold",
      fontSize: 12,
    });

    await fireEvent.press(arabicButton);
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith("/auth/login");

    arabic.unmount();
    mockSettings.isRTL = false;
    mockSettings.uiLanguage = "en";
    mockSettings.isDark = true;
    mockRouterPush.mockReset();
    const english = renderProgress();

    await waitFor(() => expect(english.getByText("Sign in to sync your results")).toBeTruthy());
    await waitFor(() => expect(english.getByText("Achievements")).toBeTruthy());

    const englishLabel = english.getByText("Sign in to sync your results");
    const englishRow = findAncestorByClassName(englishLabel, "items-center gap-3");
    const englishButton = english.getByRole("button", { name: "Log In" });
    const englishButtonText = english.getByText("Log In");
    const englishButtonRow = findAncestorByClassName(englishButtonText, "flex-row items-center gap-2");
    const englishCard = findAncestorByClassName(englishLabel, "mb-6");

    expect(flattenStyle(englishRow.props.style)).toMatchObject({
      direction: "ltr",
      flexDirection: "row",
    });
    expect(flattenStyle(englishLabel.props.style)).toMatchObject({
      ...textStartStyle(false),
      writingDirection: "ltr",
    });
    expect(englishLabel.props.className).toContain("text-charcoal dark:text-neutral-100");
    expect(flattenStyle(englishButtonRow.props.style)).toMatchObject({
      direction: "ltr",
      flexDirection: "row",
    });
    const englishButtonChildren = React.Children.toArray(englishButtonRow.props.children);
    expect(englishButtonChildren).toHaveLength(2);
    expect(englishButtonChildren[1]).toEqual(
      expect.objectContaining({ props: expect.objectContaining({ children: "Log In" }) }),
    );
    expect(englishCard.props.className).toContain("mb-6 px-5 py-4");
    expect(englishCard.props.className).toContain("rounded-4xl overflow-hidden");
    expect(englishCard.props.className).toContain("bg-surface-low dark:bg-surface-dark-low");
    expect(resolvePressableStyle(englishButton.props.style)).toMatchObject({
      backgroundColor: "#1B4D4F",
    });
    expect(flattenStyle(englishButtonText.props.style)).toMatchObject({
      color: "#FDDC91",
      fontFamily: "Manrope_700Bold",
      fontSize: 12,
    });

    await fireEvent.press(englishButton);
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith("/auth/login");
  });

  it.each([
    ["configuration", { configured: false, initialized: true, loading: false, user: null }],
    ["auth initialization", { configured: true, initialized: false, loading: false, user: null }],
    ["auth loading", { configured: true, initialized: true, loading: true, user: null }],
    ["signed-in state", { configured: true, initialized: true, loading: false, user: { id: "user-1" } }],
  ] as const)("hides the prompt when the %s predicate is false", async (_case, state) => {
    jest.mocked(isSupabaseConfigured).mockReturnValue(state.configured);
    mockAuthState.isInitialized = state.initialized;
    mockAuthState.isLoading = state.loading;
    mockAuthState.user = state.user;
    const view = renderProgress();

    await waitFor(() => expect(view.getByText("الإنجازات")).toBeTruthy());

    expect(view.queryByRole("button", { name: "Log In" })).toBeNull();
    expect(view.queryByRole("button", { name: "تسجيل الدخول" })).toBeNull();
  });

  it("renders RTL achievement rows with explicit LTR layout direction, mirrored order, and horizontal recent content", async () => {
    const rtl = renderProgress();

    await waitFor(() => expect(rtl.getByText("أول مراجعة")).toBeTruthy());

    const rtlTitleIconRow = getAchievementTitleIconRow(rtl, "الإنجازات");
    expect(flattenStyle(rtlTitleIconRow.props.style)).toMatchObject({
      direction: "ltr",
      flexDirection: "row-reverse",
    });

    const rtlScroll = getRecentAchievementScroll(rtl);
    expect(rtlScroll.props.horizontal).toBe(true);
    expect(flattenStyle(rtlScroll.props.contentContainerStyle)).toMatchObject({
      direction: "ltr",
      flexDirection: "row-reverse",
    });
    expect(rtl.getByText("أول مراجعة")).toBeTruthy();
    expect(rtl.getByText("أول مجموعة")).toBeTruthy();

    rtl.unmount();
    mockSettings.isRTL = false;
    mockSettings.uiLanguage = "en";
    const ltr = renderProgress();

    await waitFor(() => expect(ltr.getByText("First Review")).toBeTruthy());

    const ltrTitleIconRow = getAchievementTitleIconRow(ltr, "Achievements");
    expect(flattenStyle(ltrTitleIconRow.props.style)).toMatchObject({
      direction: "ltr",
      flexDirection: "row",
    });

    const ltrScroll = getRecentAchievementScroll(ltr);
    expect(ltrScroll.props.horizontal).toBe(true);
    expect(flattenStyle(ltrScroll.props.contentContainerStyle)).toMatchObject({
      direction: "ltr",
      flexDirection: "row",
    });
    expect(ltr.getByText("First Review")).toBeTruthy();
    expect(ltr.getByText("First Deck")).toBeTruthy();
  });
});
