import AsyncStorage from "@react-native-async-storage/async-storage";
import { boardRead, boardViewSchema, fetchBoard, joinBoard } from "@/lib/board/api";
import { strings } from "@/lib/i18n/strings";
import {
  deleteOwnAvatarFiles,
  fetchProfileSummary,
  leaveLegacyHalaqas,
  ProfilePrivacyChangedError,
  saveProfilePrivacy,
} from "@/lib/profile/privacy";
import { loadWithSocialCache } from "@/lib/social/cache";
import { socialFailureMessage } from "@/lib/social/messages";
import { captureSocialOwner, requireSocialOwner } from "@/lib/social/owner";
import { classifyRemoteError, socialFailureOf } from "@/lib/social/remote";
import { bearerSubject, signedIn, signedOut, type FakeAuthState } from "./social-test-auth";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockRpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string, Record<string, unknown>]>();
const mockHeaders: Record<string, string> = {};
let mockConfigured = true;
// The avatars bucket: stored paths, and every list or remove call with the bearer it was sent with.
const mockAvatarFiles = new Set<string>();
const mockStorageCalls: { op: "list" | "remove"; bucket: string; auth: string | undefined; folder?: string }[] = [];
let mockRemoveRefused = false;
let mockOnRemove: () => void = () => undefined;
// The store and the shared client's session are separate, as in the app: a switch can reach one first.
let mockAuth: FakeAuthState;
let mockClientSession: FakeAuthState["session"];
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabaseAnonKey: () => "synthetic-public-key",
  supabase: {
    supabaseKey: "synthetic-public-key",
    rpc: (fn: string, args: Record<string, unknown>) =>
      require("./social-test-auth").rpcBuilder(mockRpc(fn, args), mockHeaders),
    auth: { getSession: async () => ({ data: { session: mockClientSession }, error: null }) },
    storage: {
      from: (bucket: string) => {
        const headers: Record<string, string> = {};
        const files = {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
            return files;
          },
          // As Storage lists: the folder's own files with ids, nested folders once each with a null id,
          // by name, a page at a time.
          list: async (folder: string, options: { limit: number; offset?: number }) => {
            mockStorageCalls.push({ op: "list", bucket, auth: headers.Authorization, folder });
            const entries = new Map<string, string | null>();
            for (const path of mockAvatarFiles) {
              if (!path.startsWith(`${folder}/`)) continue;
              const [name, ...rest] = path.slice(folder.length + 1).split("/");
              entries.set(name, rest.length > 0 ? null : `id-${path}`);
            }
            const page = [...entries].sort(([a], [b]) => a.localeCompare(b)).slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
            return { data: page.map(([name, id]) => ({ id, name })), error: null };
          },
          remove: async (paths: string[]) => {
            mockStorageCalls.push({ op: "remove", bucket, auth: headers.Authorization });
            mockOnRemove();
            if (mockRemoveRefused) return { data: [], error: null };
            for (const path of paths) mockAvatarFiles.delete(path);
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
        return files;
      },
    },
  },
}));
jest.mock("@/lib/auth/store", () => ({ useAuthStore: { getState: () => mockAuth } }));

const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";

function signIn(state: FakeAuthState) {
  mockAuth = state;
  mockClientSession = state.session;
}
const owner = () => requireSocialOwner(USER);

const boardInputs = { bands: { levelBand: "juz_amma", paceBand: "light", utcOffsetMinutes: 180 }, weekStart: 6 } as const;
const readyBoard = {
  status: "ready",
  week_start: "2026-11-09",
  member_count: 5,
  min_members: 5,
  standings: [
    { rank: 1, name: "Little Star", uses_nickname: true, avatar_url: null, points: 3, streak: 4, is_me: false },
    { rank: 2, name: "Member B", uses_nickname: false, avatar_url: null, points: 2, streak: 1, is_me: true },
  ],
};


beforeEach(async () => {
  mockRpc.mockReset();
  for (const key of Object.keys(mockHeaders)) delete mockHeaders[key];
  mockConfigured = true;
  mockAvatarFiles.clear();
  mockStorageCalls.length = 0;
  mockRemoveRefused = false;
  mockOnRemove = () => undefined;
  signIn(signedIn(USER));
  await AsyncStorage.clear();
});

describe("board adapter", () => {
  const inputs = boardInputs;

  it("parses each board state and never exposes user ids", async () => {
    mockRpc.mockResolvedValue({ data: { ...readyBoard, standings: readyBoard.standings.slice(0, 1) }, error: null });
    const view = await fetchBoard(inputs, "2026-11-13", owner());
    expect(mockRpc).toHaveBeenCalledWith("get_board", {
      p_level_band: "juz_amma",
      p_pace_band: "light",
      p_utc_offset_minutes: 180,
      p_today: "2026-11-13",
      p_week_start: 6,
    });
    expect(view).toEqual({
      status: "ready",
      weekStart: "2026-11-09",
      memberCount: 5,
      minMembers: 5,
      standings: [{ rank: 1, name: "Little Star", usesNickname: true, avatarUrl: null, points: 3, streak: 4, isMe: false }],
    });
    expect(boardViewSchema.safeParse({ status: "gathering", week_start: "2026-11-09", member_count: 2, min_members: 5 }).success).toBe(true);
    expect(boardViewSchema.safeParse({ status: "ready", week_start: "2026-11-09" }).success).toBe(false);
  });

  it("sends the minor flag and nickname with the bands; the server computes every score", async () => {
    mockRpc.mockResolvedValue({ data: { status: "gathering", week_start: "2026-11-09", member_count: 1, min_members: 5 }, error: null });
    await joinBoard({ nickname: "Little Star", isMinor: true, expectedMinor: false, inputs, today: "2026-11-13" }, owner());
    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe("join_board");
    expect(args).toMatchObject({
      p_nickname: "Little Star",
      p_is_minor: true,
      p_expected_minor: false,
      p_level_band: "juz_amma",
      p_week_start: 6,
    });
    expect(Object.keys(args).some((key) => /score|point|cohort/.test(key))).toBe(false);
  });

  it("reports a join refused for a changed age setting as its own error (ETH-07)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "privacy_changed", code: "P0001" } });
    await expect(
      joinBoard({ nickname: null, isMinor: false, expectedMinor: false, inputs, today: "2026-11-13" }, owner()),
    ).rejects.toBeInstanceOf(ProfilePrivacyChangedError);
  });
});

describe("profile summary (SOC-01)", () => {
  it("keeps hidden fields hidden, as the signed-in viewer", async () => {
    mockRpc.mockResolvedValue({ data: { streak: null, juz_completed: [30] }, error: null });
    await expect(fetchProfileSummary(OTHER, USER)).resolves.toEqual({ streak: null, juzCompleted: [30] });
    expect(bearerSubject(mockHeaders.Authorization)).toBe(USER);
  });

  it("runs a signed-out request with the public key, not a session the client picked up", async () => {
    signIn(signedOut());
    // The shared client already holds a sign-in the store has not seen yet.
    mockClientSession = signedIn(USER).session;
    mockRpc.mockResolvedValue({ data: { streak: 3, juz_completed: null }, error: null });
    await expect(fetchProfileSummary(OTHER)).resolves.toEqual({ streak: 3, juzCompleted: null });
    expect(mockHeaders.Authorization).toBe("Bearer synthetic-public-key");
  });

  it("refuses a signed-out answer that arrives after a sign-in", async () => {
    signIn(signedOut());
    let respond: (value: { data: unknown; error: unknown }) => void = () => undefined;
    mockRpc.mockReturnValue(new Promise((resolve) => (respond = resolve)));
    const load = fetchProfileSummary(OTHER);
    await waitForRpc();
    signIn(signedIn(USER));
    respond({ data: { streak: 9, juz_completed: [1] }, error: null });
    await expect(load).rejects.toMatchObject({ failure: { kind: "account_changed" } });
  });

  it("does not start a signed-out request while an account is signed in", async () => {
    await expect(fetchProfileSummary(OTHER)).rejects.toMatchObject({ failure: { kind: "account_changed" } });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("a minor's photo (ETH-07)", () => {
  const privacy = (isMinor: boolean) => ({
    data: { board_joined: false, board_nickname: null, show_streak: false, show_juz_completions: false, is_minor: isMinor, left_board: false },
    error: null,
  });

  it("deletes the account's own photo files before it records minority, as that account", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`).add(`${USER}/2.png`).add(`${OTHER}/3.jpg`);
    mockRpc.mockImplementation(async () => {
      // By the time minority is recorded, nothing is left to publish.
      expect([...mockAvatarFiles]).toEqual([`${OTHER}/3.jpg`]);
      return privacy(true);
    });
    await saveProfilePrivacy({ showStreak: false, showJuzCompletions: false, isMinor: true, expectedMinor: false }, owner());
    expect([...mockAvatarFiles]).toEqual([`${OTHER}/3.jpg`]);
    // The pass before the save, and the one after it, which finds nothing left with one request.
    expect(mockStorageCalls.map((call) => call.op)).toEqual(["list", "remove", "list"]);
    expect(mockStorageCalls.every((call) => call.bucket === "avatars" && bearerSubject(call.auth) === USER)).toBe(true);
  });

  it("does not record minority when a photo could not be deleted, so the save can be retried", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`);
    mockRemoveRefused = true;
    mockRpc.mockResolvedValue(privacy(true));
    await expect(
      saveProfilePrivacy({ showStreak: false, showJuzCompletions: false, isMinor: true, expectedMinor: false }, owner()),
    ).rejects.toMatchObject({ failure: { kind: "failed" } });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("removes a photo uploaded while minority was being recorded, once it is recorded", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`);
    mockRpc.mockImplementation(async () => {
      // Another device uploads before the server starts refusing this account's uploads.
      mockAvatarFiles.add(`${USER}/from-another-device.jpg`);
      return privacy(true);
    });
    await saveProfilePrivacy({ showStreak: false, showJuzCompletions: false, isMinor: true, expectedMinor: false }, owner());
    expect([...mockAvatarFiles]).toEqual([]);
  });

  it("keeps a recorded save when the pass after it fails", async () => {
    mockRpc.mockImplementation(async () => {
      mockAvatarFiles.add(`${USER}/from-another-device.jpg`);
      mockRemoveRefused = true;
      return privacy(true);
    });
    await expect(
      saveProfilePrivacy({ showStreak: false, showJuzCompletions: false, isMinor: true, expectedMinor: false }, owner()),
    ).resolves.toMatchObject({ isMinor: true });
  });

  it("leaves an adult's photos alone and turns profile visibility off as asked", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`);
    mockRpc.mockResolvedValue(privacy(false));
    await saveProfilePrivacy({ showStreak: false, showJuzCompletions: false, isMinor: false, expectedMinor: false }, owner());
    expect(mockStorageCalls).toEqual([]);
    expect(mockRpc).toHaveBeenCalledWith("set_profile_privacy", {
      p_show_streak: false,
      p_show_juz_completions: false,
      p_is_minor: false,
      p_expected_minor: false,
    });
    expect(bearerSubject(mockHeaders.Authorization)).toBe(USER);
  });

  it("sends the minority the form loaded and reports a refusal for a changed setting as its own error", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`);
    mockRpc.mockResolvedValue({ data: null, error: { message: "privacy_changed", code: "P0001" } });
    // The form still shows a minor, but another device withdrew it: the adult's photo is not deleted.
    await expect(
      saveProfilePrivacy({ showStreak: false, showJuzCompletions: false, isMinor: true, expectedMinor: true }, owner()),
    ).rejects.toBeInstanceOf(ProfilePrivacyChangedError);
    expect([...mockAvatarFiles]).toEqual([`${USER}/1.jpg`]);
  });

  it("says when recording minority took the account off the Board (BRD-07)", async () => {
    mockRpc.mockResolvedValue({ data: { ...privacy(true).data, board_joined: false, left_board: true }, error: null });
    await expect(
      saveProfilePrivacy({ showStreak: false, showJuzCompletions: false, isMinor: true, expectedMinor: false }, owner()),
    ).resolves.toMatchObject({ isMinor: true, boardJoined: false, leftBoard: true });
  });

  it("deletes photos in nested folders too", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`).add(`${USER}/old/2.jpg`).add(`${USER}/old/deeper/3.png`).add(`${OTHER}/old/4.jpg`);
    await expect(deleteOwnAvatarFiles(owner())).resolves.toBe(3);
    expect([...mockAvatarFiles]).toEqual([`${OTHER}/old/4.jpg`]);
    expect(mockStorageCalls.filter((call) => call.op === "list").map((call) => call.folder)).toEqual([
      USER,
      `${USER}/old`,
      `${USER}/old/deeper`,
    ]);
  });

  it("deletes more files than one listing page", async () => {
    for (let i = 0; i < 150; i += 1) mockAvatarFiles.add(`${USER}/${String(i).padStart(3, "0")}.jpg`);
    await expect(deleteOwnAvatarFiles(owner())).resolves.toBe(150);
    expect(mockAvatarFiles.size).toBe(0);
    expect(mockStorageCalls.map((call) => call.op)).toEqual(["list", "list", "remove", "remove"]);
  });

  it("costs one list request when nothing is stored", async () => {
    await expect(deleteOwnAvatarFiles(owner())).resolves.toBe(0);
    expect(mockStorageCalls.map((call) => call.op)).toEqual(["list"]);
  });

  it("stops before deleting once the account changed", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`);
    const listing = deleteOwnAvatarFiles(owner());
    signIn(signedIn(OTHER));
    await expect(listing).rejects.toMatchObject({ failure: { kind: "account_changed" } });
    expect(mockAvatarFiles.has(`${USER}/1.jpg`)).toBe(true);
    expect(mockStorageCalls.some((call) => call.op === "remove")).toBe(false);
  });

  const gathering = { data: { status: "gathering", week_start: "2026-11-09", member_count: 1, min_members: 5 }, error: null };
  const inputs = boardInputs;

  it("deletes them before joining the board as a minor, and once more after", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`);
    mockRpc.mockImplementation(async (fn: string) => {
      // The pass after joining reads the account's privacy before it deletes what it found.
      if (fn === "get_profile_privacy") return privacy(true);
      expect(mockAvatarFiles.size).toBe(0);
      mockAvatarFiles.add(`${USER}/from-another-device.jpg`);
      return gathering;
    });
    await joinBoard({ nickname: "Little Star", isMinor: true, expectedMinor: false, inputs, today: "2026-11-13" }, owner());
    expect(mockAvatarFiles.size).toBe(0);
  });

  it("keeps a photo uploaded as an adult on another device since the join recorded minority", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`);
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === "get_profile_privacy") return privacy(false);
      // Meanwhile another device withdrew minority and uploaded a photo.
      mockAvatarFiles.add(`${USER}/adult-elsewhere.jpg`);
      return gathering;
    });
    await joinBoard({ nickname: "Little Star", isMinor: true, expectedMinor: false, inputs, today: "2026-11-13" }, owner());
    expect([...mockAvatarFiles]).toEqual([`${USER}/adult-elsewhere.jpg`]);
  });

  it("does not join the board as a minor when a photo could not be deleted", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`);
    mockRemoveRefused = true;
    mockRpc.mockResolvedValue(gathering);
    await expect(
      joinBoard({ nickname: "Little Star", isMinor: true, expectedMinor: false, inputs, today: "2026-11-13" }, owner()),
    ).rejects.toMatchObject({ failure: { kind: "failed" } });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("halaqas from an earlier version (SET-20)", () => {
  const A = "00000000-0000-4000-8000-0000000000a1";
  const B = "00000000-0000-4000-8000-0000000000b2";
  const groups = (ids: string[]) => ({ data: ids.map((id) => ({ id, kind: "invite", name: "Group" })), error: null });

  it("leaves every halaqa the account is still in, as that account", async () => {
    mockRpc.mockImplementation(async (fn) => (fn === "get_my_halaqas" ? groups([A, B]) : { data: null, error: null }));
    await expect(leaveLegacyHalaqas(owner())).resolves.toBe(2);
    expect(mockRpc.mock.calls).toEqual([
      ["get_my_halaqas", {}],
      ["leave_halaqa", { p_group_id: A }],
      ["leave_halaqa", { p_group_id: B }],
    ]);
    expect(bearerSubject(mockHeaders.Authorization)).toBe(USER);
  });

  it("skips a halaqa already left on another device and keeps going", async () => {
    mockRpc.mockImplementation(async (fn, args) => {
      if (fn === "get_my_halaqas") return groups([A, B]);
      return args.p_group_id === A ? { data: null, error: { message: "not_a_member", code: "42501" } } : { data: null, error: null };
    });
    await expect(leaveLegacyHalaqas(owner())).resolves.toBe(2);
    expect(mockRpc.mock.calls.map(([, args]) => args.p_group_id)).toEqual([undefined, A, B]);
  });

  it("stops at any other failure so the person can try again", async () => {
    mockRpc.mockImplementation(async (fn) =>
      fn === "get_my_halaqas" ? groups([A, B]) : { data: null, error: { message: "Failed to fetch" } },
    );
    await expect(leaveLegacyHalaqas(owner())).rejects.toMatchObject({ failure: { kind: "offline" } });
    expect(mockRpc.mock.calls.filter(([fn]) => fn === "leave_halaqa")).toHaveLength(1);
  });

  it("does nothing more when the account is in no halaqa", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(leaveLegacyHalaqas(owner())).resolves.toBe(0);
    expect(mockRpc.mock.calls.map(([fn]) => fn)).toEqual(["get_my_halaqas"]);
  });
});

describe("offline copy (SB-01)", () => {
  const read = boardRead(boardInputs, "2026-11-13");

  it("shows the last state with its date when offline, and keeps it per account", async () => {
    mockRpc.mockResolvedValue({ data: readyBoard, error: null });
    const fresh = await loadWithSocialCache({
      userId: USER,
      name: "board",
      read,
      offline: false,
      now: () => new Date("2026-11-13T08:00:00.000Z"),
    });
    expect(fresh.source).toBe("network");

    mockRpc.mockReset();
    const cached = await loadWithSocialCache({ userId: USER, name: "board", read, offline: true });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(cached).toMatchObject({ source: "cache", savedAt: "2026-11-13T08:00:00.000Z" });
    expect(cached.data).toMatchObject({ status: "ready", standings: [{ rank: 1 }, { rank: 2 }] });

    signIn(signedIn(OTHER));
    await expect(loadWithSocialCache({ userId: OTHER, name: "board", read, offline: true })).rejects.toMatchObject({
      failure: { kind: "offline" },
    });
  });

  it("falls back to the copy when the request cannot reach the server", async () => {
    mockRpc.mockResolvedValueOnce({ data: readyBoard, error: null });
    await loadWithSocialCache({ userId: USER, name: "board", read, offline: false });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "TypeError: Network request failed" } });
    await expect(loadWithSocialCache({ userId: USER, name: "board", read, offline: false })).resolves.toMatchObject({
      source: "cache",
    });
  });

  it("never hides a server refusal behind an old copy", async () => {
    mockRpc.mockResolvedValueOnce({ data: readyBoard, error: null });
    await loadWithSocialCache({ userId: USER, name: "board", read, offline: false });
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "invalid_bands" } });
    await expect(loadWithSocialCache({ userId: USER, name: "board", read, offline: false })).rejects.toMatchObject({
      failure: { kind: "rejected", code: "invalid_bands" },
    });
  });

  it("ignores a stored copy that no longer passes validation", async () => {
    await AsyncStorage.setItem(
      `hafiz_social_cache_v1:${USER}:board`,
      JSON.stringify({ savedAt: "2026-11-13T08:00:00.000Z", payload: { status: "broken" } }),
    );
    await expect(loadWithSocialCache({ userId: USER, name: "board", read, offline: true })).rejects.toMatchObject({
      failure: { kind: "offline" },
    });
  });
});

describe("remote error causes", () => {
  it("separates offline, refusal and other failures", () => {
    expect(classifyRemoteError(new TypeError("Failed to fetch"))).toEqual({ kind: "offline" });
    expect(classifyRemoteError({ message: "invalid_nickname" })).toEqual({ kind: "rejected", code: "invalid_nickname" });
    expect(classifyRemoteError({ message: "duplicate key" })).toEqual({ kind: "failed", message: "duplicate key" });
  });

  it("shows a Board refusal by its cause, in the reader's language", () => {
    const error = { code: "P0001", message: "nickname_required" };
    expect(socialFailureOf(error)).toEqual({ kind: "rejected", code: "nickname_required" });
    expect(socialFailureMessage(error, strings.ar)).toBe(strings.ar.socialErrorNicknameRequired);
    expect(socialFailureMessage({ message: "upstream exploded" }, strings.en)).toBe(strings.en.socialErrorGeneric);
  });
});

describe("account binding (requests belong to the account that started them)", () => {
  const read = boardRead(boardInputs, "2026-11-13");

  it("sends the owner's own token, not whatever the shared client would attach", async () => {
    mockRpc.mockResolvedValue({ data: readyBoard, error: null });
    await fetchBoard(boardInputs, "2026-11-13", owner());
    expect(bearerSubject(mockHeaders.Authorization)).toBe(USER);
  });

  it("refuses to start when the client's session already belongs to another account", async () => {
    const captured = owner();
    mockClientSession = signedIn(OTHER).session;
    await expect(fetchBoard(boardInputs, "2026-11-13", captured)).rejects.toMatchObject({
      failure: { kind: "account_changed" },
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("never caches or returns a response that arrives after the account changed", async () => {
    let respond: (value: { data: unknown; error: unknown }) => void = () => undefined;
    mockRpc.mockReturnValue(new Promise((resolve) => (respond = resolve)));
    const load = loadWithSocialCache({ userId: USER, name: "board", read, offline: false });
    await waitForRpc();
    signIn(signedIn(OTHER));
    respond({ data: readyBoard, error: null });
    await expect(load).rejects.toMatchObject({ failure: { kind: "account_changed" } });
    expect(await AsyncStorage.getItem(`hafiz_social_cache_v1:${USER}:board`)).toBeNull();
    expect(await AsyncStorage.getItem(`hafiz_social_cache_v1:${OTHER}:board`)).toBeNull();
  });

  it("treats a new sign-in of the same account as a different owner", async () => {
    const captured = owner();
    signIn(signedIn(USER, "00000000-0000-4000-9000-000000000002"));
    expect(captured.isCurrent()).toBe(false);
  });

  it("does not load for an account that is not signed in, even from its offline copy", async () => {
    signIn(signedOut());
    await expect(loadWithSocialCache({ userId: USER, name: "board", read, offline: true })).rejects.toMatchObject({
      failure: { kind: "account_changed" },
    });
    expect(captureSocialOwner(USER)).toBeNull();
  });
});

async function waitForRpc() {
  for (let i = 0; i < 20 && mockRpc.mock.calls.length === 0; i += 1) await Promise.resolve();
  expect(mockRpc).toHaveBeenCalled();
}
