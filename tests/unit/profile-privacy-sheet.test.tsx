import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ProfilePrivacySheet } from "@/components/settings/ProfilePrivacySheet";
import { strings } from "@/lib/i18n/strings";
import { profilePrivacyKeys } from "@/lib/profile/privacy";
import { signedIn, type FakeAuthState } from "./social-test-auth";

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
const USER = "00000000-0000-4000-8000-00000000000a";
const mockAuth: FakeAuthState & { fetchProfile: jest.Mock } = { ...signedIn(USER), fetchProfile: jest.fn() };
const mockHeaders: Record<string, string> = {};
const mockRpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string, Record<string, unknown>]>();

// The sheet opens without its spring, so no animation frame runs after a test ends.
jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => true }));
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

const publicStreak = {
  board_joined: false,
  board_nickname: null,
  show_streak: true,
  show_juz_completions: true,
  is_minor: false,
};

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockImplementation(async (fn, args) => {
    switch (fn) {
      case "get_profile_privacy":
        return { data: publicStreak, error: null };
      case "set_profile_privacy":
        return {
          data: {
            ...publicStreak,
            show_streak: args.p_show_streak,
            show_juz_completions: args.p_show_juz_completions,
            left_board: false,
          },
          error: null,
        };
      default:
        throw new Error(`unexpected ${fn}`);
    }
  });
});
const queryClients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  // Clearing ends the mutation cache's collection timers, so Jest can exit.
  for (const client of queryClients.splice(0)) client.clear();
});

function renderSheet() {
  const onClose = jest.fn();
  const onNotice = jest.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClients.push(client);
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={client}>
        <ProfilePrivacySheet userId={USER} onClose={onClose} onNotice={onNotice} />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  return { ...view, onClose, onNotice, client };
}

const en = strings.en;

describe("Privacy and sharing (SET-20)", () => {
  it("turns off a public streak and juz completions that an earlier version made public", async () => {
    const view = renderSheet();
    await waitFor(() => expect(view.getByText(en.profileShowStreak)).toBeTruthy(), { timeout: 5000 });
    fireEvent.press(view.getByRole("switch", { name: en.profileShowStreak }));
    fireEvent.press(view.getByRole("switch", { name: en.profileShowJuz }));
    fireEvent.press(view.getByRole("button", { name: en.socialSave }));
    // Closed and confirmed at once, with the new choices in use while the server stores them.
    expect(view.onNotice).toHaveBeenCalledWith(en.socialSaved);
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(view.client.getQueryData(profilePrivacyKeys.mine(USER))).toMatchObject({
      showStreak: false,
      showJuzCompletions: false,
    });
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith("set_profile_privacy", expect.anything()));
    expect(mockRpc).toHaveBeenCalledWith("set_profile_privacy", {
      p_show_streak: false,
      p_show_juz_completions: false,
      p_is_minor: false,
      p_expected_minor: false,
    });
    expect(view.onClose).toHaveBeenCalled();
  });

  it("restores the stored choices and says they were not saved when the server refuses", async () => {
    const base = mockRpc.getMockImplementation()!;
    mockRpc.mockImplementation(async (fn, args) =>
      fn === "set_profile_privacy"
        ? { data: null, error: { code: "XX000", message: "synthetic failure" } }
        : base(fn, args),
    );
    const view = renderSheet();
    await waitFor(() => expect(view.getByText(en.profileShowStreak)).toBeTruthy(), { timeout: 5000 });
    fireEvent.press(view.getByRole("switch", { name: en.profileShowStreak }));
    fireEvent.press(view.getByRole("button", { name: en.socialSave }));
    expect(view.onClose).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(view.onNotice).toHaveBeenLastCalledWith(`${en.privacyNotSaved} ${en.socialErrorGeneric}`),
    );
    await waitFor(() =>
      expect(view.client.getQueryData(profilePrivacyKeys.mine(USER))).toMatchObject({ showStreak: true }),
    );
  });

  // Halaqa and its server tables are gone, so the sheet no longer asks about halaqas from an earlier version.
  it("reads only the profile choices", async () => {
    const view = renderSheet();
    await waitFor(() => expect(view.getByText(en.profileShowStreak)).toBeTruthy(), { timeout: 5000 });
    expect(new Set(mockRpc.mock.calls.map(([fn]) => fn))).toEqual(new Set(["get_profile_privacy"]));
  });

});
