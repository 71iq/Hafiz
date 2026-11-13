import AsyncStorage from "@react-native-async-storage/async-storage";
import { boardViewSchema, fetchBoard, joinBoard } from "@/lib/board/api";
import {
  fetchHalaqaDetail,
  halaqaDetailRead,
  halaqaKeys,
  joinHalaqaByCode,
  normalizeInviteCode,
  sendEncouragement,
} from "@/lib/halaqa/api";
import { strings } from "@/lib/i18n/strings";
import { fetchProfileSummary } from "@/lib/profile/privacy";
import { loadWithSocialCache } from "@/lib/social/cache";
import { encouragementText } from "@/lib/social/encouragements";
import { socialFailureMessage } from "@/lib/social/messages";
import { classifyRemoteError, socialFailureOf } from "@/lib/social/remote";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockRpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string, Record<string, unknown>]>();
let mockConfigured = true;
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args) },
}));

const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
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
  mockConfigured = true;
  await AsyncStorage.clear();
});

describe("halaqa adapter", () => {
  it("validates the group view and maps it to domain fields", async () => {
    mockRpc.mockResolvedValue({ data: detailPayload, error: null });
    const detail = await fetchHalaqaDetail(GROUP, "2026-11-13");
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
    await expect(fetchHalaqaDetail(GROUP, "2026-11-13")).rejects.toMatchObject({ failure: { kind: "invalid_response" } });
  });

  it("keeps server refusals as typed causes with their own messages", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "halaqa_full" } });
    const error = await joinHalaqaByCode(" abcd-2345 ").catch((caught: unknown) => caught);
    expect(mockRpc).toHaveBeenCalledWith("join_halaqa_by_code", { p_code: "ABCD2345" });
    expect(socialFailureOf(error)).toEqual({ kind: "rejected", code: "halaqa_full" });
    expect(socialFailureMessage(error, strings.ar)).toBe(strings.ar.socialErrorHalaqaFull);
  });

  it("sends a template or a trimmed note, never an empty body", async () => {
    mockRpc.mockResolvedValue({ data: { id: GROUP }, error: null });
    await sendEncouragement({ groupId: GROUP, toUserId: OTHER, templateId: "dua", body: "   ", today: "2026-11-13" });
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
    await expect(fetchHalaqaDetail(GROUP, "2026-11-13")).rejects.toMatchObject({ failure: { kind: "unconfigured" } });
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
  const bands = { levelBand: "juz_amma", paceBand: "light", utcOffsetMinutes: 180 } as const;

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
    const view = await fetchBoard(bands, "2026-11-13");
    expect(mockRpc).toHaveBeenCalledWith("get_board", {
      p_level_band: "juz_amma",
      p_pace_band: "light",
      p_utc_offset_minutes: 180,
      p_today: "2026-11-13",
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
    await joinBoard({ nickname: "Little Star", isMinor: true, bands, today: "2026-11-13" });
    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe("join_board");
    expect(args).toMatchObject({ p_nickname: "Little Star", p_is_minor: true, p_level_band: "juz_amma" });
    expect(Object.keys(args).some((key) => /score|point|cohort/.test(key))).toBe(false);
  });
});

describe("profile summary (SOC-01)", () => {
  it("keeps hidden fields hidden", async () => {
    mockRpc.mockResolvedValue({ data: { streak: null, juz_completed: [30] }, error: null });
    await expect(fetchProfileSummary(OTHER)).resolves.toEqual({ streak: null, juzCompleted: [30] });
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
