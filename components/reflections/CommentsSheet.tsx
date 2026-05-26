import { useState, useCallback, useEffect, useMemo } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { ChevronDown, Send } from "lucide-react-native";
import { router } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { fetchComments, addComment } from "@/lib/reflections/api";
import type { Reflection, ReflectionComment, ReflectionCommentSort } from "@/lib/reflections/types";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Input } from "@/components/ui/Input";
import { ProfileIdentity } from "@/components/profile/ProfileIdentity";
import { ReflectionCard } from "./ReflectionCard";

type Props = {
  reflectionId: string | null;
  reflection?: Reflection | null;
  referenceLabel?: string;
  showReference?: boolean;
  onReferencePress?: (reflection: Reflection) => void;
  onLikeToggled?: (reflectionId: string, liked: boolean, delta: number) => void;
  onAuthRequired?: () => void;
  onClose: () => void;
  onCommentAdded: (reflectionId: string) => void;
};

function relativeTime(dateStr: string, justNowLabel: string, locale: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return justNowLabel;
  try {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    if (diff < 3600) return formatter.format(-Math.floor(diff / 60), "minute");
    if (diff < 86400) return formatter.format(-Math.floor(diff / 3600), "hour");
    if (diff < 604800) return formatter.format(-Math.floor(diff / 86400), "day");
  } catch {
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  }
  return new Date(dateStr).toLocaleDateString(locale);
}

function sortComments(comments: ReflectionComment[], sort: ReflectionCommentSort): ReflectionComment[] {
  const sorted = [...comments];
  const createdAt = (comment: ReflectionComment) => new Date(comment.created_at).getTime();
  if (sort === "newest") return sorted.sort((a, b) => createdAt(b) - createdAt(a));
  if (sort === "popular") {
    return sorted.sort((a, b) => {
      const likesDelta = (b.likes_count ?? 0) - (a.likes_count ?? 0);
      return likesDelta !== 0 ? likesDelta : createdAt(b) - createdAt(a);
    });
  }
  return sorted.sort((a, b) => createdAt(a) - createdAt(b));
}

export function CommentsSheet({
  reflectionId,
  reflection,
  referenceLabel,
  showReference = false,
  onReferencePress,
  onLikeToggled,
  onAuthRequired,
  onClose,
  onCommentAdded,
}: Props) {
  const { isDark, isRTL, uiLanguage, themeColors } = useSettings();
  const s = useStrings();
  const user = useAuthStore((s) => s.user);
  const [localComments, setLocalComments] = useState<ReflectionComment[]>([]);
  const [sort, setSort] = useState<ReflectionCommentSort>("oldest");
  const [sortOpen, setSortOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortOptions = useMemo<{ value: ReflectionCommentSort; label: string }[]>(
    () => [
      { value: "popular", label: s.commentSortPopular },
      { value: "oldest", label: s.commentSortOldest },
      { value: "newest", label: s.commentSortNewest },
    ],
    [s.commentSortNewest, s.commentSortOldest, s.commentSortPopular]
  );
  const selectedSortLabel = sortOptions.find((option) => option.value === sort)?.label ?? s.commentSortOldest;

  const commentsQuery = useInfiniteQuery({
    queryKey: ["reflectionComments", reflectionId, sort],
    queryFn: ({ pageParam }) => fetchComments(reflectionId ?? "", pageParam, sort),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length : undefined),
    enabled: !!reflectionId,
    staleTime: 1000 * 60,
  });

  const loadedComments = useMemo(
    () => commentsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [commentsQuery.data]
  );

  const comments = useMemo(() => {
    const loadedIds = new Set(loadedComments.map((comment) => comment.id));
    return sortComments([...loadedComments, ...localComments.filter((comment) => !loadedIds.has(comment.id))], sort);
  }, [loadedComments, localComments, sort]);

  useEffect(() => {
    setLocalComments([]);
    setText("");
    setError(null);
    setSortOpen(false);
  }, [reflectionId]);

  useEffect(() => {
    if (commentsQuery.error) {
      console.warn("[Comments] Failed to load:", commentsQuery.error);
      setError(s.commentLoadFailed);
    }
  }, [commentsQuery.error, s.commentLoadFailed]);

  const handleSubmit = useCallback(async () => {
    if (!user || !reflectionId || !text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const comment = await addComment(user.id, reflectionId, text.trim());
      setLocalComments((prev) => [...prev, comment]);
      setText("");
      onCommentAdded(reflectionId);
    } catch (e) {
      console.warn("[Comments] Failed to add:", e);
      setError(s.commentPostFailed);
    } finally {
      setSubmitting(false);
    }
  }, [user, reflectionId, text, onCommentAdded, s.commentPostFailed]);

  const handleLoadMore = useCallback(async () => {
    setError(null);
    try {
      await commentsQuery.fetchNextPage();
    } catch (e) {
      console.warn("[Comments] Failed to load more:", e);
      setError(s.commentLoadFailed);
    }
  }, [commentsQuery, s.commentLoadFailed]);

  const mutedColor = isDark ? "#737373" : "#A39B93";
  const openProfile = useCallback(
    (commentUserId: string) => {
      router.push(commentUserId === user?.id ? "/profile" as any : `/profile/${commentUserId}` as any);
    },
    [user?.id]
  );

  return (
    <>
    <ResponsiveSheet open={!!reflectionId} onClose={onClose} maxWidth={760} dir={isRTL ? "rtl" : "ltr"} avoidKeyboard>
      <OverlayHeader title={reflection ? s.reflectionPostTitle : s.reflectionComments} subtitle={s.reflections} onClose={onClose} showHandle isRTL={isRTL} />
      <View className="flex-1 min-h-0">
        <OverlayBody className="flex-1 min-h-0" contentContainerClassName="px-5 pt-4 pb-3">
          {reflection ? (
            <ReflectionCard
              reflection={reflection}
              variant="feed"
              showReference={showReference}
              referenceLabel={referenceLabel}
              onReferencePress={onReferencePress}
              onCommentsPress={() => {}}
              onLikeToggled={onLikeToggled ?? (() => {})}
              onAuthRequired={onAuthRequired}
            />
          ) : null}

          <View className="mb-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.commentSortBy}
              onPress={() => setSortOpen((open) => !open)}
              className={`items-center justify-between gap-2 rounded-full px-3.5 py-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
              style={({ pressed }) => ({
                backgroundColor: themeColors.surfaceLow,
                borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,54,56,0.08)",
                borderWidth: 1,
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <Text
                className="text-charcoal dark:text-neutral-200"
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  fontSize: 12,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {`${s.commentSortBy}: ${selectedSortLabel}`}
              </Text>
              <ChevronDown size={15} color={mutedColor} />
            </Pressable>
            {sortOpen ? (
              <View
                className="mt-2 overflow-hidden rounded-2xl"
                style={{
                  backgroundColor: themeColors.surfaceBright,
                  borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,54,56,0.08)",
                  borderWidth: 1,
                }}
              >
                {sortOptions.map((option, index) => {
                  const active = option.value === sort;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => {
                        setSort(option.value);
                        setSortOpen(false);
                      }}
                      className="px-4 py-3"
                      style={({ pressed }) => ({
                        backgroundColor: active
                          ? isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.08)"
                          : "transparent",
                        borderTopWidth: index === 0 ? 0 : 1,
                        borderTopColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,54,56,0.06)",
                        opacity: pressed ? 0.72 : 1,
                      })}
                    >
                      <Text
                        className={active ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-200"}
                        style={{
                          fontFamily: active ? "Manrope_700Bold" : "Manrope_500Medium",
                          fontSize: 13,
                          textAlign: isRTL ? "right" : "left",
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>

          {error ? (
            <Text
              className="mb-3 text-red-600 dark:text-red-400"
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 12,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {error}
            </Text>
          ) : null}

          {commentsQuery.isLoading ? (
            <ActivityIndicator style={{ padding: 20 }} />
          ) : comments.length === 0 ? (
            <Text
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 13,
                color: mutedColor,
                textAlign: "center",
                padding: 20,
              }}
            >
              {s.reflectionNoComments}
            </Text>
          ) : (
            <>
              {comments.map((c) => (
                <View key={c.id} className="mb-3">
                  <View className={`items-center gap-2 mb-1 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                    <Pressable
                      onPress={() => openProfile(c.user_id)}
                      accessibilityRole="button"
                      className="min-w-0"
                      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
                    >
                      <ProfileIdentity
                        displayName={c.profiles?.display_name || c.profiles?.username || s.genericAnonymous}
                        username={c.profiles?.username}
                        avatarUrl={c.profiles?.avatar_url}
                        isDark={isDark}
                        isRTL={isRTL}
                        avatarSize={26}
                        nameSize={12}
                        handleSize={10}
                      />
                    </Pressable>
                    <Text style={{ fontFamily: "Manrope_400Regular", fontSize: 10, color: mutedColor }}>
                      {relativeTime(c.created_at, s.justNow, uiLanguage)}
                    </Text>
                  </View>
                  <Text
                    className="text-charcoal dark:text-neutral-300"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 13,
                      lineHeight: 20,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {c.content}
                  </Text>
                </View>
              ))}

              {commentsQuery.hasNextPage && (
                <Pressable
                  onPress={handleLoadMore}
                  disabled={commentsQuery.isFetchingNextPage}
                  className="items-center py-3"
                  style={({ pressed }) => ({ opacity: pressed || commentsQuery.isFetchingNextPage ? 0.6 : 1 })}
                >
                  {commentsQuery.isFetchingNextPage ? (
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
            </>
          )}
        </OverlayBody>

        {user ? (
          <View
            className={`mx-5 mb-4 items-center gap-2 rounded-2xl border border-warm-200 bg-surface-low px-3.5 py-2.5 dark:border-neutral-700 dark:bg-surface-dark-low ${isRTL ? "flex-row-reverse" : "flex-row"}`}
          >
            <Input
              value={text}
              onChangeText={(next) => {
                setText(next);
                if (error) setError(null);
              }}
              placeholder={s.reflectionAddComment}
              placeholderTextColor={mutedColor}
              multiline={false}
              maxLength={2000}
              dir={isRTL ? "rtl" : "ltr"}
              className="min-h-0 flex-1 bg-transparent px-0 py-0 text-charcoal dark:text-neutral-100"
              style={{
                fontSize: 14,
                padding: 0,
              }}
              returnKeyType="send"
              blurOnSubmit
              onSubmitEditing={handleSubmit}
              onKeyPress={(e) => {
                if (e.nativeEvent.key === "Enter") {
                  handleSubmit();
                }
              }}
            />
            <Pressable
              onPress={handleSubmit}
              disabled={submitting || !text.trim()}
              style={({ pressed }) => ({
                opacity: pressed || submitting || !text.trim() ? 0.4 : 1,
                padding: 6,
              })}
            >
              <Send size={18} color={isDark ? "#5eead4" : "#003638"} />
            </Pressable>
          </View>
        ) : (
          <View className="mx-5 mb-4 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-3">
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 13,
                lineHeight: 20,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.reflectionLoginToComment}
            </Text>
            <Pressable
              onPress={() => {
                onClose();
                router.push("/auth/login");
              }}
              className="mt-3 self-start rounded-full bg-primary-accent px-4 py-2 dark:bg-primary-bright"
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, alignSelf: isRTL ? "flex-end" : "flex-start" })}
            >
              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: "#FFFFFF" }}>
                {s.authLogin}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </ResponsiveSheet>
    </>
  );
}
