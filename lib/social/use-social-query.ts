import { useNetInfo } from "@react-native-community/netinfo";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { loadWithSocialCache, type SocialSnapshot } from "@/lib/social/cache";
import type { SocialRead } from "@/lib/social/remote";

export function useIsOffline(): boolean {
  const net = useNetInfo();
  return net.isConnected === false || net.isInternetReachable === false;
}

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
