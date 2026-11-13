import { z } from "zod";
import { callSocialRpc, localDateSchema, readSocial, voidResult, type SocialRead } from "@/lib/social/remote";
import type { SocialBands } from "@/lib/social/bands";

/**
 * Board service adapter (spec 5.7.2). Opt-in weekly cohorts of about 30 people. The server places the
 * caller and computes every score from synced wird days (PTS-02, SB-04); the client only reports its
 * bands. Standings carry no user ids, and never show a photo under a nickname or for a minor (BRD-07).
 */
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

export const boardKeys = {
  all: (userId: string | null) => ["board", userId ?? "signed-out"] as const,
  view: (userId: string | null, today: string, bands: SocialBands) =>
    ["board", userId ?? "signed-out", today, bands.levelBand, bands.paceBand, bands.utcOffsetMinutes] as const,
};

function bandArgs(bands: SocialBands, today: string) {
  return {
    p_level_band: bands.levelBand,
    p_pace_band: bands.paceBand,
    p_utc_offset_minutes: bands.utcOffsetMinutes,
    p_today: today,
  };
}

/** Called when the Board tab opens; places a joined user in this week's cohort if needed. */
export function boardRead(bands: SocialBands, today: string): SocialRead<BoardView> {
  return { fn: "get_board", args: bandArgs(bands, today), schema: boardViewSchema };
}

export function fetchBoard(bands: SocialBands, today: string): Promise<BoardView> {
  return readSocial(boardRead(bands, today));
}

export function normalizeBoardNickname(input: string): string | null {
  const trimmed = input.trim().replace(/\s+/g, " ");
  return trimmed.length === 0 ? null : trimmed;
}

export function isValidBoardNickname(nickname: string | null): boolean {
  return nickname === null || (nickname.length >= BOARD_NICKNAME_MIN && nickname.length <= BOARD_NICKNAME_MAX);
}

export function joinBoard(input: {
  nickname: string | null;
  isMinor: boolean;
  bands: SocialBands;
  today: string;
}): Promise<BoardView> {
  return callSocialRpc(
    "join_board",
    { p_nickname: input.nickname, p_is_minor: input.isMinor, ...bandArgs(input.bands, input.today) },
    boardViewSchema,
  );
}

export async function leaveBoard(): Promise<void> {
  await callSocialRpc("leave_board", {}, voidResult);
}
