import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import BoardScreen from "@/app/(tabs)/leaderboard";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { flattenStyle } from "../rtl/rtl-test-utils";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockSettings = {
  isDark: false,
  isRTL: false,
  isLoaded: true,
  uiLanguage: "en" as "en" | "ar",
  themeColors: {
    surface: "#FFF8F1",
    surfaceLow: "#F9F3EB",
    surfaceMid: "#F0EBE3",
    surfaceHigh: "#E8E1DA",
    surfaceDim: "#DFD9D1",
    surfaceBright: "#FFFFFF",
  },
};
const mockAuth: { user: { id: string } | null } = { user: null };
const mockRpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string, Record<string, unknown>]>();

jest.mock("expo-router", () => ({ router: { push: jest.fn() }, useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => ({ name: "synthetic" }) }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => mockSettings };
});
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: (selector: (state: typeof mockAuth) => unknown) => selector(mockAuth),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args) },
}));
jest.mock("@/lib/social/queries", () => ({
  readLocalSocialBands: async () => ({ levelBand: "juz_4_15", paceBand: "half_page", utcOffsetMinutes: 120 }),
}));

const USER = "00000000-0000-4000-8000-00000000000a";
const privacy = {
  board_joined: false,
  board_nickname: null,
  show_streak: false,
  show_juz_completions: false,
  is_minor: false,
};
const ready = {
  status: "ready",
  week_start: "2026-11-09",
  member_count: 5,
  min_members: 5,
  standings: [
    { rank: 1, name: "Little Star", uses_nickname: true, avatar_url: null, points: 9, streak: 12, is_me: false },
    { rank: 2, name: "Amina", uses_nickname: false, avatar_url: null, points: 6, streak: 4, is_me: true },
  ],
};

const queryClients: QueryClient[] = [];
function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClients.push(client);
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <QueryClientProvider client={client}>
        <BoardScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

let boardState: unknown;
beforeEach(async () => {
  mockSettings.isRTL = false;
  mockSettings.uiLanguage = "en";
  mockAuth.user = null;
  boardState = { status: "not_joined", week_start: "2026-11-09" };
  mockRpc.mockReset().mockImplementation(async (fn) => {
    switch (fn) {
      case "get_board":
        return { data: boardState, error: null };
      case "get_profile_privacy":
        return { data: privacy, error: null };
      case "join_board":
        boardState = { status: "gathering", week_start: "2026-11-09", member_count: 1, min_members: 5 };
        return { data: boardState, error: null };
      case "leave_board":
        boardState = { status: "not_joined", week_start: "2026-11-09" };
        return { data: null, error: null };
      default:
        throw new Error(`Unexpected RPC ${fn}`);
    }
  });
  jest.mocked(router.push).mockClear();
  await AsyncStorage.clear();
});

afterEach(() => {
  cleanup();
  for (const client of queryClients.splice(0)) client.clear();
});

describe("Board tab", () => {
  it("asks a signed-out reader to sign in and calls nothing", () => {
    const screen = renderScreen();
    expect(screen.getByText(strings.en.boardSignInTitle)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: strings.en.socialSignIn }));
    expect(router.push).toHaveBeenCalledWith("/auth/login");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("is opt-in, with the intention note before joining (BRD-04)", async () => {
    mockAuth.user = { id: USER };
    const screen = renderScreen();

    expect(await screen.findByText(strings.en.boardIntentionTitle)).toBeTruthy();
    expect(screen.getByText(/Bukhari 1/)).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith("get_board", {
      p_level_band: "juz_4_15",
      p_pace_band: "half_page",
      p_utc_offset_minutes: 120,
      p_today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });

    fireEvent.press(screen.getByRole("button", { name: strings.en.boardJoin }));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith("join_board", expect.objectContaining({ p_nickname: null, p_is_minor: false })),
    );
    expect(await screen.findByText(strings.en.boardGatheringTitle)).toBeTruthy();
  });

  it("requires a nickname from a reader under 18 (BRD-07)", async () => {
    mockAuth.user = { id: USER };
    const screen = renderScreen();
    await screen.findByText(strings.en.boardIntentionTitle);

    fireEvent.press(screen.getByRole("switch", { name: strings.en.boardMinorToggle }));
    const join = screen.getByRole("button", { name: strings.en.boardJoin });
    expect(join.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByLabelText(strings.en.boardNicknameLabel), "  Little   Star ");
    fireEvent.press(screen.getByRole("button", { name: strings.en.boardJoin }));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith(
        "join_board",
        expect.objectContaining({ p_nickname: "Little Star", p_is_minor: true }),
      ),
    );
  });

  it("shows standings with name, points and streak, and leaves in one tap (BRD-05, BRD-04)", async () => {
    mockAuth.user = { id: USER };
    boardState = ready;
    const screen = renderScreen();

    const mine = await screen.findByLabelText(
      interpolate(strings.en.boardPointsA11y, { name: `Amina (${strings.en.boardYou})`, rank: "2", points: "6", streak: "4 days" }),
    );
    expect(mine).toBeTruthy();
    expect(screen.getByText("Little Star")).toBeTruthy();
    expect(screen.queryByText(/pages|mistakes/i)).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: strings.en.boardLeave }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith("leave_board", {}));
    expect(await screen.findByText(strings.en.boardIntentionTitle)).toBeTruthy();
  });

  it("mirrors standing rows in Arabic and uses Arabic digits", async () => {
    mockSettings.isRTL = true;
    mockSettings.uiLanguage = "ar";
    mockAuth.user = { id: USER };
    boardState = ready;
    const screen = renderScreen();

    const row = await screen.findByLabelText(
      interpolate(strings.ar.boardPointsA11y, { name: "Little Star", rank: "١", points: "٩", streak: "١٢ يومًا" }),
    );
    expect(flattenStyle(row.props.style)).toMatchObject({ direction: "ltr", flexDirection: "row-reverse" });
  });
});
