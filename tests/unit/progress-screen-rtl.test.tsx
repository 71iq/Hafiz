import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { ScrollView } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import ProgressScreen from "@/app/(tabs)/progress";
import { getMemorizedAyahCardCount, getReviewStats, getTotalAyahCardCount, getWirdStatus } from "@/lib/fsrs/queries";
import { getTotalScore } from "@/lib/fsrs/scoring";
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
const mockAuthState = {
  user: null,
  isLoading: false,
  isInitialized: true,
};

jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useRouter: () => ({ push: jest.fn() }),
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
  isSupabaseConfigured: () => false,
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
  getWirdStatus: jest.fn(),
}));

jest.mock("@/lib/fsrs/scoring", () => ({
  getTotalScore: jest.fn(),
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
    jest.mocked(getWirdStatus).mockResolvedValue({
      currentDays: 1,
      longestDays: 1,
      maintainedToday: true,
      lastReviewDate: "2026-10-15T10:00:00.000Z",
      state: "maintained_today",
    });
    jest.mocked(getTotalScore).mockResolvedValue(25);
    jest.mocked(getAchievementDashboard).mockResolvedValue(achievementDashboardFixture);
    jest.mocked(getDefaultDeckProgress).mockResolvedValue([]);
    jest.mocked(getLocalSurahProgress).mockResolvedValue([]);
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
