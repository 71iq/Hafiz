import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth/store";
import { halaqaKeys } from "@/lib/halaqa/api";
import { deleteOwnAvatarFiles, fetchProfilePrivacy, profilePrivacyKeys } from "@/lib/profile/privacy";
import { captureSocialOwner, requireSocialOwner } from "@/lib/social/owner";
import { socialFailureOf } from "@/lib/social/remote";
import { isSupabaseConfigured } from "@/lib/supabase";

const cleaned = new Map<string, number>();
const running = new Map<string, { readAt: number; run: Promise<boolean> }>();
const minorities = new Map<string, number>();

export function cleanUpMinorPhotos(userId: string, readAt = 0): Promise<boolean> {
  if ((cleaned.get(userId) ?? -1) >= readAt) return Promise.resolve(true);
  const minority = minorities.get(userId) ?? 0;
  const current = running.get(userId);
  if (current) {
    if (current.readAt >= readAt) return current.run;
    const again = () => ((minorities.get(userId) ?? 0) === minority ? cleanUpMinorPhotos(userId, readAt) : Promise.resolve(true));
    return current.run.then(again, again);
  }
  const run: Promise<boolean> = (async () => {
    const owner = captureSocialOwner(userId);
    if (!owner) return false;
    await deleteOwnAvatarFiles(owner, {
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

export function forgetMinorPhotoCleanup(userId: string): void {
  cleaned.delete(userId);
  running.delete(userId);
  minorities.set(userId, (minorities.get(userId) ?? 0) + 1);
}

export const OWN_PRIVACY_REVALIDATE_MS = 10 * 60_000;

export function useMinorPhotoCleanup(): void {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  const privacy = useQuery({
    queryKey: profilePrivacyKeys.mine(userId),
    queryFn: async () => {
      const read = await fetchProfilePrivacy(requireSocialOwner(userId ?? ""));
      if (userId && !read.isMinor) forgetMinorPhotoCleanup(userId);
      return read;
    },
    enabled: userId !== null && isSupabaseConfigured(),
    retry: false,
    staleTime: OWN_PRIVACY_REVALIDATE_MS,
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
    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (online) run();
    });
    return () => {
      appState.remove();
      unsubscribeOnline();
    };
  }, [userId, isMinor, readAt]);
}
