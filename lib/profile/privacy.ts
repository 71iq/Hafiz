import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase";
import { requireSocialOwner, type SocialOwner } from "@/lib/social/owner";
import { callSocialRpc } from "@/lib/social/remote";

/**
 * Profile visibility (SOC-01, ETH-07). Everything beyond identity is private unless the person turns it
 * on. The choices live in an owner-only table, and what others may see is decided by the server.
 */
const profilePrivacySchema = z
  .object({
    board_joined: z.boolean(),
    board_nickname: z.string().nullable(),
    show_streak: z.boolean(),
    show_juz_completions: z.boolean(),
    is_minor: z.boolean(),
  })
  .transform((row) => ({
    boardJoined: row.board_joined,
    boardNickname: row.board_nickname,
    showStreak: row.show_streak,
    showJuzCompletions: row.show_juz_completions,
    isMinor: row.is_minor,
  }));
export type ProfilePrivacy = z.output<typeof profilePrivacySchema>;

/** Null fields are hidden from this viewer. */
const profileSummarySchema = z
  .object({
    streak: z.number().int().nonnegative().nullable(),
    juz_completed: z.array(z.number().int().min(1).max(30)).nullable(),
  })
  .nullable()
  .transform((row) => (row ? { streak: row.streak, juzCompleted: row.juz_completed } : null));
export type ProfileSummary = z.output<typeof profileSummarySchema>;

export const profilePrivacyKeys = {
  mine: (userId: string | null) => ["profilePrivacy", userId ?? "signed-out"] as const,
  summary: (viewerId: string | null, targetId: string) => ["profileSummary", viewerId ?? "signed-out", targetId] as const,
};

/** The owner's own choices. Runs as that account (lib/social/owner.ts). */
export function fetchProfilePrivacy(owner: SocialOwner): Promise<ProfilePrivacy> {
  return callSocialRpc("get_profile_privacy", {}, profilePrivacySchema, owner);
}

export function saveProfilePrivacy(
  input: { showStreak: boolean; showJuzCompletions: boolean; isMinor: boolean },
  owner: SocialOwner,
): Promise<ProfilePrivacy> {
  return callSocialRpc(
    "set_profile_privacy",
    { p_show_streak: input.showStreak, p_show_juz_completions: input.showJuzCompletions, p_is_minor: input.isMinor },
    profilePrivacySchema,
    owner,
  );
}

/**
 * What this viewer may see of another person's consistency; null when unavailable or hidden. The
 * answer depends on the viewer, so pass the viewer's id when signed in: the request then runs as that
 * account and is refused once it is no longer signed in. Without one it uses whatever session the
 * shared client holds.
 */
export async function fetchProfileSummary(userId: string, viewerId?: string | null): Promise<ProfileSummary> {
  if (!isSupabaseConfigured() || !userId) return null;
  const owner = viewerId ? requireSocialOwner(viewerId) : undefined;
  return callSocialRpc("get_profile_summary", { p_user_id: userId }, profileSummarySchema, owner);
}
