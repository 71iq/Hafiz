import type { Query, QueryClient } from "@tanstack/react-query";
import { authCommands } from "@/lib/auth/commands";
import type { AuthOwner } from "@/lib/auth/coordinator";
import { useAuthStore } from "@/lib/auth/store";
import { reflectionQueryKeys } from "@/lib/reflections/query-keys";

const viewerRoots = [
  reflectionQueryKeys.feed.all[0],
  reflectionQueryKeys.reflections.all[0],
  reflectionQueryKeys.comments.all[0],
  // A count includes the viewer's own private reflections, so it goes with the account.
  reflectionQueryKeys.countAyah({ surah: 0, ayah: 0 })[0],
  "currentUserPublicAchievementUnlocks",
];
const cacheOwners = new WeakMap<QueryClient, { owner: AuthOwner; status: "refreshing" | "complete" | "incomplete" }>();
const viewerQuery = (query: Query) => viewerRoots.some((root) => root === query.queryKey[0]);

export function bindAuthQueryCache(client: QueryClient): () => void {
  const refresh = () => {
    const previous = cacheOwners.get(client);
    if (previous && previous.owner.isCurrent() && previous.status !== "incomplete") return;
    const owner = authCommands.captureOwner();
    const binding: { owner: AuthOwner; status: "refreshing" | "complete" | "incomplete" } = {
      owner,
      status: "refreshing",
    };
    cacheOwners.set(client, binding);
    try {
      const cache = client.getQueryCache();
      const queries = cache.findAll({ predicate: viewerQuery });
      let failure: { error: unknown } | undefined;
      try {
        // Detach the entire snapshot before any abort or cache notification can admit new work.
        cache.removeMany(queries);
      } catch (error) {
        failure = { error };
      }
      for (const query of queries) {
        if (cache.get(query.queryHash) === query) continue;
        try {
          query.reset();
        } catch (error) {
          failure ??= { error };
        }
      }
      if (failure) throw failure.error;
      // Retirement finishes after unbind; a same-owner rebind must preserve its fresh replacements.
      if (owner.isCurrent() && cacheOwners.get(client) === binding) binding.status = "complete";
    } finally {
      if (binding.status === "refreshing") binding.status = "incomplete";
    }
  };
  const unsubscribe = useAuthStore.subscribe(refresh);
  try {
    refresh();
    return unsubscribe;
  } catch (error) {
    unsubscribe();
    throw error;
  }
}
