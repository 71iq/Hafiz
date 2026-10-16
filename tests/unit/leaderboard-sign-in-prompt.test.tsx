import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View } from "react-native";
import { router } from "expo-router";
import LeaderboardScreen from "@/app/(tabs)/leaderboard";
import {
  fetchAllTimeLeaderboard,
  fetchDailyLeaderboard,
  fetchStreakLeaderboard,
  fetchWeeklyLeaderboard,
  type LeaderboardEntry,
} from "@/lib/leaderboard/api";
import { isSupabaseConfigured } from "@/lib/supabase";
import { syncDailyScore, updateProfileStats } from "@/lib/fsrs/leaderboard-sync";
import { flattenStyle, findAncestorByClassName, type RtlTestNode } from "../rtl/rtl-test-utils";

const mockDatabase = { name: "isolated-leaderboard-fixture" };
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
} = {
  user: null,
};
const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const leaderboardEntries: LeaderboardEntry[] = [
  {
    user_id: "user-1",
    username: "amina",
    display_name: "Amina",
    avatar_url: null,
    score: 125,
    rank: 1,
  },
  {
    user_id: "user-2",
    username: "yusuf",
    display_name: "Yusuf",
    avatar_url: null,
    score: 90,
    rank: 2,
  },
  {
    user_id: "user-3",
    username: "sara",
    display_name: "Sara",
    avatar_url: null,
    score: 75,
    rank: 3,
  },
  {
    user_id: "user-4",
    username: "hamza",
    display_name: "Hamza",
    avatar_url: null,
    score: 60,
    rank: 4,
  },
];

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
  isSupabaseConfigured: jest.fn(),
}));

jest.mock("@/lib/fsrs/leaderboard-sync", () => ({
  syncDailyScore: jest.fn(),
  updateProfileStats: jest.fn(),
}));

jest.mock("@/lib/leaderboard/api", () => ({
  fetchAllTimeLeaderboard: jest.fn(),
  fetchDailyLeaderboard: jest.fn(),
  fetchStreakLeaderboard: jest.fn(),
  fetchWeeklyLeaderboard: jest.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => {
      if (!resolvePromise) throw new Error("Deferred promise was not initialized");
      resolvePromise(value);
    },
    reject: (reason) => {
      if (!rejectPromise) throw new Error("Deferred promise was not initialized");
      rejectPromise(reason);
    },
  };
}

const queryClients = new Set<QueryClient>();

function renderLeaderboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
    },
  });
  queryClients.add(queryClient);
  const view = render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <QueryClientProvider client={queryClient}>
        <LeaderboardScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  return { queryClient, view };
}

function resolvePressableStyle(style: unknown) {
  return flattenStyle(typeof style === "function" ? style({ pressed: false }) : style);
}

function assertPrompt(
  view: ReturnType<typeof renderLeaderboard>["view"],
  options: {
    label: string;
    buttonLabel: string;
    isRTL: boolean;
    isDark: boolean;
  },
) {
  const label = view.getByText(options.label);
  const row = findAncestorByClassName(label, "items-center gap-3");
  const button = view.getByRole("button", { name: options.buttonLabel });
  const buttonText = view.getByText(options.buttonLabel);
  const buttonRow = findAncestorByClassName(buttonText, "flex-row items-center gap-2");
  const callout = findAncestorByClassName(label, "mt-4");

  expect(flattenStyle(row.props.style)).toMatchObject({
    direction: "ltr",
    flexDirection: options.isRTL ? "row-reverse" : "row",
  });
  expect(flattenStyle(label.props.style)).toMatchObject({
    textAlign: options.isRTL ? "right" : "left",
    writingDirection: options.isRTL ? "rtl" : "ltr",
  });
  expect(label.props.className).toContain("text-charcoal dark:text-neutral-100");
  expect(flattenStyle(buttonRow.props.style)).toMatchObject({
    direction: "ltr",
    flexDirection: options.isRTL ? "row-reverse" : "row",
  });
  const buttonChildren = React.Children.toArray(buttonRow.props.children);
  expect(buttonChildren).toHaveLength(2);
  expect(buttonChildren[1]).toEqual(
    expect.objectContaining({ props: expect.objectContaining({ children: options.buttonLabel }) }),
  );
  expect(callout.props.className).toContain("mt-4 rounded-3xl px-4 py-4");
  expect(flattenStyle(callout.props.style)).toMatchObject({
    backgroundColor: options.isDark ? "rgba(45, 212, 191, 0.10)" : "rgba(13, 148, 136, 0.08)",
    borderColor: options.isDark ? "rgba(45, 212, 191, 0.22)" : "rgba(13, 148, 136, 0.18)",
    borderWidth: 1,
  });
  expect(resolvePressableStyle(button.props.style)).toMatchObject({
    backgroundColor: options.isDark ? "#1B4D4F" : "#003638",
  });
  expect(flattenStyle(buttonText.props.style)).toMatchObject({
    color: "#FDDC91",
    fontFamily: "Manrope_700Bold",
    fontSize: 12,
  });

  return button;
}

describe("LeaderboardScreen sign-in prompt characterization", () => {
  beforeEach(() => {
    mockSettings.isDark = false;
    mockSettings.isRTL = true;
    mockSettings.uiLanguage = "ar";
    mockAuthState.user = null;
    jest.clearAllMocks();
    jest.mocked(isSupabaseConfigured).mockReturnValue(false);
    jest.mocked(syncDailyScore).mockResolvedValue(undefined);
    jest.mocked(updateProfileStats).mockResolvedValue(undefined);
    jest.mocked(fetchDailyLeaderboard).mockResolvedValue([]);
    jest.mocked(fetchWeeklyLeaderboard).mockResolvedValue([]);
    jest.mocked(fetchAllTimeLeaderboard).mockResolvedValue([]);
    jest.mocked(fetchStreakLeaderboard).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    queryClients.forEach((queryClient) => queryClient.clear());
    queryClients.clear();
    mockSettings.isDark = false;
    mockSettings.isRTL = true;
    mockSettings.uiLanguage = "ar";
    mockAuthState.user = null;
  });

  it("shows the empty signed-out prompt in Arabic RTL with the real empty branch", async () => {
    jest.mocked(isSupabaseConfigured).mockReturnValue(true);
    const { view } = renderLeaderboard();

    await waitFor(() => expect(view.getByText("لا توجد نتائج بعد")).toBeTruthy());
    const button = assertPrompt(view, {
      label: "سجّل الدخول لمقارنة نتائجك",
      buttonLabel: "تسجيل الدخول",
      isRTL: true,
      isDark: false,
    });

    fireEvent.press(button);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/auth/login");
  });

  it("shows the populated signed-out prompt in English LTR with the real results branch", async () => {
    jest.mocked(isSupabaseConfigured).mockReturnValue(true);
    jest.mocked(fetchDailyLeaderboard).mockResolvedValue(leaderboardEntries);
    mockSettings.isDark = true;
    mockSettings.isRTL = false;
    mockSettings.uiLanguage = "en";
    const { view } = renderLeaderboard();

    await waitFor(() => expect(view.getByText("Amina")).toBeTruthy());
    const button = assertPrompt(view, {
      label: "Sign in to compare your results",
      buttonLabel: "Log In",
      isRTL: false,
      isDark: true,
    });

    fireEvent.press(button);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/auth/login");
  });

  it("hides the prompt for a signed-in user while retaining the loaded empty landmark", async () => {
    jest.mocked(isSupabaseConfigured).mockReturnValue(true);
    mockAuthState.user = { id: "user-1" };
    const { view } = renderLeaderboard();

    await waitFor(() => expect(view.getByText("لا توجد نتائج بعد")).toBeTruthy());

    expect(view.queryByText("سجّل الدخول لمقارنة نتائجك")).toBeNull();
    expect(view.queryByText("Sign in to compare your results")).toBeNull();
  });

  it("hides the prompt when cloud sync is unconfigured and shows that branch", async () => {
    const { view } = renderLeaderboard();

    expect(view.getByText("المزامنة السحابية مطلوبة للوحة المتصدرين")).toBeTruthy();
    expect(view.queryByText("سجّل الدخول لمقارنة نتائجك")).toBeNull();
    expect(fetchDailyLeaderboard).not.toHaveBeenCalled();
  });

  it("hides the prompt while the configured query is loading and shows the skeleton branch", async () => {
    jest.mocked(isSupabaseConfigured).mockReturnValue(true);
    const deferred = createDeferred<LeaderboardEntry[]>();
    jest.mocked(fetchDailyLeaderboard).mockReturnValue(deferred.promise);
    const { view } = renderLeaderboard();

    await waitFor(() => {
      const skeleton = view
        .UNSAFE_getAllByType(View)
        .find((candidate: RtlTestNode) => `${candidate.props.className ?? ""}`.includes("px-4 pt-4"));
      expect(skeleton).toBeTruthy();
    });
    expect(view.queryByText("سجّل الدخول لمقارنة نتائجك")).toBeNull();
    expect(view.queryByText("Sign in to compare your results")).toBeNull();

    deferred.resolve([]);
    await waitFor(() => expect(view.getByText("لا توجد نتائج بعد")).toBeTruthy());
  });

  it("hides the prompt after a failed configured query and shows the failure branch", async () => {
    jest.mocked(isSupabaseConfigured).mockReturnValue(true);
    const deferred = createDeferred<LeaderboardEntry[]>();
    jest.mocked(fetchDailyLeaderboard).mockReturnValue(deferred.promise);
    const { view } = renderLeaderboard();

    deferred.reject(new Error("fixture failure"));
    await waitFor(() => expect(view.getByText("تعذر تحميل لوحة المتصدرين")).toBeTruthy());

    expect(view.queryByText("سجّل الدخول لمقارنة نتائجك")).toBeNull();
    expect(view.queryByText("Sign in to compare your results")).toBeNull();
  });
});
