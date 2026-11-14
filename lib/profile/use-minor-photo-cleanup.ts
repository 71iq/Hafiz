import { useEffect } from "react";
import { AppState } from "react-native";
import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth/store";
import { halaqaKeys } from "@/lib/halaqa/api";
import { deleteOwnAvatarFiles, fetchProfilePrivacy, profilePrivacyKeys } from "@/lib/profile/privacy";
import { captureSocialOwner, requireSocialOwner } from "@/lib/social/owner";
import { socialFailureOf } from "@/lib/social/remote";
import { isSupabaseConfigured } from "@/lib/supabase";

// Accounts that had no photo files left during their current minority in this app session.
const cleaned = new Set<string>();
// One cleanup at a time per account.
const running = new Map<string, Promise<boolean>>();
// Bumped when an account is known not to be a minor, so a cleanup that started before cannot mark a
// later minority as cleaned.
const minorities = new Map<string, number>();

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
  const minority = minorities.get(userId) ?? 0;
  const run: Promise<boolean> = (async () => {
    const owner = captureSocialOwner(userId);
    if (!owner) return false;
    await deleteOwnAvatarFiles(owner);
    if ((minorities.get(userId) ?? 0) === minority) cleaned.add(userId);
    return true;
  })().finally(() => {
    if (running.get(userId) === run) running.delete(userId);
  });
  running.set(userId, run);
  return run;
}

/**
 * The account is not a minor now, so its finished cleanup belongs to a past minority. A later one,
 * recorded on this or another device whose last photo pass was cut short, gets a fresh cleanup.
 */
export function forgetMinorPhotoCleanup(userId: string): void {
  cleaned.delete(userId);
  running.delete(userId);
  minorities.set(userId, (minorities.get(userId) ?? 0) + 1);
}

/**
 * How long the account's own privacy counts as current. Another device can record minority, and its
 * last photo pass can be cut short, so a return to the foreground or a reconnect reads it again once
 * this copy is older than this, or when the last read failed. While reads succeed, that is at most
 * six an hour.
 */
export const OWN_PRIVACY_REVALIDATE_MS = 10 * 60_000;

/**
 * Watches the signed-in account's own privacy. While it is a minor, leftover photo files are removed
 * once per app session, again on returning to the foreground or reconnecting after a failure, and
 * halaqa lists reload, since recording minority leaves matched halaqas. The board and halaqa screens
 * invalidate the privacy key after they change it, which refetches it here. Mount once.
 */
export function useMinorPhotoCleanup(): void {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  const privacy = useQuery({
    queryKey: profilePrivacyKeys.mine(userId),
    queryFn: async () => {
      const read = await fetchProfilePrivacy(requireSocialOwner(userId ?? ""));
      // Known as an adult as soon as a read says so, even if a later read lands before a render.
      if (userId && !read.isMinor) forgetMinorPhotoCleanup(userId);
      return read;
    },
    enabled: userId !== null && isSupabaseConfigured(),
    retry: false,
    staleTime: OWN_PRIVACY_REVALIDATE_MS,
    // lib/query/native-lifecycle.ts reports foreground and network changes on native.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const isMinor = privacy.data?.isMinor === true;
  const knownAdult = privacy.data?.isMinor === false;

  useEffect(() => {
    if (userId && knownAdult) forgetMinorPhotoCleanup(userId);
  }, [userId, knownAdult]);

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
    // A cleanup cut short offline finishes on reconnect. One that succeeded costs nothing.
    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (online) run();
    });
    return () => {
      appState.remove();
      unsubscribeOnline();
    };
  }, [queryClient, userId, isMinor]);
}
