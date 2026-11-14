import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import BoardScreen from "@/app/(tabs)/leaderboard";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { profilePrivacyKeys } from "@/lib/profile/privacy";
import { flattenStyle } from "../rtl/rtl-test-utils";
import { bearerSubject, signedIn, signedOut, type FakeAuthState } from "./social-test-auth";

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
const mockAuth: FakeAuthState = signedOut();
const mockHeaders: Record<string, string> = {};
function signIn(userId: string) {
  Object.assign(mockAuth, signedIn(userId));
}
const mockRpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string, Record<string, unknown>]>();

jest.mock("expo-router", () => ({ router: { push: jest.fn() }, useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => ({ name: "synthetic" }) }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => mockSettings };
});
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: Object.assign((selector: (state: typeof mockAuth) => unknown) => selector(mockAuth), {
    getState: () => mockAuth,
  }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabaseAnonKey: () => "synthetic-public-key",
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) =>
      require("./social-test-auth").rpcBuilder(mockRpc(fn, args), mockHeaders),
    auth: { getSession: async () => ({ data: { session: mockAuth.session }, error: null }) },
    // Joining as a minor first deletes the account's stored photos; this account has none.
    storage: {
      from: () => {
        const files = {
          setHeader: () => files,
          list: async () => ({ data: [], error: null }),
          remove: async () => ({ data: [], error: null }),
        };
        return files;
      },
    },
  },
}));
jest.mock("@/lib/social/queries", () => ({
  // The real reader takes the week start from the wird settings (tested in social-bands.test.ts).
  readLocalBoardInputs: async (_db: unknown, language: "en" | "ar") => ({
    bands: { levelBand: "juz_4_15", paceBand: "half_page", utcOffsetMinutes: 120 },
    weekStart: language === "ar" ? 6 : 1,
  }),
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

// The account's privacy as an earlier read on this device left it in the cache: an adult.
const cachedAdult = {
  boardJoined: false,
  boardNickname: null,
  showStreak: false,
  showJuzCompletions: false,
  isMinor: false,
};

const queryClients: QueryClient[] = [];
/** `staleTime` as the app sets it, so a cached copy counts as fresh; `seed` fills the cache first. */
function renderScreen(options: { staleTime?: number; seed?: (client: QueryClient) => void } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: options.staleTime ?? 0 } },
  });
  queryClients.push(client);
  options.seed?.(client);
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
  Object.assign(mockAuth, signedOut());
  for (const key of Object.keys(mockHeaders)) delete mockHeaders[key];
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
    signIn(USER);
    const screen = renderScreen();

    expect(await screen.findByText(strings.en.boardIntentionTitle)).toBeTruthy();
    expect(screen.getByText(/Bukhari 1/)).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith("get_board", {
      p_level_band: "juz_4_15",
      p_pace_band: "half_page",
      p_utc_offset_minutes: 120,
      p_today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      p_week_start: 1,
    });
    expect(bearerSubject(mockHeaders.Authorization)).toBe(USER);

    fireEvent.press(screen.getByRole("button", { name: strings.en.boardJoin }));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith(
        "join_board",
        expect.objectContaining({ p_nickname: null, p_is_minor: false, p_expected_minor: false }),
      ),
    );
    expect(await screen.findByText(strings.en.boardGatheringTitle)).toBeTruthy();
  });

  it("waits for the stored age choice before offering Join, then keeps a minor's choice (ETH-07)", async () => {
    signIn(USER);
    const base = mockRpc.getMockImplementation()!;
    let releasePrivacy: (() => void) | undefined;
    mockRpc.mockImplementation(async (fn, args) => {
      if (fn !== "get_profile_privacy") return base(fn, args);
      await new Promise<void>((resolve) => (releasePrivacy = resolve));
      return { data: { ...privacy, is_minor: true, board_nickname: "Little Star" }, error: null };
    });
    const screen = renderScreen();
    await waitFor(() => expect(releasePrivacy).toBeDefined());
    // Joining now would send "not under 18" and clear the stored choice.
    expect(screen.queryByRole("button", { name: strings.en.boardJoin })).toBeNull();
    expect(screen.queryByText(strings.en.boardIntentionTitle)).toBeNull();

    releasePrivacy!();
    expect(await screen.findByText(strings.en.boardIntentionTitle)).toBeTruthy();
    expect(screen.getByRole("switch", { name: strings.en.boardMinorToggle }).props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(screen.getByRole("button", { name: strings.en.boardJoin }));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith(
        "join_board",
        expect.objectContaining({ p_nickname: "Little Star", p_is_minor: true, p_expected_minor: true }),
      ),
    );
  });

  it("offers a retry instead of Join when the stored age choice cannot be read (ETH-07)", async () => {
    signIn(USER);
    const base = mockRpc.getMockImplementation()!;
    let privacyFails = true;
    let releaseRetry: (() => void) | undefined;
    mockRpc.mockImplementation(async (fn, args) => {
      if (fn !== "get_profile_privacy") return base(fn, args);
      if (privacyFails) return { data: null, error: { message: "synthetic privacy failure" } };
      await new Promise<void>((resolve) => (releaseRetry = resolve));
      return { data: { ...privacy, is_minor: true, board_nickname: "Little Star" }, error: null };
    });
    const screen = renderScreen();
    const retry = await screen.findByRole("button", { name: strings.en.socialTryAgain });
    expect(screen.queryByRole("button", { name: strings.en.boardJoin })).toBeNull();
    expect(mockRpc.mock.calls.map(([fn]) => fn)).not.toContain("join_board");

    privacyFails = false;
    fireEvent.press(retry);
    // The retry shows that it is working instead of leaving the same notice up.
    await waitFor(() => expect(releaseRetry).toBeDefined());
    expect(screen.queryByRole("button", { name: strings.en.socialTryAgain })).toBeNull();
    expect(screen.getByLabelText(strings.en.loading)).toBeTruthy();
    releaseRetry!();
    expect(await screen.findByText(strings.en.boardIntentionTitle)).toBeTruthy();
    expect(screen.getByRole("switch", { name: strings.en.boardMinorToggle }).props.accessibilityState).toMatchObject({ checked: true });
  });

  it("reads the stored age choice again when the Board opens, even with a fresh cached copy (ETH-07)", async () => {
    signIn(USER);
    const base = mockRpc.getMockImplementation()!;
    let releasePrivacy: (() => void) | undefined;
    mockRpc.mockImplementation(async (fn, args) => {
      if (fn !== "get_profile_privacy") return base(fn, args);
      await new Promise<void>((resolve) => (releasePrivacy = resolve));
      // Another device recorded minority after this device cached its copy.
      return { data: { ...privacy, is_minor: true, board_nickname: "Little Star" }, error: null };
    });
    const screen = renderScreen({
      staleTime: Infinity,
      seed: (client) => client.setQueryData(profilePrivacyKeys.mine(USER), cachedAdult),
    });
    await waitFor(() => expect(releasePrivacy).toBeDefined());
    // Joining from the cached copy would send "not under 18".
    expect(screen.queryByRole("button", { name: strings.en.boardJoin })).toBeNull();
    expect(screen.getByLabelText(strings.en.loading)).toBeTruthy();

    releasePrivacy!();
    expect(await screen.findByText(strings.en.boardIntentionTitle)).toBeTruthy();
    expect(screen.getByRole("switch", { name: strings.en.boardMinorToggle }).props.accessibilityState).toMatchObject({ checked: true });
  });

  it("keeps Join hidden when the read of the stored age choice fails, even with a cached copy (ETH-07)", async () => {
    signIn(USER);
    const base = mockRpc.getMockImplementation()!;
    mockRpc.mockImplementation(async (fn, args) =>
      fn === "get_profile_privacy" ? { data: null, error: { message: "synthetic privacy failure" } } : base(fn, args),
    );
    const screen = renderScreen({ seed: (client) => client.setQueryData(profilePrivacyKeys.mine(USER), cachedAdult) });
    expect(await screen.findByRole("button", { name: strings.en.socialTryAgain })).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.en.boardJoin })).toBeNull();
    expect(mockRpc.mock.calls.map(([fn]) => fn)).not.toContain("join_board");
  });

  it("keeps the form and a typed nickname while the stored choices are read again unchanged", async () => {
    signIn(USER);
    const screen = renderScreen();
    await screen.findByText(strings.en.boardIntentionTitle);
    fireEvent.press(screen.getByRole("switch", { name: strings.en.boardMinorToggle }));
    fireEvent.changeText(screen.getByLabelText(strings.en.boardNicknameLabel), "Little Star");
    const base = mockRpc.getMockImplementation()!;
    let releasePrivacy: (() => void) | undefined;
    mockRpc.mockImplementation(async (fn, args) => {
      if (fn !== "get_profile_privacy") return base(fn, args);
      await new Promise<void>((resolve) => (releasePrivacy = resolve));
      return base(fn, args);
    });
    const client = queryClients[queryClients.length - 1];
    act(() => {
      void client.invalidateQueries({ queryKey: profilePrivacyKeys.mine(USER) });
    });
    await waitFor(() => expect(releasePrivacy).toBeDefined());
    // The form stays while the read runs: a stale join is refused by the server (privacy_changed).
    expect(screen.getByLabelText(strings.en.boardNicknameLabel).props.value).toBe("Little Star");
    await act(async () => {
      releasePrivacy!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByLabelText(strings.en.boardNicknameLabel).props.value).toBe("Little Star");
    expect(screen.getByRole("switch", { name: strings.en.boardMinorToggle }).props.accessibilityState).toMatchObject({ checked: true });
  });

  it("starts the form again from stored choices that changed on another device", async () => {
    signIn(USER);
    const screen = renderScreen();
    await screen.findByText(strings.en.boardIntentionTitle);
    const base = mockRpc.getMockImplementation()!;
    mockRpc.mockImplementation(async (fn, args) =>
      fn === "get_profile_privacy"
        ? { data: { ...privacy, is_minor: true, board_nickname: "Little Star" }, error: null }
        : base(fn, args),
    );
    const client = queryClients[queryClients.length - 1];
    await act(async () => {
      await client.invalidateQueries({ queryKey: profilePrivacyKeys.mine(USER) });
    });
    // Query notifies on its own tick, so wait for the restart rather than asserting at once.
    await waitFor(() => expect(screen.getByLabelText(strings.en.boardNicknameLabel).props.value).toBe("Little Star"));
    expect(screen.getByRole("switch", { name: strings.en.boardMinorToggle }).props.accessibilityState).toMatchObject({ checked: true });
  });

  it("says the age setting changed on another device and reloads it when the join is refused (ETH-07)", async () => {
    signIn(USER);
    const base = mockRpc.getMockImplementation()!;
    let stored: Record<string, unknown> = privacy;
    mockRpc.mockImplementation(async (fn, args) => {
      if (fn === "get_profile_privacy") return { data: stored, error: null };
      if (fn === "join_board") {
        // Another device recorded minority after this form loaded.
        stored = { ...privacy, is_minor: true, board_nickname: "Little Star" };
        return { data: null, error: { message: "privacy_changed", code: "P0001" } };
      }
      return base(fn, args);
    });
    const screen = renderScreen();
    await screen.findByText(strings.en.boardIntentionTitle);
    fireEvent.press(screen.getByRole("button", { name: strings.en.boardJoin }));

    expect(await screen.findByText(strings.en.socialErrorPrivacyChanged)).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith("join_board", expect.objectContaining({ p_is_minor: false, p_expected_minor: false }));
    expect(mockRpc.mock.calls.filter(([fn]) => fn === "get_profile_privacy")).toHaveLength(2);
    // The form now starts from the reloaded choice.
    expect(screen.getByRole("switch", { name: strings.en.boardMinorToggle }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText(strings.en.boardNicknameLabel).props.value).toBe("Little Star");
  });

  it("shows the changed-setting message in Arabic", async () => {
    mockSettings.isRTL = true;
    mockSettings.uiLanguage = "ar";
    signIn(USER);
    const base = mockRpc.getMockImplementation()!;
    mockRpc.mockImplementation(async (fn, args) =>
      fn === "join_board" ? { data: null, error: { message: "privacy_changed", code: "P0001" } } : base(fn, args),
    );
    const screen = renderScreen();
    await screen.findByText(strings.ar.boardIntentionTitle);
    fireEvent.press(screen.getByRole("button", { name: strings.ar.boardJoin }));
    expect(await screen.findByText(strings.ar.socialErrorPrivacyChanged)).toBeTruthy();
  });

  it("requires a nickname from a reader under 18 (BRD-07)", async () => {
    signIn(USER);
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
        expect.objectContaining({ p_nickname: "Little Star", p_is_minor: true, p_expected_minor: false }),
      ),
    );
  });

  it("says the matched halaqa was left after joining as a reader under 18 (ETH-07)", async () => {
    signIn(USER);
    const base = mockRpc.getMockImplementation()!;
    // The server reports it from the join's own transaction; no halaqa read comes first.
    mockRpc.mockImplementation(async (fn, args) => {
      const result = await base(fn, args);
      return fn === "join_board" ? { ...result, data: { ...(result.data as object), left_matched: true } } : result;
    });
    const screen = renderScreen();
    await screen.findByText(strings.en.boardIntentionTitle);
    fireEvent.press(screen.getByRole("switch", { name: strings.en.boardMinorToggle }));
    fireEvent.changeText(screen.getByLabelText(strings.en.boardNicknameLabel), "Little Star");
    fireEvent.press(screen.getByRole("button", { name: strings.en.boardJoin }));
    expect(await screen.findByText(strings.en.socialLeftMatched)).toBeTruthy();
    expect(mockRpc.mock.calls.map(([fn]) => fn)).not.toContain("get_my_halaqas");
  });

  it("does not claim a matched halaqa was left when the join reports none", async () => {
    signIn(USER);
    const screen = renderScreen();
    await screen.findByText(strings.en.boardIntentionTitle);
    fireEvent.press(screen.getByRole("switch", { name: strings.en.boardMinorToggle }));
    fireEvent.changeText(screen.getByLabelText(strings.en.boardNicknameLabel), "Little Star");
    fireEvent.press(screen.getByRole("button", { name: strings.en.boardJoin }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith("join_board", expect.anything()));
    await waitFor(() => expect(screen.queryByText(strings.en.boardIntentionTitle)).toBeNull());
    expect(screen.queryByText(strings.en.socialLeftMatched)).toBeNull();
  });

  it("shows standings with name, points and streak, and leaves in one tap (BRD-05, BRD-04)", async () => {
    signIn(USER);
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
    signIn(USER);
    boardState = ready;
    const screen = renderScreen();

    const row = await screen.findByLabelText(
      interpolate(strings.ar.boardPointsA11y, { name: "Little Star", rank: "١", points: "٩", streak: "١٢ يومًا" }),
    );
    expect(flattenStyle(row.props.style)).toMatchObject({ direction: "ltr", flexDirection: "row-reverse" });
    // STR-28: an Arabic reader's week starts on Saturday unless they chose another day.
    expect(mockRpc).toHaveBeenCalledWith("get_board", expect.objectContaining({ p_week_start: 6 }));
  });
});
