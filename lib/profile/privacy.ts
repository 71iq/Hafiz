import { z } from "zod";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { requireSignedOutViewer, requireSocialOwner, type SocialOwner } from "@/lib/social/owner";
import { callSocialRpc, classifyRemoteError, socialError, socialFailureOf } from "@/lib/social/remote";

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

export function fetchProfilePrivacy(owner: SocialOwner): Promise<ProfilePrivacy> {
  return callSocialRpc("get_profile_privacy", {}, profilePrivacySchema, owner);
}

export class ProfilePrivacyChangedError extends Error {
  constructor() {
    super("privacy_changed");
    this.name = "ProfilePrivacyChangedError";
  }
}

export function profilePrivacyWriteError(error: unknown): unknown {
  const failure = socialFailureOf(error);
  return failure.kind === "failed" && failure.message === "privacy_changed" ? new ProfilePrivacyChangedError() : error;
}

const savedPrivacySchema = privacyRow
  .extend({ left_board: z.boolean() })
  .transform((row) => ({ ...toPrivacy(row), leftBoard: row.left_board }));
export type SavedProfilePrivacy = z.output<typeof savedPrivacySchema>;

export async function saveProfilePrivacy(
  input: { showStreak: boolean; showJuzCompletions: boolean; isMinor: boolean; expectedMinor: boolean },
  owner: SocialOwner,
): Promise<SavedProfilePrivacy> {
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

export async function deleteAvatarFilesAfterMinority(owner: SocialOwner): Promise<void> {
  try {
    await deleteOwnAvatarFiles(owner, { beforeRemove: async () => (await fetchProfilePrivacy(owner)).isMinor });
  } catch {
  }
}

const AVATAR_BUCKET = "avatars";
const AVATAR_PAGE = 100;
const AVATAR_MAX_REQUESTS = 100;

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
    if ((removed.data?.length ?? 0) < batch.length) throw socialError({ kind: "failed", message: "avatar_delete_incomplete" });
  }
  return paths.length;
}

export async function fetchProfileSummary(userId: string, viewerId?: string | null): Promise<ProfileSummary> {
  if (!isSupabaseConfigured() || !userId) return null;
  const viewer = viewerId ? requireSocialOwner(viewerId) : requireSignedOutViewer();
  return callSocialRpc("get_profile_summary", { p_user_id: userId }, profileSummarySchema, viewer);
}
