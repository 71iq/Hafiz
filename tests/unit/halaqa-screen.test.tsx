import React from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import HalaqaScreen from "@/app/(tabs)/halaqa";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { strings } from "@/lib/i18n/strings";
import { profilePrivacyKeys } from "@/lib/profile/privacy";
import { interpolate } from "@/lib/i18n/useStrings";
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
const mockNet = { isConnected: true as boolean | null, isInternetReachable: true as boolean | null };
const mockRpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string, Record<string, unknown>]>();
let mockConfigured = true;

jest.mock("expo-router", () => ({ router: { push: jest.fn() }, useRouter: () => ({ push: jest.fn() }) }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
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
  isSupabaseConfigured: () => mockConfigured,
  supabaseAnonKey: () => "synthetic-public-key",
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) =>
      require("./social-test-auth").rpcBuilder(mockRpc(fn, args), mockHeaders),
    auth: { getSession: async () => ({ data: { session: mockAuth.session }, error: null }) },
    // Saying one is under 18 first deletes the account's stored photos; this account has none.
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
jest.mock("@react-native-community/netinfo", () => ({
  useNetInfo: () => mockNet,
  addEventListener: () => () => undefined,
  fetch: async () => mockNet,
}));
jest.mock("@/lib/social/queries", () => ({
  readLocalSocialBands: async () => ({ levelBand: "juz_amma", paceBand: "light", utcOffsetMinutes: 180 }),
}));

const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const GROUP = "00000000-0000-4000-8000-0000000000aa";
const summary = {
  id: GROUP,
  kind: "invite",
  name: "Family halaqa",
  invite_code: "ABCD2345",
  member_count: 2,
  role: "member",
  is_creator: false,
  share_consistency: true,
  share_juz: true,
  share_plan_with_teachers: false,
  share_grades_with_teachers: false,
};
const detail = {
  group: summary,
  goal: { week_start: "2026-11-09", contributors: 2, target: 10, wird_days: 3 },
  encouraged_today: false,
  members: [
    {
      user_id: USER,
      name: "Amina",
      username: "amina",
      avatar_url: null,
      role: "member",
      is_me: true,
      week: [true, true, false, false, false, false, false],
      streak: 4,
      juz_completions: 1,
      encouraged_today: false,
      teacher_view: false,
    },
    {
      user_id: OTHER,
      name: "Yusuf",
      username: "yusuf",
      avatar_url: null,
      role: "member",
      is_me: false,
      week: null,
      streak: null,
      juz_completions: null,
      encouraged_today: false,
      teacher_view: false,
    },
  ],
  received: [],
};

// The account's own privacy as the server returns it, and as an earlier read left it in the cache.
const adultPrivacy = {
  board_joined: false,
  board_nickname: null as string | null,
  show_streak: false,
  show_juz_completions: false,
  is_minor: false,
};
const cachedAdult = {
  boardJoined: false,
  boardNickname: null,
  showStreak: false,
  showJuzCompletions: false,
  isMinor: false,
};

const queryClients: QueryClient[] = [];
function renderScreen(seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClients.push(client);
  seed?.(client);
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <QueryClientProvider client={client}>
        <HalaqaScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

function respond(handlers: Record<string, unknown>) {
  mockRpc.mockImplementation(async (fn) => {
    if (!(fn in handlers)) throw new Error(`Unexpected RPC ${fn}`);
    return { data: handlers[fn], error: null };
  });
}

beforeEach(async () => {
  mockSettings.isRTL = false;
  mockSettings.uiLanguage = "en";
  Object.assign(mockAuth, signedOut());
  for (const key of Object.keys(mockHeaders)) delete mockHeaders[key];
  mockConfigured = true;
  mockNet.isConnected = true;
  mockNet.isInternetReachable = true;
  mockRpc.mockReset();
  jest.mocked(router.push).mockClear();
  await AsyncStorage.clear();
});

afterEach(() => {
  cleanup();
  for (const client of queryClients.splice(0)) client.clear();
});

describe("Halaqa tab", () => {
  it("explains and offers sign-in to a signed-out reader in Arabic RTL", () => {
    mockSettings.isRTL = true;
    mockSettings.uiLanguage = "ar";
    const screen = renderScreen();

    expect(screen.getByText(strings.ar.halaqaSignInTitle)).toBeTruthy();
    expect(screen.getByText(strings.ar.halaqaSignInBody)).toBeTruthy();
    const button = screen.getByRole("button", { name: strings.ar.socialSignIn });
    fireEvent.press(button);
    expect(router.push).toHaveBeenCalledWith("/auth/login");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("says when the account service is not part of this build", () => {
    mockConfigured = false;
    signIn(USER);
    const screen = renderScreen();
    expect(screen.getByText(strings.en.socialUnavailableTitle)).toBeTruthy();
    expect(screen.getByText(strings.en.socialUnconfigured)).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("offers create, join by code and a matched halaqa when the reader has none", async () => {
    signIn(USER);
    respond({ get_my_halaqas: [], join_matched_halaqa: { ...summary, kind: "matched", name: null, invite_code: null } });
    const screen = renderScreen();

    expect(await screen.findByText(strings.en.halaqaEmptyTitle)).toBeTruthy();
    expect(screen.getByText(strings.en.halaqaJoinCode)).toBeTruthy();
    expect(screen.getByText(strings.en.halaqaCreate)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: strings.en.halaqaJoinMatched }));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith("join_matched_halaqa", {
        p_level_band: "juz_amma",
        p_pace_band: "light",
        p_utc_offset_minutes: 180,
      }),
    );
    // The join runs as the account this screen belongs to.
    expect(bearerSubject(mockHeaders.Authorization)).toBe(USER);
  });

  it("does not offer a matched halaqa to an account under 18 (ETH-07)", async () => {
    signIn(USER);
    respond({ get_my_halaqas: [] });
    // The app-wide minor check keeps the account's own privacy in the cache.
    const screen = renderScreen((client) =>
      client.setQueryData(profilePrivacyKeys.mine(USER), {
        boardJoined: false,
        boardNickname: null,
        showStreak: false,
        showJuzCompletions: false,
        isMinor: true,
      }),
    );
    expect(await screen.findByText(strings.en.halaqaEmptyTitle)).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.en.halaqaJoinMatched })).toBeNull();
    expect(screen.getByText(strings.en.halaqaJoinCode)).toBeTruthy();
    // The card does not describe matching it cannot offer.
    expect(screen.getByText(strings.en.halaqaEmptyBodyInviteOnly)).toBeTruthy();
    expect(screen.queryByText(strings.en.halaqaEmptyBody)).toBeNull();
  });

  it("says the matched halaqa was left when saving turns on under 18 there", async () => {
    signIn(USER);
    const matched = { ...summary, kind: "matched", name: null, invite_code: null };
    respond({
      get_my_halaqas: [matched],
      get_halaqa_detail: { ...detail, group: matched },
      get_profile_privacy: adultPrivacy,
      set_halaqa_sharing: matched,
      set_profile_privacy: { ...adultPrivacy, is_minor: true, left_board: false },
    });
    const screen = renderScreen();
    fireEvent.press(await screen.findByLabelText(strings.en.halaqaSharingA11y));
    fireEvent(await screen.findByRole("switch", { name: strings.en.profileIsMinor }), "valueChange", true);
    fireEvent.press(screen.getByRole("button", { name: strings.en.socialSave }));
    expect(await screen.findByText(strings.en.socialSavedLeftMatched)).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith(
      "set_profile_privacy",
      expect.objectContaining({ p_is_minor: true, p_expected_minor: false }),
    );
  });

  it("offers the profile choices only from a read made since the sheet opened (ETH-07)", async () => {
    signIn(USER);
    let privacyFails = true;
    mockRpc.mockImplementation(async (fn) => {
      switch (fn) {
        case "get_my_halaqas":
          return { data: [summary], error: null };
        case "get_halaqa_detail":
          return { data: detail, error: null };
        case "get_profile_privacy":
          return privacyFails
            ? { data: null, error: { message: "synthetic privacy failure" } }
            : { data: { ...adultPrivacy, is_minor: true }, error: null };
        default:
          throw new Error(`Unexpected RPC ${fn}`);
      }
    });
    // An earlier read on this device left an adult copy in the cache.
    const screen = renderScreen((client) => client.setQueryData(profilePrivacyKeys.mine(USER), cachedAdult));
    fireEvent.press(await screen.findByLabelText(strings.en.halaqaSharingA11y));
    expect(await screen.findByText(strings.en.socialErrorGeneric)).toBeTruthy();
    // Saving the cached copy could clear minority recorded on another device.
    expect(screen.queryByRole("switch", { name: strings.en.profileIsMinor })).toBeNull();

    privacyFails = false;
    fireEvent.press(screen.getByRole("button", { name: strings.en.socialTryAgain }));
    const minor = await screen.findByRole("switch", { name: strings.en.profileIsMinor });
    expect(minor.props.accessibilityState).toMatchObject({ checked: true });
  });

  it("keeps a halaqa choice changed before the profile choices arrive", async () => {
    signIn(USER);
    let releasePrivacy: (() => void) | undefined;
    mockRpc.mockImplementation(async (fn) => {
      switch (fn) {
        case "get_my_halaqas":
          return { data: [summary], error: null };
        case "get_halaqa_detail":
          return { data: detail, error: null };
        case "get_profile_privacy":
          await new Promise<void>((resolve) => (releasePrivacy = resolve));
          return { data: adultPrivacy, error: null };
        default:
          throw new Error(`Unexpected RPC ${fn}`);
      }
    });
    const screen = renderScreen();
    fireEvent.press(await screen.findByLabelText(strings.en.halaqaSharingA11y));
    await waitFor(() => expect(releasePrivacy).toBeDefined());
    const consistency = () => screen.getByRole("switch", { name: strings.en.halaqaShareConsistency });
    const before = consistency().props.accessibilityState.checked as boolean;
    fireEvent.press(consistency());
    expect(consistency().props.accessibilityState).toMatchObject({ checked: !before });

    await act(async () => {
      releasePrivacy!();
    });
    expect(await screen.findByRole("switch", { name: strings.en.profileIsMinor })).toBeTruthy();
    // The profile choices arrived; the halaqa choice the person changed stays.
    expect(consistency().props.accessibilityState).toMatchObject({ checked: !before });
  });

  it("says the age setting changed on another device and reloads it when the save is refused (ETH-07)", async () => {
    signIn(USER);
    let stored = adultPrivacy;
    mockRpc.mockImplementation(async (fn) => {
      switch (fn) {
        case "get_my_halaqas":
          return { data: [summary], error: null };
        case "get_halaqa_detail":
          return { data: detail, error: null };
        case "set_halaqa_sharing":
          return { data: summary, error: null };
        case "get_profile_privacy":
          return { data: stored, error: null };
        case "set_profile_privacy":
          // Another device recorded minority after the sheet loaded.
          stored = { ...adultPrivacy, is_minor: true };
          return { data: null, error: { message: "privacy_changed", code: "P0001" } };
        default:
          throw new Error(`Unexpected RPC ${fn}`);
      }
    });
    const screen = renderScreen();
    fireEvent.press(await screen.findByLabelText(strings.en.halaqaSharingA11y));
    fireEvent(await screen.findByRole("switch", { name: strings.en.profileShowStreak }), "valueChange", true);
    fireEvent.press(screen.getByRole("button", { name: strings.en.socialSave }));

    expect(await screen.findByText(strings.en.socialErrorPrivacyChanged)).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith(
      "set_profile_privacy",
      expect.objectContaining({ p_is_minor: false, p_expected_minor: false }),
    );
    // The sheet stays open with the reloaded choice.
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: strings.en.profileIsMinor }).props.accessibilityState).toMatchObject({
        checked: true,
      }),
    );
    expect(mockRpc.mock.calls.filter(([fn]) => fn === "get_profile_privacy")).toHaveLength(2);
  });

  it("says the Board was left when saving under 18 without a Board nickname (BRD-07)", async () => {
    mockSettings.isRTL = true;
    mockSettings.uiLanguage = "ar";
    signIn(USER);
    respond({
      get_my_halaqas: [summary],
      get_halaqa_detail: detail,
      get_profile_privacy: { ...adultPrivacy, board_joined: true },
      set_halaqa_sharing: summary,
      set_profile_privacy: { ...adultPrivacy, is_minor: true, left_board: true },
    });
    const screen = renderScreen();
    fireEvent.press(await screen.findByLabelText(strings.ar.halaqaSharingA11y));
    fireEvent(await screen.findByRole("switch", { name: strings.ar.profileIsMinor }), "valueChange", true);
    fireEvent.press(screen.getByRole("button", { name: strings.ar.socialSave }));
    expect(await screen.findByText(strings.ar.socialSavedLeftBoard)).toBeTruthy();
  });

  it("shows the shared goal and only what each member shared, with no ranking", async () => {
    signIn(USER);
    respond({ get_my_halaqas: [summary], get_halaqa_detail: detail, send_halaqa_encouragement: { id: GROUP } });
    const screen = renderScreen();

    expect(await screen.findByText("Family halaqa")).toBeTruthy();
    expect(screen.getByText(interpolate(strings.en.halaqaGoalProgress, { done: "3", target: "10" }))).toBeTruthy();
    expect(screen.getByLabelText(interpolate(strings.en.halaqaWeekA11y, { n: "2" }))).toBeTruthy();
    expect(screen.getByText(interpolate(strings.en.halaqaStreak, { days: "4 days" }))).toBeTruthy();
    expect(screen.getByText(strings.en.halaqaNotShared)).toBeTruthy();
    expect(screen.getByText("ABCD2345")).toBeTruthy();
    // No member is ranked: there are no standalone position numbers.
    expect(screen.queryByText(/^#?\d+$/)).toBeNull();
    // The reader cannot encourage themselves.
    expect(screen.queryByRole("button", { name: interpolate(strings.en.halaqaEncourageA11y, { name: "Amina" }) })).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: interpolate(strings.en.halaqaEncourageA11y, { name: "Yusuf" }) }));
    fireEvent.press(await screen.findByRole("button", { name: strings.en.halaqaEncourageDua }));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith(
        "send_halaqa_encouragement",
        expect.objectContaining({ p_group_id: GROUP, p_to_user: OTHER, p_template_id: "dua", p_body: null }),
      ),
    );
  });

  it("mirrors the week dots for Arabic readers", async () => {
    mockSettings.isRTL = true;
    mockSettings.uiLanguage = "ar";
    signIn(USER);
    respond({ get_my_halaqas: [summary], get_halaqa_detail: detail });
    const screen = renderScreen();

    const dots = await screen.findByLabelText(interpolate(strings.ar.halaqaWeekA11y, { n: "٢" }));
    expect(flattenStyle(dots.props.style)).toMatchObject({ direction: "ltr", flexDirection: "row-reverse" });
  });

  it("shows the last saved state with its date while offline", async () => {
    signIn(USER);
    respond({ get_my_halaqas: [summary], get_halaqa_detail: detail });
    const online = renderScreen();
    expect(await online.findByText("Family halaqa")).toBeTruthy();
    online.unmount();

    mockNet.isConnected = false;
    mockRpc.mockReset();
    const offline = renderScreen();
    expect(await offline.findByText("Family halaqa")).toBeTruthy();
    expect(offline.getByText(/^Offline\. Showing what you last saw on /)).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  describe("teacher role (SOC-03)", () => {
    // The reader created this invite halaqa as its teacher.
    const created = { ...summary, role: "teacher", is_creator: true };
    function groupWith(group: Record<string, unknown> & { role: string }, yusufRole: "member" | "teacher") {
      return {
        ...detail,
        group,
        members: [
          { ...detail.members[0], role: group.role },
          { ...detail.members[1], role: yusufRole },
        ],
      };
    }
    // The halaqa as the server holds it: a role write changes what the next group read returns.
    type Reply = { data: unknown; error: unknown };
    function serve(start: "member" | "teacher", write: (args: Record<string, unknown>) => Reply | Promise<Reply>) {
      let yusufRole = start;
      mockRpc.mockImplementation(async (fn, args) => {
        switch (fn) {
          case "get_my_halaqas":
            return { data: [created], error: null };
          case "get_halaqa_detail":
            return { data: groupWith(created, yusufRole), error: null };
          case "set_halaqa_member_role": {
            const result = await write(args);
            if (!result.error) yusufRole = args.p_role as "member" | "teacher";
            return result;
          }
          default:
            throw new Error(`Unexpected RPC ${fn}`);
        }
      });
    }
    const roleWrites = () => mockRpc.mock.calls.filter(([fn]) => fn === "set_halaqa_member_role");
    const makeLabel = (name: string, locale: "en" | "ar" = "en") =>
      interpolate(strings[locale].halaqaMakeTeacherA11y, { name });
    const removeLabel = (name: string, locale: "en" | "ar" = "en") =>
      interpolate(strings[locale].halaqaRemoveTeacherA11y, { name });
    // The row's own control stays on screen under the dialog, so dialog buttons are found inside it.
    const inDialog = (screen: ReturnType<typeof renderScreen>) =>
      within(screen.UNSAFE_getAllByType(ConfirmDialog).find((dialog) => dialog.props.visible)!);

    it("lets the creator make another member a teacher after confirming, once", async () => {
      signIn(USER);
      let release: (() => void) | undefined;
      serve("member", () => new Promise<Reply>((resolve) => (release = () => resolve({ data: null, error: null }))));
      const screen = renderScreen();

      const make = await screen.findByRole("button", { name: makeLabel("Yusuf") });
      expect(make.props.accessibilityState).toMatchObject({ disabled: false });
      // Nothing is sent before the creator confirms what a teacher sees.
      fireEvent.press(make);
      expect(screen.getByText(interpolate(strings.en.halaqaMakeTeacherTitle, { name: "Yusuf" }))).toBeTruthy();
      expect(screen.getByText(strings.en.halaqaMakeTeacherBody)).toBeTruthy();
      expect(roleWrites()).toHaveLength(0);

      const confirm = inDialog(screen).getByRole("button", { name: strings.en.halaqaMakeTeacherConfirm });
      fireEvent.press(confirm);
      fireEvent.press(confirm);
      // While it saves, the row's control waits too.
      await waitFor(() =>
        expect(screen.getByRole("button", { name: makeLabel("Yusuf") }).props.accessibilityState).toMatchObject({
          disabled: true,
        }),
      );
      await act(async () => release!());
      expect(await screen.findByRole("button", { name: removeLabel("Yusuf") })).toBeTruthy();
      expect(roleWrites()).toEqual([
        ["set_halaqa_member_role", { p_group_id: GROUP, p_member_id: OTHER, p_role: "teacher" }],
      ]);
      expect(bearerSubject(mockHeaders.Authorization)).toBe(USER);
      await waitFor(() => expect(screen.queryByText(strings.en.halaqaMakeTeacherBody)).toBeNull());
    });

    it("lets the creator remove a member's teacher role after confirming", async () => {
      signIn(USER);
      serve("teacher", () => ({ data: null, error: null }));
      const screen = renderScreen();

      fireEvent.press(await screen.findByRole("button", { name: removeLabel("Yusuf") }));
      expect(screen.getByText(interpolate(strings.en.halaqaRemoveTeacherTitle, { name: "Yusuf" }))).toBeTruthy();
      expect(screen.getByText(strings.en.halaqaRemoveTeacherBody)).toBeTruthy();
      fireEvent.press(inDialog(screen).getByRole("button", { name: strings.en.halaqaRemoveTeacherConfirm }));

      expect(await screen.findByRole("button", { name: makeLabel("Yusuf") })).toBeTruthy();
      expect(roleWrites()).toEqual([
        ["set_halaqa_member_role", { p_group_id: GROUP, p_member_id: OTHER, p_role: "member" }],
      ]);
    });

    it("offers no role control to other members, in a matched halaqa, or on the creator's own row", async () => {
      signIn(USER);
      const noRoleControl = (screen: ReturnType<typeof renderScreen>) => {
        for (const name of ["Amina", "Yusuf"]) {
          expect(screen.queryByRole("button", { name: makeLabel(name) })).toBeNull();
          expect(screen.queryByRole("button", { name: removeLabel(name) })).toBeNull();
        }
        expect(screen.queryByText(strings.en.halaqaMakeTeacher)).toBeNull();
        expect(screen.queryByText(strings.en.halaqaRemoveTeacher)).toBeNull();
      };

      // A member who did not create the halaqa, beside a teacher.
      respond({ get_my_halaqas: [summary], get_halaqa_detail: groupWith(summary, "teacher") });
      const member = renderScreen();
      expect(await member.findByText("Family halaqa")).toBeTruthy();
      noRoleControl(member);
      member.unmount();

      // A matched halaqa has no teachers, whatever the summary says.
      const matched = { ...created, kind: "matched", name: null, invite_code: null };
      respond({ get_my_halaqas: [matched], get_halaqa_detail: groupWith(matched, "member") });
      const inMatched = renderScreen();
      expect(await inMatched.findByText(strings.en.halaqaMatchedName)).toBeTruthy();
      noRoleControl(inMatched);
      inMatched.unmount();

      // The creator's own role was chosen at creation; only the other member's row has the control.
      respond({ get_my_halaqas: [created], get_halaqa_detail: groupWith(created, "member") });
      const creator = renderScreen();
      expect(await creator.findByRole("button", { name: makeLabel("Yusuf") })).toBeTruthy();
      expect(creator.queryByRole("button", { name: makeLabel("Amina") })).toBeNull();
      expect(creator.queryByRole("button", { name: removeLabel("Amina") })).toBeNull();
      expect(creator.getAllByText(strings.en.halaqaMakeTeacher)).toHaveLength(1);
      expect(mockRpc.mock.calls.filter(([fn]) => fn === "set_halaqa_member_role")).toHaveLength(0);
    });

    it("shows a refused write in the dialog and keeps the member's role", async () => {
      signIn(USER);
      serve("member", () => ({ data: null, error: { message: "not_allowed", code: "42501" } }));
      const screen = renderScreen();

      fireEvent.press(await screen.findByRole("button", { name: makeLabel("Yusuf") }));
      const reads = mockRpc.mock.calls.filter(([fn]) => fn === "get_halaqa_detail").length;
      fireEvent.press(inDialog(screen).getByRole("button", { name: strings.en.halaqaMakeTeacherConfirm }));

      expect(await screen.findByText(strings.en.socialErrorGeneric)).toBeTruthy();
      expect(roleWrites()).toHaveLength(1);
      // The dialog stays open for another try or cancel, and the row still offers the same change.
      expect(screen.getByText(strings.en.halaqaMakeTeacherBody)).toBeTruthy();
      expect(screen.getByRole("button", { name: makeLabel("Yusuf") }).props.accessibilityState).toMatchObject({
        disabled: false,
      });
      expect(screen.queryByRole("button", { name: removeLabel("Yusuf") })).toBeNull();
      // Only the creator's own row carries the teacher badge.
      expect(screen.getAllByText(strings.en.halaqaTeacherBadge)).toHaveLength(1);
      expect(mockRpc.mock.calls.filter(([fn]) => fn === "get_halaqa_detail")).toHaveLength(reads);

      fireEvent.press(inDialog(screen).getByRole("button", { name: strings.en.socialCancel }));
      await waitFor(() => expect(screen.queryByText(strings.en.socialErrorGeneric)).toBeNull());
    });

    it("lays the control out from the reading side in English and Arabic", async () => {
      signIn(USER);
      serve("member", () => ({ data: null, error: null }));
      const english = renderScreen();
      const make = await english.findByRole("button", { name: makeLabel("Yusuf") });
      expect(flattenStyle(make.props.style)).toMatchObject({ direction: "ltr", flexDirection: "row" });
      expect(english.getByText(strings.en.halaqaMakeTeacher)).toBeTruthy();
      english.unmount();

      mockSettings.isRTL = true;
      mockSettings.uiLanguage = "ar";
      const arabic = renderScreen();
      const ar = await arabic.findByRole("button", { name: makeLabel("Yusuf", "ar") });
      expect(flattenStyle(ar.props.style)).toMatchObject({ direction: "ltr", flexDirection: "row-reverse" });
      expect(arabic.getByText(strings.ar.halaqaMakeTeacher)).toBeTruthy();
      fireEvent.press(ar);
      expect(arabic.getByText(interpolate(strings.ar.halaqaMakeTeacherTitle, { name: "Yusuf" }))).toBeTruthy();
      expect(arabic.getByText(strings.ar.halaqaMakeTeacherBody)).toBeTruthy();
      fireEvent.press(inDialog(arabic).getByRole("button", { name: strings.ar.halaqaMakeTeacherConfirm }));
      expect(await arabic.findByRole("button", { name: removeLabel("Yusuf", "ar") })).toBeTruthy();
      expect(arabic.getByText(strings.ar.halaqaRemoveTeacher)).toBeTruthy();
    });
  });

  it("keeps wird features unblocked: offline with nothing saved is a calm note", async () => {
    signIn(USER);
    mockNet.isConnected = false;
    const screen = renderScreen();
    expect(await screen.findByText(strings.en.socialOfflineEmpty)).toBeTruthy();
    await act(async () => undefined);
  });
});
