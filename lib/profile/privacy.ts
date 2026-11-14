import { z } from "zod";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { requireSignedOutViewer, requireSocialOwner, type SocialOwner } from "@/lib/social/owner";
import { callSocialRpc, classifyRemoteError, socialError, socialFailureOf } from "@/lib/social/remote";

/**
 * Profile visibility (SOC-01, ETH-07). Everything beyond identity is private unless the person turns it
 * on. The choices live in an owner-only table, and what others may see is decided by the server.
 */
const privacyRow = z.object({
  board_joined: z.boolean(),
  board_nickname: z.string().nullable(),
  show_streak: z.boolean(),
  show_juz_completions: z.boolean(),
  is_minor: z.boolean(),
});
const toPrivacy = (row: z.output<typeof privacyRow>) => ({
  boardJoined: row.board_joined,
  boardNickname: row.board_nickname,
  showStreak: row.show_streak,
  showJuzCompletions: row.show_juz_completions,
  isMinor: row.is_minor,
});
const profilePrivacySchema = privacyRow.transform(toPrivacy);
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
 * ETH-07: the server refused a write that sets is_minor because the stored value is no longer the one
 * the form loaded. Another device changed the age setting, and saving the old copy could clear a
 * minor's setting and make their profile public. Nothing was written. The screen reloads the
 * privacy and asks the person to check it and try again.
 */
export class ProfilePrivacyChangedError extends Error {
  constructor() {
    super("privacy_changed");
    this.name = "ProfilePrivacyChangedError";
  }
}

/** Maps the server's refusal of a stale minority value to its own error and passes others through. */
export function profilePrivacyWriteError(error: unknown): unknown {
  const failure = socialFailureOf(error);
  return failure.kind === "failed" && failure.message === "privacy_changed" ? new ProfilePrivacyChangedError() : error;
}

const savedPrivacySchema = privacyRow
  .extend({ left_board: z.boolean() })
  .transform((row) => ({ ...toPrivacy(row), leftBoard: row.left_board }));
/** The saved choices, and whether recording minority took the account off the Board (BRD-07). */
export type SavedProfilePrivacy = z.output<typeof savedPrivacySchema>;

/**
 * Saves the visibility choices. `expectedMinor` is the minority the form loaded; the server refuses
 * the save with ProfilePrivacyChangedError when the stored value differs. Recording minority (ETH-07)
 * deletes the stored photo files first and is not sent when that fails, so the save can be retried
 * before anything is recorded. The server then clears the profile photo, refuses new uploads, leaves
 * matched halaqas, takes a Board member without a nickname off the Board, and one more pass removes a
 * photo another device uploaded in between.
 */
export async function saveProfilePrivacy(
  input: { showStreak: boolean; showJuzCompletions: boolean; isMinor: boolean; expectedMinor: boolean },
  owner: SocialOwner,
): Promise<SavedProfilePrivacy> {
  // Only a change to minority deletes first. A form that already showed a minor has nothing new to
  // record, and a stale one would otherwise delete an adult's photos before the server refuses it.
  if (input.isMinor && !input.expectedMinor) await deleteOwnAvatarFiles(owner);
  const saved = await callSocialRpc(
    "set_profile_privacy",
    {
      p_show_streak: input.showStreak,
      p_show_juz_completions: input.showJuzCompletions,
      p_is_minor: input.isMinor,
      p_expected_minor: input.expectedMinor,
    },
    savedPrivacySchema,
    owner,
  ).catch((error: unknown) => {
    throw profilePrivacyWriteError(error);
  });
  if (saved.isMinor) await deleteAvatarFilesAfterMinority(owner);
  return saved;
}

/**
 * The pass after minority is recorded. From then on the bucket refuses this account's uploads, so
 * this removes any photo uploaded since the first pass. Before deleting what it found it reads the
 * account's privacy again, since another device may have withdrawn minority and uploaded a photo
 * since this save. Best effort: the save has already succeeded, and useMinorPhotoCleanup tries again
 * in each app session.
 */
export async function deleteAvatarFilesAfterMinority(owner: SocialOwner): Promise<void> {
  try {
    await deleteOwnAvatarFiles(owner, { beforeRemove: async () => (await fetchProfilePrivacy(owner)).isMinor });
  } catch {
    // Retried by useMinorPhotoCleanup.
  }
}

/** lib/profile/avatar.ts uploads each photo as `${userId}/${time}.${extension}` in this public bucket. */
const AVATAR_BUCKET = "avatars";
const AVATAR_PAGE = 100;
/** List and remove requests for one cleanup. The app stores a few files in one folder. */
const AVATAR_MAX_REQUESTS = 100;

/**
 * ETH-07: deletes every photo this account stored in the public avatars bucket, nested folders
 * included, as the owner's own session. The bucket serves files to anyone with the link, so clearing
 * the profile's avatar_url alone would leave a minor's photo published. It lists everything first and
 * then removes it, so an account with nothing stored costs one list request. Fails when a file could
 * not be deleted or the account changed, so the caller can retry. `beforeRemove`, when given, runs
 * once there is something to delete; resolving false leaves every file and returns 0.
 */
export async function deleteOwnAvatarFiles(
  owner: SocialOwner,
  { beforeRemove }: { beforeRemove?: () => Promise<boolean> } = {},
): Promise<number> {
  let requests = 0;
  const bucket = async () => {
    requests += 1;
    if (requests > AVATAR_MAX_REQUESTS) throw socialError({ kind: "failed", message: "avatar_delete_incomplete" });
    const token = await owner.accessToken();
    return supabase.storage.from(AVATAR_BUCKET).setHeader("Authorization", `Bearer ${token}`);
  };

  const paths: string[] = [];
  const folders = [owner.userId];
  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    for (let offset = 0; ; offset += AVATAR_PAGE) {
      const listed = await (await bucket()).list(folder, { limit: AVATAR_PAGE, offset });
      owner.requireCurrent();
      if (listed.error) throw socialError(classifyRemoteError(listed.error));
      const entries = listed.data ?? [];
      // Storage lists a nested folder as an entry without an id.
      for (const entry of entries) (entry.id === null ? folders : paths).push(`${folder}/${entry.name}`);
      if (entries.length < AVATAR_PAGE) break;
    }
  }

  if (paths.length > 0 && beforeRemove && !(await beforeRemove())) return 0;
  for (let start = 0; start < paths.length; start += AVATAR_PAGE) {
    const batch = paths.slice(start, start + AVATAR_PAGE);
    const removed = await (await bucket()).remove(batch);
    owner.requireCurrent();
    if (removed.error) throw socialError(classifyRemoteError(removed.error));
    // Storage reports what it deleted; a policy refusal deletes nothing without an error.
    if ((removed.data?.length ?? 0) < batch.length) throw socialError({ kind: "failed", message: "avatar_delete_incomplete" });
  }
  return paths.length;
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
