import type { BoardInputs } from "@/lib/board/api";
import { boardKeys } from "@/lib/board/api";
import {
  boardBandsSentKey,
  membershipFromQuery,
  noteBoardMembership,
  refreshBoardBands,
} from "@/lib/board/refresh";
import { hasCompletedAccountRestore } from "@/lib/database/sync";
import type { AppDatabase } from "@/lib/database/types";
import { isSyncableUserSetting } from "@/lib/database/user-settings";
import { profilePrivacyKeys } from "@/lib/profile/privacy";
import { readLocalBoardInputs } from "@/lib/social/queries";
import { bearerSubject, signedIn, signedOut, type FakeAuthState } from "./social-test-auth";

const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
/** Used only by the tests that note a membership, which the module keeps for the day. */
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
jest.mock("@/lib/auth/store", () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock("@/lib/social/queries", () => ({ readLocalBoardInputs: jest.fn() }));
jest.mock("@/lib/database/sync", () => ({ hasCompletedAccountRestore: jest.fn() }));

const juzAmma: BoardInputs = { bands: { levelBand: "juz_amma", paceBand: "light", utcOffsetMinutes: 180 }, weekStart: 6 };
const hafiz: BoardInputs = { bands: { levelBand: "hafiz", paceBand: "light", utcOffsetMinutes: 180 }, weekStart: 6 };
const MORNING = new Date(2026, 10, 13, 8);
const EVENING = new Date(2026, 10, 13, 20);
const NEXT_DAY = new Date(2026, 10, 14, 8);

let joined = true;
function privacy(boardJoined: boolean) {
  return { board_joined: boardJoined, board_nickname: null, show_streak: false, show_juz_completions: false, is_minor: false };
}
const calls = (fn: string) => mockRpc.mock.calls.filter(([name]) => name === fn);
const sentBands = () => calls("refresh_board_bands").map(([, args]) => [args.p_level_band, args.p_today]);

beforeEach(() => {
  joined = true;
  mockRpc.mockReset().mockImplementation(async (fn) => ({ data: fn === "get_profile_privacy" ? privacy(joined) : null, error: null }));
  mockSettings.clear();
  Object.assign(mockAuth, signedIn(USER));
  jest.mocked(readLocalBoardInputs).mockReset().mockResolvedValue(juzAmma);
  jest.mocked(hasCompletedAccountRestore).mockReset().mockResolvedValue(true);
});

describe("board band refresh (8.13)", () => {
  it("reports the bands as the signed-in account and keeps what it sent on the device", async () => {
    await expect(refreshBoardBands(mockDb, USER, "en", MORNING)).resolves.toEqual({ status: "sent" });
    expect(mockRpc).toHaveBeenCalledWith("refresh_board_bands", {
      p_level_band: "juz_amma",
      p_pace_band: "light",
      p_utc_offset_minutes: 180,
      p_today: "2026-11-13",
      p_week_start: 6,
    });
    expect(bearerSubject(mockHeaders.Authorization)).toBe(USER);
    expect(isSyncableUserSetting(boardBandsSentKey(USER))).toBe(false);
  });

  it("sends again only when the bands change or on a new day", async () => {
    await refreshBoardBands(mockDb, USER, "en", MORNING);
    await expect(refreshBoardBands(mockDb, USER, "en", EVENING)).resolves.toEqual({ status: "unchanged" });
    jest.mocked(readLocalBoardInputs).mockResolvedValue(hafiz);
    await expect(refreshBoardBands(mockDb, USER, "en", EVENING)).resolves.toEqual({ status: "sent" });
    await expect(refreshBoardBands(mockDb, USER, "en", NEXT_DAY)).resolves.toEqual({ status: "sent" });
    expect(sentBands()).toEqual([
      ["juz_amma", "2026-11-13"],
      ["hafiz", "2026-11-13"],
      ["hafiz", "2026-11-14"],
    ]);
    // The account's board choice is read once a day, not on every refresh.
    expect(calls("get_profile_privacy")).toHaveLength(2);
  });

  it("does nothing signed out, and keeps no mark when the account changes during the report", async () => {
    Object.assign(mockAuth, signedOut());
    await expect(refreshBoardBands(mockDb, null, "en", MORNING)).resolves.toEqual({ status: "skipped" });
    await expect(refreshBoardBands(mockDb, USER, "en", MORNING)).resolves.toEqual({ status: "skipped" });
    expect(mockRpc).not.toHaveBeenCalled();

    Object.assign(mockAuth, signedIn(USER));
    mockRpc.mockImplementation(async (fn) => {
      if (fn === "refresh_board_bands") Object.assign(mockAuth, signedIn(OTHER));
      return { data: fn === "get_profile_privacy" ? privacy(true) : null, error: null };
    });
    await expect(refreshBoardBands(mockDb, USER, "en", MORNING)).rejects.toMatchObject({ failure: { kind: "account_changed" } });
    expect(mockSettings.has(boardBandsSentKey(USER))).toBe(false);
  });

  it("derives nothing until this account's restore has finished on the device", async () => {
    // B signed in, but the local plan and cards may still be A's until B's restore completes.
    Object.assign(mockAuth, signedIn(OTHER));
    jest.mocked(hasCompletedAccountRestore).mockResolvedValue(false);
    await expect(refreshBoardBands(mockDb, OTHER, "en", MORNING)).resolves.toEqual({ status: "restoring" });
    expect(hasCompletedAccountRestore).toHaveBeenCalledWith(mockDb, OTHER);
    expect(readLocalBoardInputs).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();

    jest.mocked(hasCompletedAccountRestore).mockResolvedValue(true);
    await expect(refreshBoardBands(mockDb, OTHER, "en", MORNING)).resolves.toEqual({ status: "sent" });
    expect(bearerSubject(mockHeaders.Authorization)).toBe(OTHER);
  });

  it("runs one more report when the inputs change while one is in flight", async () => {
    let release: () => void = () => {};
    mockRpc.mockImplementation(async (fn) => {
      if (fn === "refresh_board_bands" && calls("refresh_board_bands").length === 1) {
        await new Promise<void>((resolve) => (release = resolve));
      }
      return { data: fn === "get_profile_privacy" ? privacy(true) : null, error: null };
    });
    const first = refreshBoardBands(mockDb, USER, "en", MORNING);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls("refresh_board_bands")).toHaveLength(1);

    // A review lands while the first report waits for the server.
    jest.mocked(readLocalBoardInputs).mockResolvedValue(hafiz);
    const second = refreshBoardBands(mockDb, USER, "en", MORNING);
    const third = refreshBoardBands(mockDb, USER, "en", MORNING);
    release();
    await expect(Promise.all([first, second, third])).resolves.toEqual([{ status: "sent" }, { status: "sent" }, { status: "sent" }]);
    expect(sentBands()).toEqual([
      ["juz_amma", "2026-11-13"],
      ["hafiz", "2026-11-13"],
    ]);
  });

  it("computes nothing for an account off the board, checking again the next day", async () => {
    joined = false;
    await expect(refreshBoardBands(mockDb, USER, "en", MORNING)).resolves.toEqual({ status: "off_board" });
    await expect(refreshBoardBands(mockDb, USER, "en", EVENING)).resolves.toEqual({ status: "off_board" });
    expect(readLocalBoardInputs).not.toHaveBeenCalled();
    expect(calls("refresh_board_bands")).toHaveLength(0);
    expect(calls("get_profile_privacy")).toHaveLength(1);

    joined = true;
    await expect(refreshBoardBands(mockDb, USER, "en", NEXT_DAY)).resolves.toEqual({ status: "sent" });
    expect(calls("get_profile_privacy")).toHaveLength(2);
  });

  it("reports as before when the board choice cannot be read", async () => {
    mockRpc.mockImplementation(async (fn) =>
      fn === "get_profile_privacy" ? { data: null, error: { message: "unavailable", code: "XX000" } } : { data: null, error: null },
    );
    await expect(refreshBoardBands(mockDb, USER, "en", MORNING)).resolves.toEqual({ status: "sent" });
    await expect(refreshBoardBands(mockDb, USER, "en", EVENING)).resolves.toEqual({ status: "unchanged" });
    expect(calls("get_profile_privacy")).toHaveLength(1);
  });

  it("reports again the same day once the app sees the account join", async () => {
    Object.assign(mockAuth, signedIn(JOINER));
    joined = false;
    await expect(refreshBoardBands(mockDb, JOINER, "en", MORNING)).resolves.toEqual({ status: "off_board" });
    expect(noteBoardMembership(JOINER, true, MORNING)).toBe(true);
    expect(noteBoardMembership(JOINER, true, MORNING)).toBe(false);
    await expect(refreshBoardBands(mockDb, JOINER, "en", EVENING)).resolves.toEqual({ status: "sent" });
    expect(calls("get_profile_privacy")).toHaveLength(1);
    noteBoardMembership(JOINER, false, EVENING);
    await expect(refreshBoardBands(mockDb, JOINER, "en", EVENING)).resolves.toEqual({ status: "off_board" });
  });

  it("reads membership only from this account's own board and privacy results", () => {
    const view = (status: string, source = "network") => ({ data: { status }, savedAt: "2026-11-13T08:00:00Z", source });
    expect(membershipFromQuery(profilePrivacyKeys.mine(USER), { boardJoined: true }, USER)).toBe(true);
    expect(membershipFromQuery(profilePrivacyKeys.mine(OTHER), { boardJoined: true }, USER)).toBeNull();
    expect(membershipFromQuery([...boardKeys.all(USER), "2026-11-13", "online"], view("not_joined"), USER)).toBe(false);
    expect(membershipFromQuery([...boardKeys.all(USER), "2026-11-13", "online"], view("ready"), USER)).toBe(true);
    expect(membershipFromQuery([...boardKeys.all(USER), "2026-11-13", "offline"], view("ready", "cache"), USER)).toBeNull();
    expect(membershipFromQuery([...boardKeys.all(OTHER), "2026-11-13"], view("ready"), USER)).toBeNull();
    expect(membershipFromQuery(["boardInputs", USER], view("ready"), USER)).toBeNull();
  });
});
