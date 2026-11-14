import React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import type { AppDatabase } from "@/lib/database/types";
import { isSyncableUserSetting } from "@/lib/database/user-settings";
import {
  checkGroupEncouragements,
  encouragementAcksKey,
  useGroupEncouragementChecks,
} from "@/lib/halaqa/encouragement-notifications";
import { notifyGroupEncouragement } from "@/lib/notifications/schedule";
import { socialFailureOf } from "@/lib/social/remote";
import { emitSyncCompleted } from "@/lib/sync/events";
import { signedIn, signedOut, type FakeAuthState } from "./social-test-auth";

const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const E1 = "00000000-0000-4000-8e00-000000000001";
const E2 = "00000000-0000-4000-8e00-000000000002";
const E3 = "00000000-0000-4000-8e00-000000000003";
const T1 = "2026-11-13T08:00:00.123456+00:00";
const T2 = "2026-11-13T09:30:00.654321+00:00";
const CHECKED = "2026-11-13T10:00:00+00:00";

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
jest.mock("@/lib/notifications/schedule", () => ({ notifyGroupEncouragement: jest.fn(async () => true) }));

function inbox(...items: [id: string, createdAt: string][]) {
  return { data: { items: items.map(([id, created_at]) => ({ id, created_at })), more: false, checked_at: CHECKED }, error: null };
}

const key = encouragementAcksKey(USER);
const acks = (...items: [string, string][]) => JSON.stringify({ acked: items });
const ackedIds = () => (JSON.parse(mockSettings.get(key) ?? "{}") as { acked?: [string, string][] }).acked?.map(([id]) => id);

beforeEach(() => {
  mockRpc.mockReset();
  mockSettings.clear();
  jest.mocked(notifyGroupEncouragement).mockReset().mockResolvedValue(true);
  Object.assign(mockAuth, signedIn(USER));
});

afterEach(cleanup);

describe("group encouragement notifications (5.8.2)", () => {
  it("keeps its acknowledgements on the device only", () => {
    expect(isSyncableUserSetting(key)).toBe(false);
    expect(encouragementAcksKey(OTHER)).not.toBe(key);
  });

  it("acknowledges what is listed on the first check without announcing it", async () => {
    mockRpc.mockResolvedValue(inbox([E2, T2], [E1, T1]));
    await expect(checkGroupEncouragements(mockDb, USER)).resolves.toEqual({ status: "started" });
    expect(mockRpc).toHaveBeenCalledWith("get_received_encouragements", {});
    expect(notifyGroupEncouragement).not.toHaveBeenCalled();
    expect(ackedIds()).toEqual([E2, E1]);
  });

  it("starts with an empty list when nothing has arrived yet", async () => {
    mockRpc.mockResolvedValue(inbox());
    await checkGroupEncouragements(mockDb, USER);
    expect(ackedIds()).toEqual([]);
  });

  it("announces ids it has not acknowledged for this account, then acknowledges them", async () => {
    mockSettings.set(key, acks([E1, T1]));
    mockRpc.mockResolvedValue(inbox([E3, T2], [E2, T2], [E1, T1]));
    await expect(checkGroupEncouragements(mockDb, USER)).resolves.toEqual({ status: "checked", received: 2 });
    expect(notifyGroupEncouragement).toHaveBeenCalledWith(mockDb, { account: expect.objectContaining({ userId: USER }), count: 2 });
    expect(ackedIds()).toEqual([E1, E3, E2]);
  });

  it("announces a send that committed late with an earlier time", async () => {
    // E2 is newer and already acknowledged; E1 committed after it was read, with an earlier time.
    mockSettings.set(key, acks([E2, T2]));
    mockRpc.mockResolvedValue(inbox([E2, T2], [E1, T1]));
    await expect(checkGroupEncouragements(mockDb, USER)).resolves.toEqual({ status: "checked", received: 1 });
    expect(notifyGroupEncouragement).toHaveBeenCalledWith(mockDb, expect.objectContaining({ count: 1 }));
  });

  it("forgets acknowledgements older than the server's 7-day list", async () => {
    mockSettings.set(key, acks(["old", "2026-11-05T08:00:00+00:00"], [E1, T1]));
    mockRpc.mockResolvedValue(inbox([E1, T1]));
    await checkGroupEncouragements(mockDb, USER);
    expect(ackedIds()).toEqual([E1]);
  });

  it("keeps its acknowledgements when the notification fails, so the next check retries", async () => {
    mockSettings.set(key, acks([E1, T1]));
    mockRpc.mockResolvedValue(inbox([E2, T2], [E1, T1]));
    jest.mocked(notifyGroupEncouragement).mockRejectedValueOnce(new Error("scheduler unavailable"));
    await expect(checkGroupEncouragements(mockDb, USER)).rejects.toThrow("scheduler unavailable");
    expect(ackedIds()).toEqual([E1]);
  });

  // Fourth review, finding 4: a read that stops early hands on what it listed instead of failing, and
  // the ids it did not reach are announced by a later check, each once.
  it("announces what a stopped read listed, and the rest on a later check, never twice", async () => {
    const E0 = "00000000-0000-4000-8e00-000000000000";
    const T0 = "2026-11-13T07:00:00+00:00";
    mockSettings.set(key, acks([E0, T0]));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    // The server repeats its first page as if more followed.
    mockRpc.mockResolvedValue({
      data: { items: [{ id: E1, created_at: T1 }, { id: E2, created_at: T2 }], more: true, checked_at: CHECKED },
      error: null,
    });
    await expect(checkGroupEncouragements(mockDb, USER)).resolves.toEqual({ status: "checked", received: 2 });
    expect(notifyGroupEncouragement).toHaveBeenLastCalledWith(mockDb, expect.objectContaining({ count: 2 }));
    expect(ackedIds()).toEqual([E0, E1, E2]);

    mockRpc.mockReset().mockResolvedValue(inbox([E1, T1], [E2, T2], [E3, T2]));
    await expect(checkGroupEncouragements(mockDb, USER)).resolves.toEqual({ status: "checked", received: 1 });
    expect(notifyGroupEncouragement).toHaveBeenLastCalledWith(mockDb, expect.objectContaining({ count: 1 }));
    expect(notifyGroupEncouragement).toHaveBeenCalledTimes(2);
    expect(ackedIds()).toEqual([E0, E1, E2, E3]);
    warn.mockRestore();
  });

  it("does nothing for a signed-out reader", async () => {
    Object.assign(mockAuth, signedOut());
    await expect(checkGroupEncouragements(mockDb, null)).resolves.toEqual({ status: "skipped" });
    await expect(checkGroupEncouragements(mockDb, USER)).resolves.toEqual({ status: "skipped" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("neither announces nor acknowledges when the account changes during the check", async () => {
    mockSettings.set(key, acks([E1, T1]));
    mockRpc.mockImplementation(async () => {
      Object.assign(mockAuth, signedIn(OTHER));
      return inbox([E2, T2], [E1, T1]);
    });
    const error = await checkGroupEncouragements(mockDb, USER).catch((caught: unknown) => caught);
    expect(socialFailureOf(error)).toEqual({ kind: "account_changed" });
    expect(notifyGroupEncouragement).not.toHaveBeenCalled();
    expect(ackedIds()).toEqual([E1]);
  });

  it("hands the batch its own account, and leaves the ids for later when it was not recorded", async () => {
    mockSettings.set(key, acks([E1, T1]));
    mockRpc.mockResolvedValue(inbox([E2, T2], [E1, T1]));
    jest.mocked(notifyGroupEncouragement).mockImplementationOnce(async (_db, { account }) => {
      expect(account.isCurrent()).toBe(true);
      Object.assign(mockAuth, signedIn(OTHER));
      expect(account.isCurrent()).toBe(false);
      return false;
    });
    await expect(checkGroupEncouragements(mockDb, USER)).resolves.toEqual({ status: "skipped" });
    expect(ackedIds()).toEqual([E1]);
  });

  it("runs one check at a time, so two triggers cannot announce the same encouragement twice", async () => {
    mockSettings.set(key, acks([E1, T1]));
    mockRpc.mockResolvedValue(inbox([E2, T2], [E1, T1]));
    await Promise.all([checkGroupEncouragements(mockDb, USER), checkGroupEncouragements(mockDb, USER)]);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(notifyGroupEncouragement).toHaveBeenCalledTimes(1);
  });

  it("checks on mount, when the app returns to the foreground and after each sync", async () => {
    mockSettings.set(key, acks([E1, T1]));
    mockRpc.mockResolvedValue(inbox([E1, T1]));
    let onAppState: ((state: AppStateStatus) => void) | null = null;
    const remove = jest.fn();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      onAppState = listener as (state: AppStateStatus) => void;
      return { remove };
    });
    function Probe() {
      useGroupEncouragementChecks();
      return null;
    }
    const screen = render(<Probe />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    await act(async () => onAppState?.("background"));
    await act(async () => onAppState?.("active"));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));
    await act(async () => emitSyncCompleted({ pushed: 0, pulled: 1 }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(3));
    screen.unmount();
    expect(remove).toHaveBeenCalled();
    await act(async () => emitSyncCompleted({ pushed: 0, pulled: 1 }));
    expect(mockRpc).toHaveBeenCalledTimes(3);
  });
});
