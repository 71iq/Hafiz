import { useEffect } from "react";
import { AppState } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth/store";
import { halaqaKeys } from "@/lib/halaqa/api";
import { deleteOwnAvatarFiles, fetchProfilePrivacy, profilePrivacyKeys } from "@/lib/profile/privacy";
import { captureSocialOwner, requireSocialOwner } from "@/lib/social/owner";
import { socialFailureOf } from "@/lib/social/remote";
import { isSupabaseConfigured } from "@/lib/supabase";

// Accounts that had no photo files left at some point in this app session.
const cleaned = new Set<string>();
// One cleanup at a time per account.
const running = new Map<string, Promise<boolean>>();

/**
 * ETH-07: removes the photo files a minor account still has in the public avatars bucket, at most
 * once per app session and account. Recording minority deletes them already; this finishes a pass
 * that a crash, a lost connection or an account switch cut short. It runs as that account and stops
 * when the account changes. When nothing is left it costs one list request. Resolves false when the
 * account is no longer signed in.
 */
export function cleanUpMinorPhotos(userId: string): Promise<boolean> {
  if (cleaned.has(userId)) return Promise.resolve(true);
  const current = running.get(userId);
  if (current) return current;
  const run = (async () => {
    const owner = captureSocialOwner(userId);
    if (!owner) return false;
    await deleteOwnAvatarFiles(owner);
    cleaned.add(userId);
    return true;
  })().finally(() => running.delete(userId));
  running.set(userId, run);
  return run;
}

/**
 * Watches the signed-in account's own privacy. While it is a minor, leftover photo files are removed
 * once per app session, again on returning to the foreground after a failure, and halaqa lists
 * reload, since recording minority leaves matched halaqas. The board and halaqa screens invalidate
 * the privacy key after they change it, which refetches it here. Mount once.
 */
export function useMinorPhotoCleanup(): void {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  const privacy = useQuery({
    queryKey: profilePrivacyKeys.mine(userId),
    queryFn: () => fetchProfilePrivacy(requireSocialOwner(userId ?? "")),
    enabled: userId !== null && isSupabaseConfigured(),
    retry: false,
    staleTime: Infinity,
  });
  const isMinor = privacy.data?.isMinor === true;

  useEffect(() => {
    if (!userId || !isMinor) return;
    void queryClient.invalidateQueries({ queryKey: halaqaKeys.all(userId) });
    const run = () => {
      cleanUpMinorPhotos(userId).catch((error: unknown) => {
        const kind = socialFailureOf(error).kind;
        if (kind !== "offline" && kind !== "account_changed" && kind !== "unconfigured") {
          console.warn("[Profile] Minor photo cleanup failed:", error);
        }
      });
    };
    run();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => appState.remove();
  }, [queryClient, userId, isMinor]);
}
