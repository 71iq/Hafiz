import AsyncStorage from "@react-native-async-storage/async-storage";
import { boardViewSchema, fetchBoard, joinBoard } from "@/lib/board/api";
import {
  fetchHalaqaDetail,
  fetchReceivedEncouragements,
  fetchTeacherView,
  halaqaDetailRead,
  halaqaKeys,
  joinHalaqaByCode,
  normalizeInviteCode,
  sendEncouragement,
  setHalaqaSharing,
} from "@/lib/halaqa/api";
import { DEFAULT_HIFZ_PLAN } from "@/lib/hifz/plan";
import { strings } from "@/lib/i18n/strings";
import { fetchProfileSummary, saveProfilePrivacy } from "@/lib/profile/privacy";
import { loadWithSocialCache } from "@/lib/social/cache";
import { encouragementText } from "@/lib/social/encouragements";
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
const mockStorageCalls: { op: "list" | "remove"; bucket: string; auth: string | undefined }[] = [];
let mockRemoveRefused = false;
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
          list: async (folder: string) => {
            mockStorageCalls.push({ op: "list", bucket, auth: headers.Authorization });
            const names = [...mockAvatarFiles].filter((path) => path.startsWith(`${folder}/`)).map((path) => path.slice(folder.length + 1));
            return { data: names.map((name) => ({ id: `id-${name}`, name })), error: null };
          },
          remove: async (paths: string[]) => {
            mockStorageCalls.push({ op: "remove", bucket, auth: headers.Authorization });
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
const GROUP = "00000000-0000-4000-8000-0000000000aa";

const summary = {
  id: GROUP,
  kind: "invite",
  name: "Family",
  invite_code: "ABCD2345",
  member_count: 2,
  role: "teacher",
  is_creator: true,
  share_consistency: true,
  share_juz: true,
  share_plan_with_teachers: false,
  share_grades_with_teachers: false,
};
const detailPayload = {
  group: summary,
  goal: { week_start: "2026-11-09", contributors: 2, target: 10, wird_days: 3 },
  encouraged_today: false,
  members: [
    {
      user_id: USER,
      name: "Teacher A",
      username: "teacher_a",
      avatar_url: null,
      role: "teacher",
      is_me: true,
      week: [true, true, false, false, false, false, false],
      streak: 4,
      juz_completions: 1,
      encouraged_today: false,
      teacher_view: false,
    },
    {
      user_id: OTHER,
      name: "Member B",
      username: "member_b",
      avatar_url: null,
      role: "member",
      is_me: false,
      week: null,
      streak: null,
      juz_completions: null,
      encouraged_today: true,
      teacher_view: true,
    },
  ],
  received: [{ id: GROUP, from_name: "Member B", template_id: "ease", body: null, created_at: "2026-11-13T08:00:00+00:00" }],
};

beforeEach(async () => {
  mockRpc.mockReset();
  for (const key of Object.keys(mockHeaders)) delete mockHeaders[key];
  mockConfigured = true;
  mockAvatarFiles.clear();
  mockStorageCalls.length = 0;
  mockRemoveRefused = false;
  signIn(signedIn(USER));
  await AsyncStorage.clear();
});

describe("halaqa adapter", () => {
  it("validates the group view and maps it to domain fields", async () => {
    mockRpc.mockResolvedValue({ data: detailPayload, error: null });
    const detail = await fetchHalaqaDetail(GROUP, "2026-11-13", owner());
    expect(mockRpc).toHaveBeenCalledWith("get_halaqa_detail", { p_group_id: GROUP, p_today: "2026-11-13" });
    expect(detail.goal).toEqual({ weekStart: "2026-11-09", contributors: 2, target: 10, wirdDays: 3 });
    expect(detail.members[1]).toMatchObject({ week: null, streak: null, canOpenTeacherView: true, encouragedToday: true });
    expect(detail.group.sharing).toEqual({
      consistency: true,
      juz: true,
      planWithTeachers: false,
      gradesWithTeachers: false,
    });
  });

  it("rejects a week that is not seven days instead of drawing wrong dots", async () => {
    mockRpc.mockResolvedValue({
      data: { ...detailPayload, members: [{ ...detailPayload.members[0], week: [true] }] },
      error: null,
    });
    await expect(fetchHalaqaDetail(GROUP, "2026-11-13", owner())).rejects.toMatchObject({
      failure: { kind: "invalid_response" },
    });
  });

  it("keeps server refusals as typed causes with their own messages", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "halaqa_full" } });
    const error = await joinHalaqaByCode(" abcd-2345 ", owner()).catch((caught: unknown) => caught);
    expect(mockRpc).toHaveBeenCalledWith("join_halaqa_by_code", { p_code: "ABCD2345" });
    expect(socialFailureOf(error)).toEqual({ kind: "rejected", code: "halaqa_full" });
    expect(socialFailureMessage(error, strings.ar)).toBe(strings.ar.socialErrorHalaqaFull);
  });

  it("sends a template or a trimmed note, never an empty body", async () => {
    mockRpc.mockResolvedValue({ data: { id: GROUP }, error: null });
    await sendEncouragement({ groupId: GROUP, toUserId: OTHER, templateId: "dua", body: "   ", today: "2026-11-13" }, owner());
    expect(mockRpc).toHaveBeenLastCalledWith("send_halaqa_encouragement", {
      p_group_id: GROUP,
      p_to_user: OTHER,
      p_template_id: "dua",
      p_body: null,
      p_today: "2026-11-13",
    });
  });

  it("reports a missing account service without calling the server", async () => {
    mockConfigured = false;
    await expect(fetchHalaqaDetail(GROUP, "2026-11-13", owner())).rejects.toMatchObject({
      failure: { kind: "unconfigured" },
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("keys every remote halaqa read by the viewer", () => {
    expect(halaqaKeys.detail(USER, GROUP, "2026-11-13")).toContain(USER);
    expect(halaqaKeys.detail(OTHER, GROUP, "2026-11-13")).not.toEqual(halaqaKeys.detail(USER, GROUP, "2026-11-13"));
  });

  it("normalizes pasted invite codes", () => {
    expect(normalizeInviteCode("abcd 2345")).toBe("ABCD2345");
  });
});

describe("encouragement templates (SOC-06, MAT-01)", () => {
  it("renders each template in the reader's language and a generic line for unknown ones", () => {
    expect(encouragementText("ease", strings.en)).toBe(strings.en.halaqaEncourageEase);
    expect(encouragementText("ease", strings.ar)).toBe(strings.ar.halaqaEncourageEase);
    expect(encouragementText("future_template", strings.en)).toBe(strings.en.halaqaEncourageGeneric);
  });

  it("never claims reward or uses guilt words", () => {
    const keys = Object.keys(strings.en).filter((key) => key.startsWith("halaqaEncourage"));
    expect(keys.length).toBeGreaterThanOrEqual(9);
    for (const key of keys) {
      const text = strings.en[key as keyof typeof strings.en];
      expect(text).not.toMatch(/hasanat|reward|sin|shame|disappoint|should have|lost|failed/i);
    }
  });
});

describe("board adapter", () => {
  const inputs = { bands: { levelBand: "juz_amma", paceBand: "light", utcOffsetMinutes: 180 }, weekStart: 6 } as const;

  it("parses each board state and never exposes user ids", async () => {
    mockRpc.mockResolvedValue({
      data: {
        status: "ready",
        week_start: "2026-11-09",
        member_count: 5,
        min_members: 5,
        standings: [
          { rank: 1, name: "Little Star", uses_nickname: true, avatar_url: null, points: 3, streak: 4, is_me: false },
        ],
      },
      error: null,
    });
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
    await joinBoard({ nickname: "Little Star", isMinor: true, inputs, today: "2026-11-13" }, owner());
    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe("join_board");
    expect(args).toMatchObject({ p_nickname: "Little Star", p_is_minor: true, p_level_band: "juz_amma", p_week_start: 6 });
    expect(Object.keys(args).some((key) => /score|point|cohort/.test(key))).toBe(false);
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
    data: { board_joined: false, board_nickname: null, show_streak: false, show_juz_completions: false, is_minor: isMinor },
    error: null,
  });

  it("deletes the account's own photo files once it is saved as a minor, as that account", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`).add(`${USER}/2.png`).add(`${OTHER}/3.jpg`);
    mockRpc.mockResolvedValue(privacy(true));
    await saveProfilePrivacy({ showStreak: false, showJuzCompletions: false, isMinor: true }, owner());
    expect([...mockAvatarFiles]).toEqual([`${OTHER}/3.jpg`]);
    expect(mockStorageCalls.map((call) => call.op)).toEqual(["list", "remove", "list"]);
    expect(mockStorageCalls.every((call) => call.bucket === "avatars" && bearerSubject(call.auth) === USER)).toBe(true);
  });

  it("leaves an adult's photos alone", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`);
    mockRpc.mockResolvedValue(privacy(false));
    await saveProfilePrivacy({ showStreak: true, showJuzCompletions: false, isMinor: false }, owner());
    expect(mockStorageCalls).toEqual([]);
  });

  it("deletes them after joining the board as a minor", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`);
    mockRpc.mockResolvedValue({ data: { status: "gathering", week_start: "2026-11-09", member_count: 1, min_members: 5 }, error: null });
    const inputs = { bands: { levelBand: "juz_amma", paceBand: "light", utcOffsetMinutes: 180 }, weekStart: 6 } as const;
    await joinBoard({ nickname: "Little Star", isMinor: true, inputs, today: "2026-11-13" }, owner());
    expect(mockAvatarFiles.size).toBe(0);
  });

  it("fails the save when a photo could not be deleted, so it can be retried", async () => {
    mockAvatarFiles.add(`${USER}/1.jpg`);
    mockRemoveRefused = true;
    mockRpc.mockResolvedValue(privacy(true));
    await expect(
      saveProfilePrivacy({ showStreak: false, showJuzCompletions: false, isMinor: true }, owner()),
    ).rejects.toMatchObject({ failure: { kind: "failed" } });
  });
});

describe("offline copy (SB-01)", () => {
  const read = halaqaDetailRead(GROUP, "2026-11-13");

  it("shows the last state with its date when offline, and keeps it per account", async () => {
    mockRpc.mockResolvedValue({ data: detailPayload, error: null });
    const fresh = await loadWithSocialCache({
      userId: USER,
      name: "detail",
      read,
      offline: false,
      now: () => new Date("2026-11-13T08:00:00.000Z"),
    });
    expect(fresh.source).toBe("network");

    mockRpc.mockReset();
    const cached = await loadWithSocialCache({ userId: USER, name: "detail", read, offline: true });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(cached).toMatchObject({ source: "cache", savedAt: "2026-11-13T08:00:00.000Z" });
    expect(cached.data.members).toHaveLength(2);

    signIn(signedIn(OTHER));
    await expect(loadWithSocialCache({ userId: OTHER, name: "detail", read, offline: true })).rejects.toMatchObject({
      failure: { kind: "offline" },
    });
  });

  it("falls back to the copy when the request cannot reach the server", async () => {
    mockRpc.mockResolvedValueOnce({ data: detailPayload, error: null });
    await loadWithSocialCache({ userId: USER, name: "detail", read, offline: false });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "TypeError: Network request failed" } });
    await expect(loadWithSocialCache({ userId: USER, name: "detail", read, offline: false })).resolves.toMatchObject({
      source: "cache",
    });
  });

  it("never hides a server refusal behind an old copy", async () => {
    mockRpc.mockResolvedValueOnce({ data: detailPayload, error: null });
    await loadWithSocialCache({ userId: USER, name: "detail", read, offline: false });
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not_a_member" } });
    await expect(loadWithSocialCache({ userId: USER, name: "detail", read, offline: false })).rejects.toMatchObject({
      failure: { kind: "rejected", code: "not_a_member" },
    });
  });

  it("ignores a stored copy that no longer passes validation", async () => {
    await AsyncStorage.setItem(
      `hafiz_social_cache_v1:${USER}:detail`,
      JSON.stringify({ savedAt: "2026-11-13T08:00:00.000Z", payload: { group: "broken" } }),
    );
    await expect(loadWithSocialCache({ userId: USER, name: "detail", read, offline: true })).rejects.toMatchObject({
      failure: { kind: "offline" },
    });
  });
});

describe("remote error causes", () => {
  it("separates offline, refusal and other failures", () => {
    expect(classifyRemoteError(new TypeError("Failed to fetch"))).toEqual({ kind: "offline" });
    expect(classifyRemoteError({ message: "invalid_code" })).toEqual({ kind: "rejected", code: "invalid_code" });
    expect(classifyRemoteError({ message: "duplicate key" })).toEqual({ kind: "failed", message: "duplicate key" });
  });

});

describe("account binding (requests belong to the account that started them)", () => {
  const read = halaqaDetailRead(GROUP, "2026-11-13");

  it("sends the owner's own token, not whatever the shared client would attach", async () => {
    mockRpc.mockResolvedValue({ data: detailPayload, error: null });
    await fetchHalaqaDetail(GROUP, "2026-11-13", owner());
    expect(bearerSubject(mockHeaders.Authorization)).toBe(USER);
  });

  it("refuses to start when the client's session already belongs to another account", async () => {
    const captured = owner();
    mockClientSession = signedIn(OTHER).session;
    await expect(fetchHalaqaDetail(GROUP, "2026-11-13", captured)).rejects.toMatchObject({
      failure: { kind: "account_changed" },
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("never caches or returns a response that arrives after the account changed", async () => {
    let respond: (value: { data: unknown; error: unknown }) => void = () => undefined;
    mockRpc.mockReturnValue(new Promise((resolve) => (respond = resolve)));
    const load = loadWithSocialCache({ userId: USER, name: "detail", read, offline: false });
    await waitForRpc();
    signIn(signedIn(OTHER));
    respond({ data: detailPayload, error: null });
    await expect(load).rejects.toMatchObject({ failure: { kind: "account_changed" } });
    expect(await AsyncStorage.getItem(`hafiz_social_cache_v1:${USER}:detail`)).toBeNull();
    expect(await AsyncStorage.getItem(`hafiz_social_cache_v1:${OTHER}:detail`)).toBeNull();
  });

  it("treats a new sign-in of the same account as a different owner", async () => {
    const captured = owner();
    signIn(signedIn(USER, "00000000-0000-4000-9000-000000000002"));
    expect(captured.isCurrent()).toBe(false);
  });

  it("does not load for an account that is not signed in, even from its offline copy", async () => {
    signIn(signedOut());
    await expect(loadWithSocialCache({ userId: USER, name: "detail", read, offline: true })).rejects.toMatchObject({
      failure: { kind: "account_changed" },
    });
    expect(captureSocialOwner(USER)).toBeNull();
  });

  it("stops a two-step save before its second write once the account changed", async () => {
    mockRpc.mockImplementation(async (fn) => {
      // The account switches while the first write is in flight.
      if (fn === "set_halaqa_sharing") signIn(signedIn(OTHER));
      return { data: { ...detailPayload.group }, error: null };
    });
    const captured = owner();
    const sharing = { consistency: true, juz: true, planWithTeachers: false, gradesWithTeachers: false };
    await expect(setHalaqaSharing(GROUP, sharing, captured)).rejects.toMatchObject({
      failure: { kind: "account_changed" },
    });
    const second = await saveProfilePrivacy({ showStreak: true, showJuzCompletions: true, isMinor: false }, captured).catch(
      (caught: unknown) => caught,
    );
    expect(socialFailureOf(second)).toEqual({ kind: "account_changed" });
    expect(socialFailureMessage(second, strings.en)).toBe(strings.en.socialErrorAccountChanged);
    expect(mockRpc.mock.calls.map(([fn]) => fn)).toEqual(["set_halaqa_sharing"]);
  });
});

describe("teacher view plan (SOC-03)", () => {
  it("reads the member's plan with the app's plan schema", async () => {
    mockRpc.mockResolvedValue({
      data: { name: "Member B", plan: { hifz_plan: JSON.stringify(DEFAULT_HIFZ_PLAN), tiers: { sabqi: 3 } }, grades: null },
      error: null,
    });
    const view = await fetchTeacherView(GROUP, OTHER, "2026-11-13", owner());
    expect(view.plan?.hifzPlan).toMatchObject({ newPerDay: 0.5, cycleDays: 30 });
    expect(view.plan?.tiers).toEqual({ sabqi: 3 });
  });

  it("shows no plan for a missing or unreadable one", async () => {
    mockRpc.mockResolvedValue({ data: { name: null, plan: { hifz_plan: "not json", tiers: {} }, grades: null }, error: null });
    await expect(fetchTeacherView(GROUP, OTHER, "2026-11-13", owner())).resolves.toMatchObject({ plan: { hifzPlan: null } });
  });
});

describe("received encouragements (5.8.2)", () => {
  it("lists ids with the server's time, for the device to acknowledge", async () => {
    mockRpc.mockResolvedValue({
      data: { items: [{ id: GROUP, created_at: "2026-11-13T08:00:00.123456+00:00" }], checked_at: "2026-11-13T09:00:00+00:00" },
      error: null,
    });
    const result = await fetchReceivedEncouragements(owner());
    expect(mockRpc).toHaveBeenCalledWith("get_received_encouragements", {});
    expect(result).toEqual({
      items: [{ id: GROUP, createdAt: "2026-11-13T08:00:00.123456+00:00" }],
      checkedAt: "2026-11-13T09:00:00+00:00",
    });
  });
});

async function waitForRpc() {
  for (let i = 0; i < 20 && mockRpc.mock.calls.length === 0; i += 1) await Promise.resolve();
  expect(mockRpc).toHaveBeenCalled();
}
