import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { reflectionQueryKeys } from "./query-keys";
import type { Reflection, ReflectionComment } from "./types";

type Page<T> = { data: T[]; hasMore: boolean };

/**
 * Drops matching rows from a cached page or infinite list, keeping page count and order so the
 * feed keeps its pagination and scroll position. Unknown shapes pass through untouched.
 */
function withoutRows<T extends { id: string }>(value: unknown, keep: (row: T) => boolean): unknown {
  if (!value || typeof value !== "object") return value;
  if ("pages" in value && Array.isArray((value as InfiniteData<Page<T>>).pages)) {
    const infinite = value as InfiniteData<Page<T>>;
    let changed = false;
    const pages = infinite.pages.map((page) => {
      if (!page || !Array.isArray(page.data)) return page;
      const data = page.data.filter(keep);
      if (data.length === page.data.length) return page;
      changed = true;
      return { ...page, data };
    });
    return changed ? { ...infinite, pages } : value;
  }
  if ("data" in value && Array.isArray((value as Page<T>).data)) {
    const page = value as Page<T>;
    const data = page.data.filter(keep);
    return data.length === page.data.length ? value : { ...page, data };
  }
  return value;
}

function ayahsOf(reflection: Pick<Reflection, "surah" | "ayah_start" | "ayah_end">): number[] {
  const ayahs: number[] = [];
  for (let ayah = reflection.ayah_start; ayah <= reflection.ayah_end; ayah++) ayahs.push(ayah);
  return ayahs;
}

/**
 * After the server confirmed deleting a reflection: remove it from every cached feed and ayah list
 * and forget its comments, then refetch the affected lists and counts in place. Call only with a
 * confirmed `true` result for the current owner; a `false` result uses refreshReflectionQueries.
 */
export function removeDeletedReflection(queryClient: QueryClient, reflection: Reflection): void {
  const keep = (row: Reflection) => row.id !== reflection.id;
  queryClient.setQueriesData({ queryKey: reflectionQueryKeys.feed.all }, (value: unknown) => withoutRows(value, keep));
  queryClient.setQueriesData({ queryKey: reflectionQueryKeys.reflections.all }, (value: unknown) =>
    withoutRows(value, keep),
  );
  queryClient.removeQueries({ queryKey: reflectionQueryKeys.comments.forReflection(reflection.id) });
  refreshReflectionQueries(queryClient, reflection);
}

/**
 * Refreshes the lists and counts that can show this reflection. Infinite lists refetch the pages
 * already loaded, so pagination is not reset.
 */
export function refreshReflectionQueries(queryClient: QueryClient, reflection: Reflection): void {
  void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.feed.all });
  for (const ayah of ayahsOf(reflection)) {
    void queryClient.invalidateQueries({
      queryKey: reflectionQueryKeys.reflections.ayah({ surah: reflection.surah, ayah }),
    });
    void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.countAyah({ surah: reflection.surah, ayah }) });
  }
  void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.comments.forReflection(reflection.id) });
}

/**
 * After the server confirmed deleting a comment: drop it from that reflection's cached comment
 * lists, then refresh them and mark lists that show the parent's comment count stale. The feed is
 * not refetched now, so a post does not move under the reader; the caller adjusts the count shown.
 */
export function removeDeletedComment(
  queryClient: QueryClient,
  comment: Pick<ReflectionComment, "id" | "reflection_id">,
) {
  const keep = (row: ReflectionComment) => row.id !== comment.id;
  const key = reflectionQueryKeys.comments.forReflection(comment.reflection_id);
  queryClient.setQueriesData({ queryKey: key }, (value: unknown) => withoutRows(value, keep));
  markCommentCountStale(queryClient, comment.reflection_id);
}

/** Refetches the reflection's comments and marks cached counts stale without moving the feed. */
export function markCommentCountStale(queryClient: QueryClient, reflectionId: string) {
  void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.comments.forReflection(reflectionId) });
  void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.feed.all, refetchType: "none" });
  void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.reflections.all, refetchType: "none" });
}
