import { useNetInfo } from "@react-native-community/netinfo";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { loadWithSocialCache, type SocialSnapshot } from "@/lib/social/cache";
import type { SocialRead } from "@/lib/social/remote";

/** NetInfo reports null before its first probe; only a definite "not connected" counts as offline. */
export function useIsOffline(): boolean {
  const net = useNetInfo();
  return net.isConnected === false || net.isInternetReachable === false;
}

/**
 * A remote social read with the offline copy from lib/social/cache.ts. Runs in every network mode so
 * the saved copy shows offline instead of a paused query. The key must include the viewer's id.
 */
export function useSocialQuery<T>(options: {
  queryKey: QueryKey;
  userId: string | null;
  cacheName: string;
  read: SocialRead<T> | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  const offline = useIsOffline();
  const { userId, read } = options;
  return useQuery<SocialSnapshot<T>>({
    queryKey: [...options.queryKey, offline ? "offline" : "online"],
    queryFn: () => {
      if (!userId || !read) throw new Error("A signed-in account and a read are required");
      return loadWithSocialCache({ userId, name: options.cacheName, read, offline });
    },
    enabled: Boolean(userId) && Boolean(read) && (options.enabled ?? true),
    networkMode: "always",
    staleTime: options.staleTime ?? 60_000,
    retry: false,
  });
}
