import { z } from "zod";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { requireSignedOutViewer, requireSocialOwner, type SocialOwner } from "@/lib/social/owner";
import { callSocialRpc, classifyRemoteError, socialError } from "@/lib/social/remote";

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

/**
 * Saves the visibility choices. Once the account is recorded as a minor, the server has cleared the
 * profile photo and refuses new uploads, and the stored photo files are deleted here (ETH-07).
 */
export async function saveProfilePrivacy(
  input: { showStreak: boolean; showJuzCompletions: boolean; isMinor: boolean },
  owner: SocialOwner,
): Promise<ProfilePrivacy> {
  const saved = await callSocialRpc(
    "set_profile_privacy",
    { p_show_streak: input.showStreak, p_show_juz_completions: input.showJuzCompletions, p_is_minor: input.isMinor },
    profilePrivacySchema,
    owner,
  );
  if (saved.isMinor) await deleteOwnAvatarFiles(owner);
  return saved;
}

/** lib/profile/avatar.ts uploads each photo as `${userId}/${time}.${extension}` in this public bucket. */
const AVATAR_BUCKET = "avatars";
const AVATAR_PAGE = 100;
const AVATAR_MAX_PAGES = 20;

/**
 * ETH-07: deletes every photo this account stored in the public avatars bucket, as the owner's own
 * session. The avatars bucket serves files to anyone with the link, so clearing the profile's
 * avatar_url alone would leave a minor's photo published. Fails when a file could not be deleted, so
 * the save can be retried.
 */
export async function deleteOwnAvatarFiles(owner: SocialOwner): Promise<number> {
  let deleted = 0;
  for (let page = 0; page < AVATAR_MAX_PAGES; page += 1) {
    const token = await owner.accessToken();
    const files = supabase.storage.from(AVATAR_BUCKET).setHeader("Authorization", `Bearer ${token}`);
    const listed = await files.list(owner.userId, { limit: AVATAR_PAGE });
    owner.requireCurrent();
    if (listed.error) throw socialError(classifyRemoteError(listed.error));
    const paths = (listed.data ?? []).filter((item) => item.id !== null).map((item) => `${owner.userId}/${item.name}`);
    if (paths.length === 0) return deleted;
    const removed = await files.remove(paths);
    owner.requireCurrent();
    if (removed.error) throw socialError(classifyRemoteError(removed.error));
    // Storage reports what it deleted; a policy refusal deletes nothing without an error.
    if ((removed.data?.length ?? 0) < paths.length) throw socialError({ kind: "failed", message: "avatar_delete_incomplete" });
    deleted += paths.length;
  }
  throw socialError({ kind: "failed", message: "avatar_delete_incomplete" });
}

/**
 * What this viewer may see of another person's consistency; null when unavailable or hidden. The
 * answer depends on the viewer. Pass the viewer's id when signed in: the request then runs as that
 * account and is refused once it is no longer signed in. Without one the request runs signed out with
 * the public key, never with a session that signed in meanwhile, and is refused after a sign-in, so
 * nothing private is cached under the signed-out key.
 */
export async function fetchProfileSummary(userId: string, viewerId?: string | null): Promise<ProfileSummary> {
  if (!isSupabaseConfigured() || !userId) return null;
  const viewer = viewerId ? requireSocialOwner(viewerId) : requireSignedOutViewer();
  return callSocialRpc("get_profile_summary", { p_user_id: userId }, profileSummarySchema, viewer);
}
