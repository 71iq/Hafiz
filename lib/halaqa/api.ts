import { z } from "zod";
import { sabaqAssignmentSchema } from "@/lib/halaqa/sabaq-assignment";
import { parseHifzPlan } from "@/lib/hifz/plan";
import type { SocialOwner } from "@/lib/social/owner";
import { callSocialRpc, localDateSchema, readSocial, voidResult, type SocialRead } from "@/lib/social/remote";
import type { SocialBands } from "@/lib/social/bands";


export const ENCOURAGEMENT_TEMPLATE_IDS = [
  "ease",
  "missed_you",
  "keep_going",
  "small_steady",
  "dua",
  "together",
  "welcome_back",
  "well_done",
  "firm_heart",
] as const;
export type EncouragementTemplateId = (typeof ENCOURAGEMENT_TEMPLATE_IDS)[number];

export const HALAQA_NAME_MAX = 60;
export const ENCOURAGEMENT_BODY_MAX = 200;
export const INVITE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

const count = z.number().int().nonnegative();
const role = z.enum(["member", "teacher"]);

const summaryRow = z.object({
  id: z.string().uuid(),
  kind: z.enum(["invite", "matched"]),
  name: z.string().nullable(),
  invite_code: z.string().nullable(),
  member_count: count,
  role,
  is_creator: z.boolean(),
  share_consistency: z.boolean(),
  share_juz: z.boolean(),
  share_plan_with_teachers: z.boolean(),
  share_grades_with_teachers: z.boolean(),
});

const halaqaSummarySchema = summaryRow.transform((row) => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  inviteCode: row.invite_code,
  memberCount: row.member_count,
  role: row.role,
  isCreator: row.is_creator,
  sharing: {
    consistency: row.share_consistency,
    juz: row.share_juz,
    planWithTeachers: row.share_plan_with_teachers,
    gradesWithTeachers: row.share_grades_with_teachers,
  },
}));
export type HalaqaSummary = z.output<typeof halaqaSummarySchema>;
export type HalaqaSharing = HalaqaSummary["sharing"];

const halaqaListSchema = z.array(halaqaSummarySchema);

const goalRow = z.object({ week_start: localDateSchema, contributors: count, target: count, wird_days: count });
const goalSchema = goalRow.transform((row) => ({
  weekStart: row.week_start,
  contributors: row.contributors,
  target: row.target,
  wirdDays: row.wird_days,
}));
export type HalaqaGoal = z.output<typeof goalSchema>;

const memberRow = z.object({
  user_id: z.string().uuid(),
  name: z.string(),
  username: z.string(),
  avatar_url: z.string().nullable(),
  role,
  is_me: z.boolean(),
  week: z.array(z.boolean()).length(7).nullable(),
  streak: count.nullable(),
  juz_completions: count.nullable(),
  encouraged_today: z.boolean(),
  teacher_view: z.boolean(),
});

const receivedRow = z.object({
  id: z.string().uuid(),
  from_name: z.string().nullable(),
  template_id: z.string().nullable(),
  body: z.string().nullable(),
  created_at: z.string(),
});

const halaqaDetailSchema = z
  .object({
    group: halaqaSummarySchema,
    goal: goalSchema,
    members: z.array(memberRow),
    encouraged_today: z.boolean(),
    received: z.array(receivedRow),
  })
  .transform((row) => ({
    group: row.group,
    goal: row.goal,
    encouragedToday: row.encouraged_today,
    members: row.members.map((member) => ({
      userId: member.user_id,
      name: member.name,
      username: member.username,
      avatarUrl: member.avatar_url,
      role: member.role,
      isMe: member.is_me,
      week: member.week,
      streak: member.streak,
      juzCompletions: member.juz_completions,
      encouragedToday: member.encouraged_today,
      canOpenTeacherView: member.teacher_view,
    })),
    received: row.received.map((item) => ({
      id: item.id,
      fromName: item.from_name,
      templateId: item.template_id,
      body: item.body,
      createdAt: item.created_at,
    })),
  }));
export type HalaqaDetail = z.output<typeof halaqaDetailSchema>;
export type HalaqaMember = HalaqaDetail["members"][number];
export type ReceivedEncouragement = HalaqaDetail["received"][number];

const teacherViewSchema = z
  .object({
    name: z.string().nullable(),
    plan: z
      .object({
        hifz_plan: z.string().nullable(),
        tiers: z.record(z.string(), count),
        sabaq_assignment: sabaqAssignmentSchema.nullable().optional(),
      })
      .nullable(),
    grades: z
      .object({
        recent: z.array(
          z.object({
            card_id: z.string(),
            rating: z.number().int(),
            grader: z.string().nullable(),
            support_level: z.number().int().nullable(),
            local_date: z.string().nullable(),
            reviewed_at: z.string(),
          }),
        ),
        mistake_inbox_count: count,
      })
      .nullable(),
  })
  .transform((row) => ({
    name: row.name,
    plan: row.plan
      ? {
          hifzPlan: parseHifzPlan(row.plan.hifz_plan),
          tiers: row.plan.tiers,
          sabaqAssignment: row.plan.sabaq_assignment ?? null,
        }
      : null,
    grades: row.grades
      ? {
          mistakeInboxCount: row.grades.mistake_inbox_count,
          recent: row.grades.recent.map((grade) => ({
            cardId: grade.card_id,
            rating: grade.rating,
            grader: grade.grader,
            supportLevel: grade.support_level,
            localDate: grade.local_date,
            reviewedAt: grade.reviewed_at,
          })),
        }
      : null,
  }));
export type TeacherView = z.output<typeof teacherViewSchema>;

export const halaqaKeys = {
  all: (userId: string | null) => ["halaqa", userId ?? "signed-out"] as const,
  mine: (userId: string | null) => ["halaqa", userId ?? "signed-out", "mine"] as const,
  detail: (userId: string | null, groupId: string, today: string) =>
    ["halaqa", userId ?? "signed-out", "detail", groupId, today] as const,
  teacher: (userId: string | null, groupId: string, memberId: string, today: string) =>
    ["halaqa", userId ?? "signed-out", "teacher", groupId, memberId, today] as const,
};

export function myHalaqasRead(): SocialRead<HalaqaSummary[]> {
  return { fn: "get_my_halaqas", args: {}, schema: halaqaListSchema };
}

export function halaqaDetailRead(groupId: string, today: string): SocialRead<HalaqaDetail> {
  return { fn: "get_halaqa_detail", args: { p_group_id: groupId, p_today: today }, schema: halaqaDetailSchema };
}

export function fetchHalaqaDetail(groupId: string, today: string, owner: SocialOwner): Promise<HalaqaDetail> {
  return readSocial(halaqaDetailRead(groupId, today), owner);
}

export function createInviteHalaqa(name: string, asTeacher: boolean, owner: SocialOwner): Promise<HalaqaSummary> {
  return callSocialRpc(
    "create_invite_halaqa",
    { p_name: name.trim(), p_as_teacher: asTeacher },
    halaqaSummarySchema,
    owner,
  );
}

export function normalizeInviteCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

export function joinHalaqaByCode(code: string, owner: SocialOwner): Promise<HalaqaSummary> {
  return callSocialRpc("join_halaqa_by_code", { p_code: normalizeInviteCode(code) }, halaqaSummarySchema, owner);
}

export function joinMatchedHalaqa(bands: SocialBands, owner: SocialOwner): Promise<HalaqaSummary> {
  return callSocialRpc(
    "join_matched_halaqa",
    { p_level_band: bands.levelBand, p_pace_band: bands.paceBand, p_utc_offset_minutes: bands.utcOffsetMinutes },
    halaqaSummarySchema,
    owner,
  );
}

export async function leaveHalaqa(groupId: string, owner: SocialOwner): Promise<void> {
  await callSocialRpc("leave_halaqa", { p_group_id: groupId }, voidResult, owner);
}

export function setHalaqaSharing(groupId: string, sharing: HalaqaSharing, owner: SocialOwner): Promise<HalaqaSummary> {
  return callSocialRpc(
    "set_halaqa_sharing",
    {
      p_group_id: groupId,
      p_share_consistency: sharing.consistency,
      p_share_juz: sharing.juz,
      p_share_plan_with_teachers: sharing.planWithTeachers,
      p_share_grades_with_teachers: sharing.gradesWithTeachers,
    },
    halaqaSummarySchema,
    owner,
  );
}

export type HalaqaRole = z.output<typeof role>;

export async function setHalaqaMemberRole(
  groupId: string,
  memberId: string,
  nextRole: HalaqaRole,
  owner: SocialOwner,
): Promise<void> {
  await callSocialRpc(
    "set_halaqa_member_role",
    { p_group_id: groupId, p_member_id: memberId, p_role: nextRole },
    voidResult,
    owner,
  );
}

export async function sendEncouragement(
  input: {
    groupId: string;
    toUserId: string;
    templateId: EncouragementTemplateId | null;
    body: string | null;
    today: string;
  },
  owner: SocialOwner,
): Promise<void> {
  const body = input.body?.trim() || null;
  await callSocialRpc(
    "send_halaqa_encouragement",
    {
      p_group_id: input.groupId,
      p_to_user: input.toUserId,
      p_template_id: input.templateId,
      p_body: body,
      p_today: input.today,
    },
    z.object({ id: z.string().uuid() }),
    owner,
  );
}

export function fetchTeacherView(groupId: string, memberId: string, today: string, owner: SocialOwner): Promise<TeacherView> {
  return callSocialRpc(
    "get_halaqa_teacher_view",
    { p_group_id: groupId, p_member_id: memberId, p_today: today },
    teacherViewSchema,
    owner,
  );
}

const receivedPageSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), created_at: z.string().min(1) })).max(100),
  more: z.boolean(),
  checked_at: z.string().min(1),
});
type ReceivedPage = z.output<typeof receivedPageSchema>;

export type ReceivedEncouragements = Readonly<{
  items: { id: string; createdAt: string }[];
  checkedAt: string;
  complete: boolean;
}>;

const RECEIVED_MAX_PAGES = 300;

type InboxPosition = Readonly<{ ms: number; subMs: number; id: string }>;

function inboxPosition(createdAt: string, id: string): InboxPosition | null {
  const match = /^([^.]*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(createdAt);
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(6, "0");
  const ms = Date.parse(`${match[1]}.${fraction.slice(0, 3)}${match[3]}`);
  if (!Number.isFinite(ms)) return null;
  return { ms, subMs: Number(fraction.slice(3, 6)), id: id.toLowerCase() };
}

function movesForward(next: InboxPosition | null, previous: InboxPosition | null): boolean {
  if (!next || !previous) return true;
  if (next.ms !== previous.ms) return next.ms > previous.ms;
  if (next.subMs !== previous.subMs) return next.subMs > previous.subMs;
  return next.id > previous.id;
}

export async function fetchReceivedEncouragements(owner: SocialOwner): Promise<ReceivedEncouragements> {
  const items = new Map<string, string>();
  const listed = (checkedAt: string, complete: boolean): ReceivedEncouragements => ({
    items: [...items].map(([id, createdAt]) => ({ id, createdAt })),
    checkedAt,
    complete,
  });
  let checkedAt: string | null = null;
  let cursor: Record<string, string> = {};
  let previous: InboxPosition | null = null;
  for (let pages = 1; ; pages += 1) {
    const result: ReceivedPage = await callSocialRpc("get_received_encouragements", cursor, receivedPageSchema, owner);
    const firstCheckedAt: string = checkedAt ?? result.checked_at;
    checkedAt = firstCheckedAt;
    for (const item of result.items) if (!items.has(item.id)) items.set(item.id, item.created_at);
    if (!result.more) return listed(firstCheckedAt, true);
    const last = result.items.at(-1);
    const position = last ? inboxPosition(last.created_at, last.id) : null;
    if (!last || !movesForward(position, previous) || pages >= RECEIVED_MAX_PAGES) return listed(firstCheckedAt, false);
    cursor = { p_after_created_at: last.created_at, p_after_id: last.id };
    previous = position;
  }
}

export function isEncouragementTemplateId(value: string | null): value is EncouragementTemplateId {
  return value !== null && (ENCOURAGEMENT_TEMPLATE_IDS as readonly string[]).includes(value);
}
