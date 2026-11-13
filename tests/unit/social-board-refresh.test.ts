import type { BoardInputs } from "@/lib/board/api";
import { boardBandsSentKey, refreshBoardBands } from "@/lib/board/refresh";
import type { AppDatabase } from "@/lib/database/types";
import { isSyncableUserSetting } from "@/lib/database/user-settings";
import { readLocalBoardInputs } from "@/lib/social/queries";
import { bearerSubject, signedIn, signedOut, type FakeAuthState } from "./social-test-auth";

const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";

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

const juzAmma: BoardInputs = { bands: { levelBand: "juz_amma", paceBand: "light", utcOffsetMinutes: 180 }, weekStart: 6 };
const hafiz: BoardInputs = { bands: { levelBand: "hafiz", paceBand: "light", utcOffsetMinutes: 180 }, weekStart: 6 };
const MORNING = new Date(2026, 10, 13, 8);
const EVENING = new Date(2026, 10, 13, 20);
const NEXT_DAY = new Date(2026, 10, 14, 8);

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
  mockSettings.clear();
  Object.assign(mockAuth, signedIn(USER));
  jest.mocked(readLocalBoardInputs).mockReset().mockResolvedValue(juzAmma);
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
    expect(mockRpc.mock.calls.map(([, args]) => [args.p_level_band, args.p_today])).toEqual([
      ["juz_amma", "2026-11-13"],
      ["hafiz", "2026-11-13"],
      ["hafiz", "2026-11-14"],
    ]);
  });

  it("does nothing signed out, and keeps no mark when the account changes during the report", async () => {
    Object.assign(mockAuth, signedOut());
    await expect(refreshBoardBands(mockDb, null, "en", MORNING)).resolves.toEqual({ status: "skipped" });
    await expect(refreshBoardBands(mockDb, USER, "en", MORNING)).resolves.toEqual({ status: "skipped" });
    expect(mockRpc).not.toHaveBeenCalled();

    Object.assign(mockAuth, signedIn(USER));
    mockRpc.mockImplementationOnce(async () => {
      Object.assign(mockAuth, signedIn(OTHER));
      return { data: null, error: null };
    });
    await expect(refreshBoardBands(mockDb, USER, "en", MORNING)).rejects.toMatchObject({ failure: { kind: "account_changed" } });
    expect(mockSettings.has(boardBandsSentKey(USER))).toBe(false);
  });
});
