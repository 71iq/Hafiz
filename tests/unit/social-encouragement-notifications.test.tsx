import React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import type { AppDatabase } from "@/lib/database/types";
import { isSyncableUserSetting } from "@/lib/database/user-settings";
import {
  checkGroupEncouragements,
  encouragementWatermarkKey,
  useGroupEncouragementChecks,
} from "@/lib/halaqa/encouragement-notifications";
import { notifyGroupEncouragement } from "@/lib/notifications/schedule";
import { socialFailureOf } from "@/lib/social/remote";
import { emitSyncCompleted } from "@/lib/sync/events";
import { signedIn, signedOut, type FakeAuthState } from "./social-test-auth";

const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
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
jest.mock("@/lib/notifications/schedule", () => ({ notifyGroupEncouragement: jest.fn(async () => undefined) }));

function inbox(count: number, latest: string | null) {
  return { data: { count, latest_created_at: latest, checked_at: CHECKED }, error: null };
}

const key = encouragementWatermarkKey(USER);

beforeEach(() => {
  mockRpc.mockReset();
  mockSettings.clear();
  jest.mocked(notifyGroupEncouragement).mockReset().mockResolvedValue(undefined);
  Object.assign(mockAuth, signedIn(USER));
});

afterEach(cleanup);

describe("group encouragement notifications (5.8.2)", () => {
  it("keeps its mark on the device only", () => {
    expect(isSyncableUserSetting(key)).toBe(false);
    expect(encouragementWatermarkKey(OTHER)).not.toBe(key);
  });

  it("starts the mark on the first check without announcing older encouragement", async () => {
    mockRpc.mockResolvedValue(inbox(3, T1));
    await expect(checkGroupEncouragements(mockDb, USER)).resolves.toEqual({ status: "started" });
    expect(mockRpc).toHaveBeenCalledWith("get_received_encouragements_since", { p_since: null });
    expect(notifyGroupEncouragement).not.toHaveBeenCalled();
    expect(mockSettings.get(key)).toBe(T1);
  });

  it("starts from the server's time when nothing has arrived yet", async () => {
    mockRpc.mockResolvedValue(inbox(0, null));
    await checkGroupEncouragements(mockDb, USER);
    expect(mockSettings.get(key)).toBe(CHECKED);
  });

  it("announces what arrived after the mark, then moves it", async () => {
    mockSettings.set(key, T1);
    mockRpc.mockResolvedValue(inbox(2, T2));
    await expect(checkGroupEncouragements(mockDb, USER)).resolves.toEqual({ status: "checked", received: 2 });
    expect(mockRpc).toHaveBeenCalledWith("get_received_encouragements_since", { p_since: T1 });
    expect(notifyGroupEncouragement).toHaveBeenCalledWith(mockDb, { count: 2 });
    expect(mockSettings.get(key)).toBe(T2);
  });

  it("keeps the mark when the notification fails, so the next check retries", async () => {
    mockSettings.set(key, T1);
    mockRpc.mockResolvedValue(inbox(1, T2));
    jest.mocked(notifyGroupEncouragement).mockRejectedValueOnce(new Error("scheduler unavailable"));
    await expect(checkGroupEncouragements(mockDb, USER)).rejects.toThrow("scheduler unavailable");
    expect(mockSettings.get(key)).toBe(T1);
  });

  it("moves past encouragement from a halaqa the reader left without announcing it", async () => {
    mockSettings.set(key, T1);
    mockRpc.mockResolvedValue(inbox(0, T2));
    await checkGroupEncouragements(mockDb, USER);
    expect(notifyGroupEncouragement).not.toHaveBeenCalled();
    expect(mockSettings.get(key)).toBe(T2);
  });

  it("does nothing for a signed-out reader", async () => {
    Object.assign(mockAuth, signedOut());
    await expect(checkGroupEncouragements(mockDb, null)).resolves.toEqual({ status: "skipped" });
    await expect(checkGroupEncouragements(mockDb, USER)).resolves.toEqual({ status: "skipped" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("neither announces nor moves the mark when the account changes during the check", async () => {
    mockSettings.set(key, T1);
    mockRpc.mockImplementation(async () => {
      Object.assign(mockAuth, signedIn(OTHER));
      return inbox(4, T2);
    });
    const error = await checkGroupEncouragements(mockDb, USER).catch((caught: unknown) => caught);
    expect(socialFailureOf(error)).toEqual({ kind: "account_changed" });
    expect(notifyGroupEncouragement).not.toHaveBeenCalled();
    expect(mockSettings.get(key)).toBe(T1);
  });

  it("runs one check at a time, so two triggers cannot announce the same encouragement twice", async () => {
    mockSettings.set(key, T1);
    mockRpc.mockResolvedValue(inbox(1, T2));
    await Promise.all([checkGroupEncouragements(mockDb, USER), checkGroupEncouragements(mockDb, USER)]);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(notifyGroupEncouragement).toHaveBeenCalledTimes(1);
  });

  it("checks on mount, when the app returns to the foreground and after each sync", async () => {
    mockSettings.set(key, T1);
    mockRpc.mockResolvedValue(inbox(0, null));
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
