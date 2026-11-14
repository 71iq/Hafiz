import { reflectionQueryKeys } from "@/lib/reflections/query-keys";
import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { ChevronDown, Heart, Send } from "lucide-react-native";
import { router } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchProfilePrivacy, profilePrivacyKeys } from "@/lib/profile/privacy";
import { requireSocialOwner } from "@/lib/social/owner";
import { useAuthStore } from "@/lib/auth/store";
import { hapticLight } from "@/lib/haptics";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { formatRelativeTime } from "@/lib/i18n/relative-time";
import { fetchComments, addComment, toggleCommentLike } from "@/lib/reflections/api";
import { SavedRowUnreadableError } from "@/lib/reflections/rows";
import type { Reflection, ReflectionComment, ReflectionCommentSort } from "@/lib/reflections/types";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Input } from "@/components/ui/Input";
import { ProfileIdentity } from "@/components/profile/ProfileIdentity";
import { ReflectionCard } from "./ReflectionCard";
import { useReflectionMutationScope, type ReflectionMutationLease } from "./use-mutation-scope";
import { textStartStyle } from "@/lib/ui/direction";

type Props = {
  reflectionId: string | null;
  reflection?: Reflection | null;
  referenceLabel?: string;
  showReference?: boolean;
  onReferencePress?: (reflection: Reflection) => void;
  onLikeToggled?: (reflectionId: string, liked: boolean, delta: number) => void;
  onAuthRequired?: () => void;
  onClose: () => void;
  /** Called after this sheet closes for a navigation, so a sheet that contains it can close too. */
  onNavigate?: () => void;
  onCommentAdded: (reflectionId: string) => void;
};

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
  onNavigate,
  onCommentAdded,
}: Props) {
  const { isDark, isRTL, uiLanguage, themeColors } = useSettings();
  const s = useStrings();
  const user = useAuthStore((s) => s.user);
  // ETH-07: a stated minor's comments are visible only to them, read from the cache the app-wide
  // minor check keeps (useMinorPhotoCleanup).
  const ownPrivacy = useQuery({
    queryKey: profilePrivacyKeys.mine(user?.id ?? null),
    queryFn: () => fetchProfilePrivacy(requireSocialOwner(user?.id ?? "")),
    enabled: false,
  });
  const isMinor = ownPrivacy.data?.isMinor === true;
  const [localComments, setLocalComments] = useState<ReflectionComment[]>([]);
  const [sort, setSort] = useState<ReflectionCommentSort>("oldest");
  const [sortOpen, setSortOpen] = useState(false);
  const [text, setText] = useState("");
  const queryClient = useQueryClient();
  const { begin, pending, retire } = useReflectionMutationScope(JSON.stringify(reflectionId), user?.id);
  const submitting = pending.has("submit");
  const [commentLikeOverrides, setCommentLikeOverrides] = useState<
    Record<string, { source: ReflectionComment; lease: ReflectionMutationLease; liked: boolean; likesCount: number }>
  >({});
  const [failure, setFailure] = useState<"load" | "post" | "like" | null>(null);
  const error =
    failure === "load"
      ? s.commentLoadFailed
      : failure === "post"
        ? s.commentPostFailed
        : failure === "like"
          ? s.reflectionLikeFailed
          : null;
  const handleClose = useCallback(() => {
    if (retire()) onClose();
  }, [retire, onClose]);

  const sortOptions = useMemo<{ value: ReflectionCommentSort; label: string }[]>(
    () => [
      { value: "popular", label: s.commentSortPopular },
      { value: "oldest", label: s.commentSortOldest },
      { value: "newest", label: s.commentSortNewest },
    ],
    [s.commentSortNewest, s.commentSortOldest, s.commentSortPopular],
  );
  const selectedSortLabel = sortOptions.find((option) => option.value === sort)?.label ?? s.commentSortOldest;

  const commentsQuery = useInfiniteQuery({
    queryKey: reflectionQueryKeys.comments.list({ reflectionId, sort, viewerId: user?.id }),
    queryFn: ({ pageParam }) => fetchComments(reflectionId ?? "", pageParam, sort, user?.id),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length : undefined),
    enabled: !!reflectionId,
    staleTime: 1000 * 60,
  });

  const loadedComments = useMemo(
    () => commentsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [commentsQuery.data],
  );

  const sourceComments = useMemo(() => {
    const loadedIds = new Set(loadedComments.map((comment) => comment.id));
    return [...loadedComments, ...localComments.filter((comment) => !loadedIds.has(comment.id))];
  }, [loadedComments, localComments]);
  const currentComments = useRef(sourceComments);
  useLayoutEffect(() => {
    currentComments.current = sourceComments;
  }, [sourceComments]);
  // Currentness can change without a new query row, including a same-user session replacement.
  const comments = sortComments(
    sourceComments.map((comment) => {
      const override = commentLikeOverrides[comment.id];
      return override?.lease.isCurrent() && override.source === comment
        ? { ...comment, likes_count: override.likesCount, user_has_liked: override.liked }
        : comment;
    }),
    sort,
  );

  useLayoutEffect(() => {
    setLocalComments([]);
    setText("");
    setFailure(null);
    setSortOpen(false);
    setCommentLikeOverrides({});
  }, [reflectionId, user?.id]);

  useEffect(() => {
    if (commentsQuery.error) {
      console.warn("[Comments] Failed to load:", commentsQuery.error);
      setFailure("load");
    }
  }, [commentsQuery.error, s.commentLoadFailed]);

  const handleSubmit = useCallback(async () => {
    if (!user || !reflectionId || !text.trim()) return;
    const lease = begin("submit");
    if (!lease) return;
    const submitted = text;
    setFailure(null);
    const finishPosted = () => {
      setText((current) => (current === submitted ? "" : current));
      void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.comments.forReflection(reflectionId) });
      onCommentAdded(reflectionId);
    };
    try {
      const comment = await addComment(user.id, reflectionId, submitted.trim());
      if (!lease.isCurrent()) return;
      setLocalComments((prev) => [...prev, comment]);
      finishPosted();
    } catch (error) {
      if (!lease.isCurrent()) return;
      // Posted, but the reply could not be read: the refetch shows it instead of a duplicate retry.
      if (error instanceof SavedRowUnreadableError) {
        finishPosted();
        return;
      }
      console.warn("[Comments] Failed to add:", error);
      setFailure("post");
    } finally {
      lease.release();
    }
  }, [user, reflectionId, text, begin, onCommentAdded, queryClient]);

  const handleLoadMore = useCallback(async () => {
    if (!reflectionId || !commentsQuery.hasNextPage) return;
    const lease = begin("page");
    if (!lease) return;
    setFailure(null);
    try {
      await commentsQuery.fetchNextPage({ cancelRefetch: false });
    } catch (error) {
      if (lease.isCurrent()) {
        console.warn("[Comments] Failed to load more:", error);
        setFailure("load");
      }
    } finally {
      lease.release();
    }
  }, [reflectionId, begin, commentsQuery]);

  const handleCommentLike = useCallback(
    async (comment: ReflectionComment) => {
      if (!user) {
        onAuthRequired?.();
        return;
      }
      const lease = begin("like:" + comment.id);
      if (!lease) return;
      const source =
        loadedComments.find((row) => row.id === comment.id) ??
        localComments.find((row) => row.id === comment.id) ??
        comment;
      const wasLiked = comment.user_has_liked ?? false;
      setFailure(null);
      setCommentLikeOverrides((prev) => ({
        ...prev,
        [comment.id]: {
          source,
          lease,
          liked: !wasLiked,
          likesCount: Math.max(0, (comment.likes_count ?? 0) + (wasLiked ? -1 : 1)),
        },
      }));
      hapticLight();
      try {
        await toggleCommentLike(user.id, comment.id, wasLiked);
        if (lease.isCurrent() && reflectionId) {
          const latest = currentComments.current.find((row) => row.id === comment.id);
          if (latest) {
            const desired = !wasLiked,
              before = latest.user_has_liked ?? false;
            setCommentLikeOverrides((prev) => ({
              ...prev,
              [comment.id]: {
                source: latest,
                lease,
                liked: desired,
                likesCount: Math.max(0, (latest.likes_count ?? 0) + (before === desired ? 0 : desired ? 1 : -1)),
              },
            }));
          }
          void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.comments.forReflection(reflectionId) });
        }
      } catch (error) {
        if (lease.isCurrent()) {
          console.warn("[Comments] Failed to update like:", error);
          setCommentLikeOverrides((prev) => {
            if (prev[comment.id]?.lease !== lease) return prev;
            const next = { ...prev };
            delete next[comment.id];
            return next;
          });
          setFailure("like");
        }
      } finally {
        lease.release();
      }
    },
    [user, begin, loadedComments, localComments, reflectionId, onAuthRequired, queryClient],
  );

  const mutedColor = isDark ? "#737373" : "#A39B93";
  // Android keeps this screen and its Modal window mounted under a pushed route, so the sheet
  // has to close before navigating or the next screen opens behind it.
  const closeForNavigation = useCallback(() => {
    handleClose();
    onNavigate?.();
  }, [handleClose, onNavigate]);
  const openProfile = useCallback(
    (commentUserId: string) => {
      closeForNavigation();
      router.push(commentUserId === user?.id ? ("/profile" as any) : (`/profile/${commentUserId}` as any));
    },
    [closeForNavigation, user?.id],
  );
  const handleReferencePress = useMemo(
    () =>
      onReferencePress
        ? (target: Reflection) => {
            closeForNavigation();
            onReferencePress(target);
          }
        : undefined,
    [closeForNavigation, onReferencePress],
  );

  return (
    <>
      <ResponsiveSheet
        open={!!reflectionId}
        onClose={handleClose}
        maxWidth={760}
        dir={isRTL ? "rtl" : "ltr"}
        avoidKeyboard
      >
        <OverlayHeader
          title={reflection ? s.reflectionPostTitle : s.reflectionComments}
          subtitle={s.reflections}
          onClose={handleClose}
          showHandle
          isRTL={isRTL}
        />
        <View className="flex-1 min-h-0">
          <OverlayBody className="flex-1 min-h-0" contentContainerClassName="px-5 pt-4 pb-3">
            {reflection ? (
              <ReflectionCard
                reflection={reflection}
                variant="feed"
                showReference={showReference}
                referenceLabel={referenceLabel}
                onReferencePress={handleReferencePress}
                onNavigate={closeForNavigation}
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
                    ...textStartStyle(isRTL),
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
                            ? isDark
                              ? "rgba(45,212,191,0.12)"
                              : "rgba(13,148,136,0.08)"
                            : "transparent",
                          borderTopWidth: index === 0 ? 0 : 1,
                          borderTopColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,54,56,0.06)",
                          opacity: pressed ? 0.72 : 1,
                        })}
                      >
                        <Text
                          className={
                            active
                              ? "text-primary-accent dark:text-primary-bright"
                              : "text-charcoal dark:text-neutral-200"
                          }
                          style={{
                            fontFamily: active ? "Manrope_700Bold" : "Manrope_500Medium",
                            fontSize: 13,
                            ...textStartStyle(isRTL),
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
                  ...textStartStyle(isRTL),
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
                        {formatRelativeTime(c.created_at, s.justNow, uiLanguage)}
                      </Text>
                    </View>
                    <Text
                      className="text-charcoal dark:text-neutral-300"
                      style={{
                        fontFamily: "Manrope_400Regular",
                        fontSize: 13,
                        lineHeight: 20,
                        ...textStartStyle(isRTL),
                        writingDirection: isRTL ? "rtl" : "ltr",
                      }}
                    >
                      {c.content}
                    </Text>
                    <View
                      className={`mt-1.5 items-center ${isRTL ? "flex-row-reverse" : "flex-row"}`}
                      style={{
                        direction: "ltr",
                        flexDirection: isRTL ? "row-reverse" : "row",
                      }}
                    >
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => handleCommentLike(c)}
                        disabled={pending.has("like:" + c.id)}
                        className={`items-center gap-1 rounded-full px-2 py-1 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
                        style={({ pressed }) => ({
                          direction: "ltr",
                          flexDirection: isRTL ? "row-reverse" : "row",
                          opacity: pressed || pending.has("like:" + c.id) ? 0.6 : 1,
                          backgroundColor: themeColors.surfaceMid,
                        })}
                      >
                        <Heart
                          size={14}
                          color={c.user_has_liked ? "#ef4444" : mutedColor}
                          fill={c.user_has_liked ? "#ef4444" : "none"}
                        />
                        {(c.likes_count ?? 0) > 0 ? (
                          <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: mutedColor }}>
                            {c.likes_count}
                          </Text>
                        ) : null}
                      </Pressable>
                    </View>
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

          {user && isMinor ? (
            <Text
              className="mx-5 mb-2"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 12,
                lineHeight: 18,
                color: isDark ? "#a3a3a3" : "#6E5A47",
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.reflectionMinorPrivate}
            </Text>
          ) : null}
          {user ? (
            <View
              className={`mx-5 mb-4 items-center gap-2 rounded-2xl border border-warm-200 bg-surface-low px-3.5 py-2.5 dark:border-neutral-700 dark:bg-surface-dark-low ${isRTL ? "flex-row-reverse" : "flex-row"}`}
            >
              <Input
                value={text}
                onChangeText={(next) => {
                  setText(next);
                  if (error) setFailure(null);
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
                  ...textStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.reflectionLoginToComment}
              </Text>
              <Pressable
                onPress={() => {
                  closeForNavigation();
                  router.push("/auth/login");
                }}
                className="mt-3 self-start rounded-full bg-primary-accent px-4 py-2 dark:bg-primary-bright"
                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, alignSelf: isRTL ? "flex-end" : "flex-start" })}
              >
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: "#FFFFFF" }}>{s.authLogin}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ResponsiveSheet>
    </>
  );
}
