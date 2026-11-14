import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import { boardKeys, type BoardInputs } from "@/lib/board/api";
import { BOARD_ACTIVITY_SETTLE_MS, useBoardBandRefresh } from "@/lib/board/refresh";
import { hasCompletedAccountRestore } from "@/lib/database/sync";
import type { AppDatabase } from "@/lib/database/types";
import { emitReviewActivity } from "@/lib/fsrs/review-events";
import { readLocalBoardInputs } from "@/lib/social/queries";
import { emitSyncCompleted } from "@/lib/sync/events";
import { bearerSubject, signedIn, signedOut, type FakeAuthState } from "./social-test-auth";

const USER = "00000000-0000-4000-8000-00000000000a";
/** Used only by the test that notes a membership, which the module keeps for the day. */
const JOINER = "00000000-0000-4000-8000-00000000000c";

const mockRpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string, Record<string, unknown>]>();
const mockHeaders: Record<string, string> = {};
const mockAuth: FakeAuthState = signedOut();
const mockSettings = new Map<string, string>();
const mockDb = {
  getFirstAsync: async (_sql: string, params: string[]) =>
    mockSettings.has(params[0]) ? { value: mockSettings.get(params[0]) } : null,
  runAsync: async (_sql: string, params: string[]) => {
    mockSettings.set(params[0], params[1]);
  },
} as unknown as AppDatabase;

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabaseAnonKey: () => "synthetic-public-key",
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) =>
      require("./social-test-auth").rpcBuilder(mockRpc(fn, args), mockHeaders),
    auth: { getSession: async () => ({ data: { session: mockAuth.session }, error: null }) },
  },
}));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: Object.assign((selector: (state: typeof mockAuth) => unknown) => selector(mockAuth), {
    getState: () => mockAuth,
  }),
}));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => ({ uiLanguage: "en" }) }));
jest.mock("@/lib/social/queries", () => ({ readLocalBoardInputs: jest.fn() }));
jest.mock("@/lib/database/sync", () => ({ hasCompletedAccountRestore: jest.fn() }));

const juzAmma: BoardInputs = { bands: { levelBand: "juz_amma", paceBand: "light", utcOffsetMinutes: 180 }, weekStart: 6 };
const hafiz: BoardInputs = { bands: { levelBand: "hafiz", paceBand: "light", utcOffsetMinutes: 180 }, weekStart: 6 };

let joined = true;
const privacy = (boardJoined: boolean) => ({
  board_joined: boardJoined,
  board_nickname: null,
  show_streak: false,
  show_juz_completions: false,
  is_minor: false,
});
const calls = (fn: string) => mockRpc.mock.calls.filter(([name]) => name === fn);
const sentLevels = () => calls("refresh_board_bands").map(([, args]) => args.p_level_band);

function Probe() {
  useBoardBandRefresh();
  return null;
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return { client, screen };
}

beforeEach(() => {
  joined = true;
  mockRpc.mockReset().mockImplementation(async (fn) => ({ data: fn === "get_profile_privacy" ? privacy(joined) : null, error: null }));
  mockSettings.clear();
  Object.assign(mockAuth, signedIn(USER));
  jest.mocked(readLocalBoardInputs).mockReset().mockResolvedValue(juzAmma);
  jest.mocked(hasCompletedAccountRestore).mockReset().mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("useBoardBandRefresh (8.13)", () => {
  it("waits for the account's restore, reports once the sync finishes it, and again after changes are pulled", async () => {
    // Signed in, but this account's restore has not finished: the local rows may be another account's.
    jest.mocked(hasCompletedAccountRestore).mockResolvedValue(false);
    renderProbe();
    await waitFor(() => expect(hasCompletedAccountRestore).toHaveBeenCalledWith(mockDb, USER));
    await act(async () => {});
    expect(readLocalBoardInputs).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();

    jest.mocked(hasCompletedAccountRestore).mockResolvedValue(true);
    await act(async () => emitSyncCompleted({ pushed: 0, pulled: 40, accountRestored: true, localDataReplaced: true }));
    await waitFor(() => expect(sentLevels()).toEqual(["juz_amma"]));
    expect(bearerSubject(mockHeaders.Authorization)).toBe(USER);

    // Another device's changes arrive with a later sync.
    jest.mocked(readLocalBoardInputs).mockResolvedValue(hafiz);
    await act(async () => emitSyncCompleted({ pushed: 0, pulled: 2 }));
    await waitFor(() => expect(sentLevels()).toEqual(["juz_amma", "hafiz"]));
  });

  it("compares the bands once a burst of review activity settles", async () => {
    jest.useFakeTimers();
    renderProbe();
    await waitFor(() => expect(sentLevels()).toEqual(["juz_amma"]));
    expect(readLocalBoardInputs).toHaveBeenCalledTimes(1);

    jest.mocked(readLocalBoardInputs).mockResolvedValue(hafiz);
    for (let grade = 0; grade < 5; grade += 1) {
      await act(async () => {
        emitReviewActivity();
        jest.advanceTimersByTime(5_000);
      });
    }
    expect(readLocalBoardInputs).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(BOARD_ACTIVITY_SETTLE_MS);
    });
    await waitFor(() => expect(sentLevels()).toEqual(["juz_amma", "hafiz"]));
    expect(readLocalBoardInputs).toHaveBeenCalledTimes(2);
  });

  it("computes nothing off the board, and reports once the Board tab shows the account joined", async () => {
    jest.useFakeTimers();
    Object.assign(mockAuth, signedIn(JOINER));
    joined = false;
    const { client } = renderProbe();
    await waitFor(() => expect(calls("get_profile_privacy")).toHaveLength(1));
    await act(async () => {
      emitReviewActivity();
      jest.advanceTimersByTime(BOARD_ACTIVITY_SETTLE_MS);
    });
    expect(readLocalBoardInputs).not.toHaveBeenCalled();
    expect(calls("get_profile_privacy")).toHaveLength(1);

    // The user joins in the Board tab, whose fresh view shows the account placed.
    await act(async () => {
      client.setQueryData([...boardKeys.all(JOINER), "2026-11-14", "online"], {
        data: { status: "gathering", weekStart: "2026-11-14", memberCount: 1, minMembers: 5 },
        savedAt: "2026-11-14T08:00:00.000Z",
        source: "network",
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(BOARD_ACTIVITY_SETTLE_MS);
    });
    await waitFor(() => expect(sentLevels()).toEqual(["juz_amma"]));
    expect(bearerSubject(mockHeaders.Authorization)).toBe(JOINER);
    expect(calls("get_profile_privacy")).toHaveLength(1);
  });
});
