import { z } from "zod";
import { deleteAvatarFilesAfterMinority, deleteOwnAvatarFiles, profilePrivacyWriteError } from "@/lib/profile/privacy";
import type { SocialOwner } from "@/lib/social/owner";
import {
  callSocialRpc,
  callSocialRpcRaw,
  localDateSchema,
  parseSocialPayload,
  readSocial,
  voidResult,
  type SocialRead,
} from "@/lib/social/remote";
import type { SocialBands } from "@/lib/social/bands";

const BOARD_NICKNAME_MIN = 3;
export const BOARD_NICKNAME_MAX = 20;

const count = z.number().int().nonnegative();

const standingRow = z.object({
  rank: z.number().int().positive(),
  name: z.string(),
  uses_nickname: z.boolean(),
  avatar_url: z.string().nullable(),
  points: count,
  streak: count,
  is_me: z.boolean(),
});

export const boardViewSchema = z
  .discriminatedUnion("status", [
    z.object({ status: z.literal("not_joined"), week_start: localDateSchema }),
    z.object({ status: z.literal("gathering"), week_start: localDateSchema, member_count: count, min_members: count }),
    z.object({
      status: z.literal("ready"),
      week_start: localDateSchema,
      member_count: count,
      min_members: count,
      standings: z.array(standingRow),
    }),
  ])
  .transform((row) => {
    switch (row.status) {
      case "not_joined":
        return { status: row.status, weekStart: row.week_start };
      case "gathering":
        return { status: row.status, weekStart: row.week_start, memberCount: row.member_count, minMembers: row.min_members };
      case "ready":
        return {
          status: row.status,
          weekStart: row.week_start,
          memberCount: row.member_count,
          minMembers: row.min_members,
          standings: row.standings.map((standing) => ({
            rank: standing.rank,
            name: standing.name,
            usesNickname: standing.uses_nickname,
            avatarUrl: standing.avatar_url,
            points: standing.points,
            streak: standing.streak,
            isMe: standing.is_me,
          })),
        };
    }
  });
export type BoardView = z.output<typeof boardViewSchema>;
export type BoardStanding = Extract<BoardView, { status: "ready" }>["standings"][number];

export type BoardInputs = Readonly<{ bands: SocialBands; weekStart: number }>;

export const boardKeys = {
  all: (userId: string | null) => ["board", userId ?? "signed-out"] as const,
  view: (userId: string | null, today: string, inputs: BoardInputs) =>
    [
      "board",
      userId ?? "signed-out",
      today,
      inputs.bands.levelBand,
      inputs.bands.paceBand,
      inputs.bands.utcOffsetMinutes,
      inputs.weekStart,
    ] as const,
};

function boardArgs(inputs: BoardInputs, today: string) {
  return {
    p_level_band: inputs.bands.levelBand,
    p_pace_band: inputs.bands.paceBand,
    p_utc_offset_minutes: inputs.bands.utcOffsetMinutes,
    p_today: today,
    p_week_start: inputs.weekStart,
  };
}

export function boardRead(inputs: BoardInputs, today: string): SocialRead<BoardView> {
  return { fn: "get_board", args: boardArgs(inputs, today), schema: boardViewSchema };
}

export function fetchBoard(inputs: BoardInputs, today: string, owner: SocialOwner): Promise<BoardView> {
  return readSocial(boardRead(inputs, today), owner);
}

export function normalizeBoardNickname(input: string): string | null {
  const trimmed = input.trim().replace(/\s+/g, " ");
  return trimmed.length === 0 ? null : trimmed;
}

export function isValidBoardNickname(nickname: string | null): boolean {
  return nickname === null || (nickname.length >= BOARD_NICKNAME_MIN && nickname.length <= BOARD_NICKNAME_MAX);
}

export async function joinBoard(
  input: { nickname: string | null; isMinor: boolean; expectedMinor: boolean; inputs: BoardInputs; today: string },
  owner: SocialOwner,
): Promise<{ view: BoardView; leftMatched: boolean }> {
  if (input.isMinor && !input.expectedMinor) await deleteOwnAvatarFiles(owner);
  const raw = await callSocialRpcRaw(
    "join_board",
    {
      p_nickname: input.nickname,
      p_is_minor: input.isMinor,
      p_expected_minor: input.expectedMinor,
      ...boardArgs(input.inputs, input.today),
    },
    owner,
  ).catch((error: unknown) => {
    throw profilePrivacyWriteError(error);
  });
  const view = parseSocialPayload(boardViewSchema, raw);
  const leftMatched = parseSocialPayload(leftMatchedSchema, raw).left_matched === true;
  if (input.isMinor) await deleteAvatarFilesAfterMinority(owner);
  return { view, leftMatched };
}

const leftMatchedSchema = z.object({ left_matched: z.boolean().optional() });

export async function refreshBoardBandsRemote(inputs: BoardInputs, today: string, owner: SocialOwner): Promise<void> {
  await callSocialRpc("refresh_board_bands", boardArgs(inputs, today), voidResult, owner);
}

export async function leaveBoard(owner: SocialOwner): Promise<void> {
  await callSocialRpc("leave_board", {}, voidResult, owner);
}
