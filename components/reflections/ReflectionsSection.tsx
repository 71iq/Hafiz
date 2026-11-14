import { reflectionQueryKeys } from "@/lib/reflections/query-keys";
import { useState, useCallback, useRef, useMemo } from "react";
import { ActivityIndicator, View, Text, Pressable } from "react-native";
import { ChevronDown, ChevronUp, PenLine, MessageSquare } from "lucide-react-native";
import { router, type Href } from "expo-router";
import { ReflectionsSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { formatAyahRef } from "@/lib/arabic";
import { useStrings } from "@/lib/i18n/useStrings";
import { isSupabaseConfigured } from "@/lib/supabase";
import { fetchReflections, fetchReflectionCount } from "@/lib/reflections/api";
import { ReflectionCard } from "./ReflectionCard";
import { CommentsSheet } from "./CommentsSheet";
import { WriteReflectionSheet } from "./WriteReflectionSheet";
import { useReflectionMutationScope } from "./use-mutation-scope";
import type { Reflection } from "@/lib/reflections/types";

type Props = {
  surah: number;
  ayah: number;
  initiallyExpanded?: boolean;
  showHeader?: boolean;
  /** Called before the section navigates away, so the sheet that shows it can close first. */
  onNavigate?: () => void;
};

export function ReflectionsSection(props: Props) {
  const user = useAuthStore((s) => s.user);
  return <ReflectionsSectionContent key={JSON.stringify([props.surah, props.ayah, user?.id])} {...props} user={user} />;
}

function ReflectionsSectionContent({
  surah,
  ayah,
  initiallyExpanded = false,
  showHeader = true,
  onNavigate,
  user,
}: Props & { user: ReturnType<typeof useAuthStore.getState>["user"] }) {
  const { isDark, isRTL, themeColors } = useSettings();
  const s = useStrings();
  const { begin, pending } = useReflectionMutationScope(JSON.stringify([surah, ayah]), user?.id);
  const firstPageGeneration = useRef(0);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [page, setPage] = useState(0);
  const [loadedReflections, setAllReflections] = useState<Reflection[] | null>(null);
  const [loadedHasMore, setHasMore] = useState<boolean | null>(null);
  const loadingMore = pending.has("page");
  const [error, setError] = useState<string | null>(null);
  const [commentsReflectionId, setCommentsReflectionId] = useState<string | null>(null);
  const [writeOpen, setWriteOpen] = useState(false);
  const supabaseConfigured = isSupabaseConfigured();

  const chevronColor = isDark ? "#525252" : "#DFD9D1";

  // Fetch count (always, for badge)
  const { data: count = 0 } = useQuery({
    queryKey: reflectionQueryKeys.count({ surah, ayah, viewerId: user?.id }),
    queryFn: () => fetchReflectionCount(surah, ayah),
    enabled: supabaseConfigured,
    staleTime: 1000 * 60 * 5,
  });

  // Fetch first page when expanded
  const {
    data: firstPage,
    isLoading,
    isFetching,
    error: reflectionsError,
    refetch: refetchReflections,
  } = useQuery({
    queryKey: reflectionQueryKeys.reflections.firstPage({ surah, ayah, viewerId: user?.id }),
    queryFn: async () => {
      const generation = ++firstPageGeneration.current;
      const result = await fetchReflections(surah, ayah, 0, user?.id);
      if (generation !== firstPageGeneration.current) return result;
      setError(null);
      setAllReflections(result.data);
      setHasMore(result.hasMore);
      setPage(0);
      return result;
    },
    enabled: supabaseConfigured && expanded,
    staleTime: 1000 * 60 * 5,
  });

  const allReflections = useMemo(
    () => loadedReflections ?? firstPage?.data ?? [],
    [loadedReflections, firstPage?.data],
  );
  const hasMore = loadedHasMore ?? firstPage?.hasMore ?? false;

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || isFetching) return;
    const lease = begin("page");
    if (!lease) return;
    const nextPage = page + 1,
      generation = firstPageGeneration.current;
    setError(null);
    try {
      const result = await fetchReflections(surah, ayah, nextPage, user?.id);
      if (!lease.isCurrent() || generation !== firstPageGeneration.current) return;
      setAllReflections((prev) => {
        const rows = prev ?? firstPage?.data ?? [],
          ids = new Set(rows.map((row) => row.id));
        return [
          ...rows,
          ...result.data.filter((row) => {
            if (ids.has(row.id)) return false;
            ids.add(row.id);
            return true;
          }),
        ];
      });
      setHasMore(result.hasMore);
      setPage(nextPage);
    } catch (error) {
      if (lease.isCurrent() && generation === firstPageGeneration.current) {
        console.warn("[Reflections] Load more failed:", error);
        setError(s.reflectionLoadFailed);
      }
    } finally {
      lease.release();
    }
  }, [surah, ayah, page, user?.id, hasMore, isFetching, begin, s.reflectionLoadFailed, firstPage?.data]);

  const handleLikeToggled = useCallback(
    (reflectionId: string, liked: boolean, delta: number) => {
      setAllReflections((prev) =>
        (prev ?? firstPage?.data ?? []).map((r) =>
          r.id === reflectionId && (r.user_has_liked ?? false) !== liked
            ? { ...r, user_has_liked: liked, likes_count: Math.max(0, r.likes_count + delta) }
            : r,
        ),
      );
    },
    [firstPage?.data],
  );

  const handleCommentAdded = useCallback(
    (reflectionId: string) => {
      const base = allReflections.find((row) => row.id === reflectionId)?.comments_count;
      setAllReflections((prev) =>
        (prev ?? firstPage?.data ?? []).map((row) =>
          row.id === reflectionId && row.comments_count === base
            ? { ...row, comments_count: row.comments_count + 1 }
            : row,
        ),
      );
    },
    [allReflections, firstPage?.data],
  );

  if (!supabaseConfigured) return null;

  return (
    <>
      {showHeader && (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          className="flex-row items-center justify-between rounded-2xl px-4 py-3"
          style={{ backgroundColor: themeColors.surfaceLow }}
        >
          <View className="flex-row items-center gap-2">
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{
                fontFamily: "Manrope_600SemiBold",
                fontSize: 10,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              {s.reflections}
            </Text>
            {count > 0 && (
              <View className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-2.5 py-1">
                <Text
                  className="text-primary-accent dark:text-primary-bright"
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 10 }}
                >
                  {count}
                </Text>
              </View>
            )}
          </View>
          {expanded ? <ChevronUp size={14} color={chevronColor} /> : <ChevronDown size={14} color={chevronColor} />}
        </Pressable>
      )}

      {/* Expanded content */}
      {expanded && (
        <View className="pb-3 pt-3">
          {isLoading ? (
            <ReflectionsSkeleton isDark={isDark} />
          ) : reflectionsError ? (
            <EmptyState
              icon={MessageSquare}
              title={s.reflectionLoadFailed}
              actionLabel={s.errorTryAgain}
              onAction={() => refetchReflections()}
              isDark={isDark}
            />
          ) : allReflections.length === 0 ? (
            <EmptyState icon={MessageSquare} title={s.reflectionEmpty} subtitle={s.reflectionBeFirst} isDark={isDark} />
          ) : (
            allReflections.map((r) => (
              <ReflectionCard
                key={r.id}
                reflection={r}
                onLikeToggled={handleLikeToggled}
                onCommentsPress={setCommentsReflectionId}
                onAuthRequired={() => {
                  onNavigate?.();
                  router.push("/auth/login");
                }}
                onNavigate={onNavigate}
              />
            ))
          )}

          {/* Load more */}
          {hasMore && (
            <Pressable
              onPress={handleLoadMore}
              disabled={loadingMore}
              className="items-center py-2.5"
              style={({ pressed }) => ({ opacity: pressed || loadingMore ? 0.6 : 1 })}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color={isDark ? "#5eead4" : "#003638"} />
              ) : (
                <Text
                  className="text-primary-accent dark:text-primary-bright"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                >
                  {s.reflectionLoadMore}
                </Text>
              )}
            </Pressable>
          )}
          {error && (
            <Text
              className="py-2 text-center text-red-600 dark:text-red-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
            >
              {error}
            </Text>
          )}

          <Pressable
            onPress={() => {
              onNavigate?.();
              router.push("/reflection-feed" as Href);
            }}
            className="items-center py-2.5"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
            >
              {s.reflectionFeedSeeAll}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setWriteOpen(true)}
            className="flex-row items-center justify-center gap-2 rounded-full py-3.5 mt-1"
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              backgroundColor: isDark ? "#0D4B4D" : "#003638",
            })}
          >
            <PenLine size={15} color="#FDDC91" />
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: "#FDDC91" }}>
              {s.reflectionWrite}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Comments sub-sheet */}
      <CommentsSheet
        reflectionId={commentsReflectionId}
        onClose={() => setCommentsReflectionId(null)}
        onNavigate={onNavigate}
        onCommentAdded={handleCommentAdded}
      />

      {/* Write reflection sheet */}
      <WriteReflectionSheet
        open={writeOpen}
        onClose={() => setWriteOpen(false)}
        onNavigate={onNavigate}
        surah={surah}
        ayahStart={ayah}
        ayahEnd={ayah}
        ayahPreview={formatAyahRef(isRTL, surah, ayah)}
      />
    </>
  );
}
