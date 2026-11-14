import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth/store";
import { halaqaKeys } from "@/lib/halaqa/api";
import { deleteOwnAvatarFiles, fetchProfilePrivacy, profilePrivacyKeys } from "@/lib/profile/privacy";
import { captureSocialOwner, requireSocialOwner } from "@/lib/social/owner";
import { socialFailureOf } from "@/lib/social/remote";
import { isSupabaseConfigured } from "@/lib/supabase";

// For each account, the privacy read (its update time) that a finished cleanup covered. A newer read
// that still says minor runs the cleanup again: another device may have withdrawn minority, uploaded
// a photo and recorded minority again while this device never saw the adult read in between.
const cleaned = new Map<string, number>();
// One cleanup at a time per account, with the read it covers.
const running = new Map<string, { readAt: number; run: Promise<boolean> }>();
// Bumped when an account is known not to be a minor, so a cleanup that started before cannot mark a
// later minority as cleaned.
const minorities = new Map<string, number>();

/**
 * ETH-07: removes the photo files a minor account still has in the public avatars bucket, once per
 * privacy read that says minor (`readAt`, the read's update time; 0 for a caller without one).
 * Recording minority deletes them already; this finishes a pass that a crash, a lost connection, an
 * account switch or another device's interrupted pass left behind. It runs as that account and stops
 * when the account changes. When nothing is left it costs one list request, and the privacy read it
 * follows is revalidated at most every OWN_PRIVACY_REVALIDATE_MS. Resolves false when the account is
 * no longer signed in.
 */
export function cleanUpMinorPhotos(userId: string, readAt = 0): Promise<boolean> {
  if ((cleaned.get(userId) ?? -1) >= readAt) return Promise.resolve(true);
  const minority = minorities.get(userId) ?? 0;
  const current = running.get(userId);
  if (current) {
    if (current.readAt >= readAt) return current.run;
    // A newer read came while an older cleanup runs: run again once it settles, whether it finished
    // or failed, so a transient failure of the older pass does not drop the newer read's cleanup. Not
    // once the account is known not to be a minor since: its photos are an adult's again.
    const again = () => ((minorities.get(userId) ?? 0) === minority ? cleanUpMinorPhotos(userId, readAt) : Promise.resolve(true));
    return current.run.then(again, again);
  }
  const run: Promise<boolean> = (async () => {
    const owner = captureSocialOwner(userId);
    if (!owner) return false;
    await deleteOwnAvatarFiles(owner, {
      // Files found: before deleting any, the account must still be a minor, here and on the server.
      // Another device may have withdrawn minority and uploaded a photo since this device's read.
      beforeRemove: async () => {
        if ((minorities.get(userId) ?? 0) !== minority) return false;
        const fresh = await fetchProfilePrivacy(owner);
        if (!fresh.isMinor) {
          forgetMinorPhotoCleanup(userId);
          return false;
        }
        return (minorities.get(userId) ?? 0) === minority;
      },
    });
    if ((minorities.get(userId) ?? 0) === minority) cleaned.set(userId, Math.max(readAt, cleaned.get(userId) ?? -1));
    return true;
  })().finally(() => {
    if (running.get(userId)?.run === run) running.delete(userId);
  });
  running.set(userId, { readAt, run });
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
 * after each fresh privacy read, again on returning to the foreground or reconnecting after a
 * failure, and halaqa lists reload, since recording minority leaves matched halaqas. The board and
 * halaqa screens invalidate the privacy key after they change it, which refetches it here. Mount once.
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
  const readAt = privacy.dataUpdatedAt;
  const latestRead = useRef(readAt);
  latestRead.current = readAt;

  useEffect(() => {
    if (userId && knownAdult) forgetMinorPhotoCleanup(userId);
  }, [userId, knownAdult]);

  // Recording minority leaves matched halaqas, so the lists reload once when minority is seen.
  useEffect(() => {
    if (userId && isMinor) void queryClient.invalidateQueries({ queryKey: halaqaKeys.all(userId) });
  }, [queryClient, userId, isMinor]);

  useEffect(() => {
    if (!userId || !isMinor) return;
    const run = () => {
      cleanUpMinorPhotos(userId, latestRead.current).catch((error: unknown) => {
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
    // A cleanup cut short offline finishes on reconnect. One that already covered this read costs nothing.
    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (online) run();
    });
    return () => {
      appState.remove();
      unsubscribeOnline();
    };
  }, [userId, isMinor, readAt]);
}
