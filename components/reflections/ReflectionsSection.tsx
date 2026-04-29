import { useState, useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import { ChevronDown, ChevronUp, PenLine, MessageSquare } from "lucide-react-native";
import { ReflectionsSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { isSupabaseConfigured } from "@/lib/supabase";
import { fetchReflections, fetchReflectionCount } from "@/lib/reflections/api";
import { ReflectionCard } from "./ReflectionCard";
import { CommentsSheet } from "./CommentsSheet";
import { WriteReflectionSheet } from "./WriteReflectionSheet";
import type { Reflection } from "@/lib/reflections/types";

type Props = {
  surah: number;
  ayah: number;
  initiallyExpanded?: boolean;
  showHeader?: boolean;
};

export function ReflectionsSection({ surah, ayah, initiallyExpanded = false, showHeader = true }: Props) {
  const { isDark } = useSettings();
  const s = useStrings();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [page, setPage] = useState(0);
  const [allReflections, setAllReflections] = useState<Reflection[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [commentsReflectionId, setCommentsReflectionId] = useState<string | null>(null);
  const [writeOpen, setWriteOpen] = useState(false);

  if (!isSupabaseConfigured()) return null;

  const chevronColor = isDark ? "#525252" : "#DFD9D1";
  const mutedColor = isDark ? "#737373" : "#A39B93";

  // Fetch count (always, for badge)
  const { data: count = 0 } = useQuery({
    queryKey: ["reflectionCount", surah, ayah],
    queryFn: () => fetchReflectionCount(surah, ayah),
    staleTime: 1000 * 60 * 5,
  });

  // Fetch first page when expanded
  const { isLoading } = useQuery({
    queryKey: ["reflections", surah, ayah, 0],
    queryFn: async () => {
      const result = await fetchReflections(surah, ayah, 0, user?.id);
      setAllReflections(result.data);
      setHasMore(result.hasMore);
      setPage(0);
      return result;
    },
    enabled: expanded,
    staleTime: 1000 * 60 * 5,
  });

  const handleLoadMore = useCallback(async () => {
    const nextPage = page + 1;
    try {
      const result = await fetchReflections(surah, ayah, nextPage, user?.id);
      setAllReflections((prev) => [...prev, ...result.data]);
      setHasMore(result.hasMore);
      setPage(nextPage);
    } catch (e) {
      console.warn("[Reflections] Load more failed:", e);
    }
  }, [surah, ayah, page, user?.id]);

  const handleLikeToggled = useCallback(
    (reflectionId: string, liked: boolean, delta: number) => {
      setAllReflections((prev) =>
        prev.map((r) =>
          r.id === reflectionId
            ? { ...r, user_has_liked: liked, likes_count: r.likes_count + delta }
            : r
        )
      );
    },
    []
  );

  const handleCommentAdded = useCallback(
    (reflectionId: string) => {
      setAllReflections((prev) =>
        prev.map((r) =>
          r.id === reflectionId
            ? { ...r, comments_count: r.comments_count + 1 }
            : r
        )
      );
    },
    []
  );

  const handleWriteSuccess = useCallback(() => {
    // Invalidate and refetch
    queryClient.invalidateQueries({ queryKey: ["reflections", surah, ayah] });
    queryClient.invalidateQueries({ queryKey: ["reflectionCount", surah, ayah] });
  }, [queryClient, surah, ayah]);

  return (
    <>
      {showHeader && (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          className="flex-row items-center justify-between py-2.5"
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
              <View className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-2 py-0.5">
                <Text
                  className="text-primary-accent dark:text-primary-bright"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10 }}
                >
                  {count}
                </Text>
              </View>
            )}
          </View>
          {expanded ? (
            <ChevronUp size={14} color={chevronColor} />
          ) : (
            <ChevronDown size={14} color={chevronColor} />
          )}
        </Pressable>
      )}

      {/* Expanded content */}
      {expanded && (
        <View className="pb-3">
          {isLoading ? (
            <ReflectionsSkeleton isDark={isDark} />
          ) : allReflections.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title={s.reflectionEmpty}
              subtitle={s.reflectionBeFirst}
              isDark={isDark}
            />
          ) : (
            allReflections.map((r) => (
              <ReflectionCard
                key={r.id}
                reflection={r}
                onLikeToggled={handleLikeToggled}
                onCommentsPress={setCommentsReflectionId}
              />
            ))
          )}

          {/* Load more */}
          {hasMore && (
            <Pressable
              onPress={handleLoadMore}
              className="items-center py-2"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
              >
                {s.reflectionLoadMore}
              </Text>
            </Pressable>
          )}

          {/* Write reflection button */}
          <Pressable
            onPress={() => setWriteOpen(true)}
            className="flex-row items-center justify-center gap-2 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 py-2.5 mt-1"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <PenLine size={14} color={isDark ? "#5eead4" : "#003638"} />
            <Text
              className="text-primary-accent dark:text-primary-bright"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
            >
              {s.reflectionWrite}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Comments sub-sheet */}
      <CommentsSheet
        reflectionId={commentsReflectionId}
        onClose={() => setCommentsReflectionId(null)}
        onCommentAdded={handleCommentAdded}
      />

      {/* Write reflection sheet */}
      <WriteReflectionSheet
        open={writeOpen}
        onClose={() => setWriteOpen(false)}
        surah={surah}
        ayahStart={ayah}
        ayahEnd={ayah}
        ayahPreview={`${surah}:${ayah}`}
        onSuccess={handleWriteSuccess}
      />
    </>
  );
}
