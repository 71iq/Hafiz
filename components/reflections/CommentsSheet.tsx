import { reflectionQueryKeys } from "@/lib/reflections/query-keys";
import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { ChevronDown, Flag, Heart, Send, Trash2 } from "lucide-react-native";
import { router } from "expo-router";
import { captureAuthReturn } from "@/lib/auth/return-origin";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchProfilePrivacy, profilePrivacyKeys } from "@/lib/profile/privacy";
import { requireSocialOwner } from "@/lib/social/owner";
import { useAuthStore } from "@/lib/auth/store";
import { hapticLight } from "@/lib/haptics";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { fetchComments, addComment, toggleCommentLike } from "@/lib/reflections/api";
import { SavedRowUnreadableError } from "@/lib/reflections/rows";
import { ReflectionPrivacyChangedError } from "@/lib/reflections/errors";
import type { Reflection, ReflectionComment, ReflectionCommentSort } from "@/lib/reflections/types";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { DiscardChangesDialog, isEditableTextDirty, useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { formatNumber } from "@/lib/i18n/count";
import { Input } from "@/components/ui/Input";
import { ProfileIdentity } from "@/components/profile/ProfileIdentity";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { ReflectionCard } from "./ReflectionCard";
import { formatCommentDateTime, formatLocalRelativeTime, ReflectionTime } from "./ReflectionTime";
import { useReflectionMutationScope, type ReflectionMutationLease } from "./use-mutation-scope";
import { useDeleteComment, useReportReflection } from "./use-reflection-actions";
import { textStartStyle } from "@/lib/ui/direction";

export { formatCommentDateTime };

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
  /** After the server confirmed deleting one of the viewer's comments, so the count shown drops by one. */
  onCommentRemoved?: (reflectionId: string) => void;
  /** After the author's delete of the shown reflection settled; the sheet has already closed. */
  onReflectionGone?: (reflection: Reflection) => void;
  /**
   * Where a guest returns after signing in from this sheet: the ayah it was opened from (ayah
   * detail) or the feed. Defaults to the feed.
   */
  authReturn?: { surface: "ayah"; surah: number; ayah: number } | { surface: "feed" };
};

/** The composer shows its counter from this length. */
export const COMMENT_COUNTER_THRESHOLD = 1800;
export const COMMENT_MAX_LENGTH = 2000;
/** Long comments start clamped to this many lines, with Show more. */
const COMMENT_CLAMP_LINES = 6;
const COMMENT_LINE_HEIGHT = 20;
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
  onCommentRemoved,
  onReflectionGone,
  authReturn = { surface: "feed" },
}: Props) {
  const { isDark, isRTL, uiLanguage, themeColors } = useSettings();
  const s = useStrings();
  const user = useAuthStore((s) => s.user);
  // ETH-07: a stated minor's comments are visible only to them, read from the cache the app-wide
  // minor check keeps (useMinorPhotoCleanup). A comment carries what this screen showed, so a copy
  // made stale by another device cannot publish it.
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
  // Each failure shows where the person acted: the first load at the top, loading more beside its
  // button, and posting or liking above the input.
  const [failure, setFailure] = useState<"load" | "more" | "post" | "privacy" | "like" | "auth" | null>(null);
  const error =
    failure === "load" || failure === "more"
      ? s.commentLoadFailed
      : failure === "post"
        ? s.commentPostFailed
        : failure === "privacy"
          ? s.commentPrivacyChanged
          : failure === "like"
            ? s.reflectionLikeFailed
            : failure === "auth"
              ? s.reflectionFeedAuthRequired
              : null;
  // Expanded long comments and the comment whose full date is showing, per reflection.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [clampedIds, setClampedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [dateRevealId, setDateRevealId] = useState<string | null>(null);
  const closeNow = useCallback(() => {
    if (retire()) onClose();
  }, [retire, onClose]);
  // Comments have no report of their own: "Report reflection" reports the parent, and says so.
  const parentReport = useReportReflection(reflection ?? null);
  const removeLocalComment = useCallback(
    (removed: ReflectionComment, deleted: boolean) => {
      setLocalComments((prev) => prev.filter((row) => row.id !== removed.id));
      if (deleted) onCommentRemoved?.(removed.reflection_id);
    },
    [onCommentRemoved],
  );
  const commentRemoval = useDeleteComment(reflectionId, removeLocalComment);
  // A typed comment asks before any intentional close or switch away from this reflection.
  const { guard, dialogProps } = useDiscardGuard(isEditableTextDirty(text, ""));
  const handleClose = useCallback(() => guard(closeNow), [closeNow, guard]);
  // Without a caller-provided sign-in path, a guest's like tap explains itself instead of doing nothing.
  const requireAuth = useCallback(() => {
    if (onAuthRequired) onAuthRequired();
    else setFailure("auth");
  }, [onAuthRequired]);

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
    setExpandedIds(new Set());
    setClampedIds(new Set());
    setDateRevealId(null);
  }, [reflectionId, user?.id]);

  // fetchNextPage reports a failed page through the query's error, not by throwing, so the kind
  // comes from the query: a failed next page shows beside "Load more", anything else at the top.
  useEffect(() => {
    if (commentsQuery.error) {
      const more = commentsQuery.isFetchNextPageError;
      console.warn(more ? "[Comments] Failed to load more:" : "[Comments] Failed to load:", commentsQuery.error);
      setFailure(more ? "more" : "load");
    }
  }, [commentsQuery.error, commentsQuery.isFetchNextPageError]);

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
      const comment = await addComment(user.id, reflectionId, submitted.trim(), isMinor);
      if (!lease.isCurrent()) return;
      setLocalComments((prev) => [...prev, comment]);
      finishPosted();
    } catch (error) {
      const privacyChanged = error instanceof ReflectionPrivacyChangedError;
      // The account is no longer a minor on the server: reload its privacy so the note goes away, and
      // post nothing until the person sends again.
      if (privacyChanged) void queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.mine(user.id) });
      if (!lease.isCurrent()) return;
      // Posted, but the reply could not be read: the refetch shows it instead of a duplicate retry.
      if (error instanceof SavedRowUnreadableError) {
        finishPosted();
        return;
      }
      if (privacyChanged) {
        setFailure("privacy");
        return;
      }
      console.warn("[Comments] Failed to add:", error);
      setFailure("post");
    } finally {
      lease.release();
    }
  }, [user, reflectionId, text, isMinor, begin, onCommentAdded, queryClient]);

  const handleLoadMore = useCallback(async () => {
    if (!reflectionId || !commentsQuery.hasNextPage) return;
    const lease = begin("page");
    if (!lease) return;
    setFailure(null);
    try {
      await commentsQuery.fetchNextPage({ cancelRefetch: false });
    } catch {
      // Not reached by default: a failed page sets the query's error, handled above.
      if (lease.isCurrent()) setFailure("more");
    } finally {
      lease.release();
    }
  }, [reflectionId, begin, commentsQuery]);

  const handleCommentLike = useCallback(
    async (comment: ReflectionComment) => {
      if (!user) {
        requireAuth();
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
    [user, begin, loadedComments, localComments, reflectionId, requireAuth, queryClient],
  );

  const mutedColor = isDark ? "#737373" : "#A39B93";
  // Android keeps this screen and its Modal window mounted under a pushed route, so the sheet
  // has to close before navigating or the next screen opens behind it.
  // A navigation is an intentional exit, so a typed comment asks first.
  const closeForNavigation = useCallback(
    (navigate?: () => void) => {
      guard(() => {
        closeNow();
        onNavigate?.();
        navigate?.();
      });
    },
    [closeNow, guard, onNavigate],
  );
  const openProfile = useCallback(
    (commentUserId: string) => {
      closeForNavigation(() =>
        router.push(commentUserId === user?.id ? ("/profile" as any) : (`/profile/${commentUserId}` as any)),
      );
    },
    [closeForNavigation, user?.id],
  );
  const handleReferencePress = useMemo(
    () =>
      onReferencePress
        ? (target: Reflection) => {
            closeForNavigation(() => onReferencePress(target));
          }
        : undefined,
    [closeForNavigation, onReferencePress],
  );
  const retryLoad = useCallback(() => {
    setFailure(null);
    void commentsQuery.refetch();
  }, [commentsQuery]);

  return (
    <>
      <ResponsiveSheet
        open={!!reflectionId}
        onClose={handleClose}
        maxWidth={760}
        // The list scrolls between the header and the pinned composer, so the sheet keeps its height.
        phoneSheetHeight="max"
        dir={isRTL ? "rtl" : "ltr"}
        avoidKeyboard
      >
        <OverlayHeader
          title={reflection ? s.reflectionPostTitle : s.reflectionComments}
          subtitle={reflection ? referenceLabel : undefined}
          onClose={handleClose}
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
                // The card pushes its route right after this call, so it cannot wait for a prompt.
                onNavigate={() => {
                  closeNow();
                  onNavigate?.();
                }}
                onCommentsPress={() => {}}
                onLikeToggled={onLikeToggled ?? (() => {})}
                onAuthRequired={requireAuth}
                onGone={(gone) => {
                  // The post is gone, so a typed comment has nowhere to go: close without asking.
                  closeNow();
                  onReflectionGone?.(gone);
                }}
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

            {/* Only the first load fails here; other failures show where the person acted. */}
            {error && failure === "load" ? (
              <View className="mb-3 gap-2">
                <Text
                  accessibilityRole="alert"
                  className="text-red-600 dark:text-red-400"
                  style={{
                    fontFamily: "Manrope_500Medium",
                    fontSize: 13,
                    lineHeight: 20,
                    ...textStartStyle(isRTL),
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {error}
                </Text>
                <RetryButton label={s.sharedTryAgain} onPress={retryLoad} isRTL={isRTL} />
              </View>
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
                      <ReflectionTime
                        relative={formatLocalRelativeTime(c.created_at, s.justNow, uiLanguage)}
                        full={formatCommentDateTime(c.created_at, uiLanguage)}
                        hint={s.commentFullDateHint}
                        revealed={dateRevealId === c.id}
                        onReveal={(show) => setDateRevealId((current) => (show ? c.id : current === c.id ? null : current))}
                        color={mutedColor}
                      />
                      {user ? <View className="flex-1" /> : null}
                      {user ? (
                        <View>
                          <DropdownMenu
                            triggerLabel={s.commentOptions}
                            align="end"
                            isRTL={isRTL}
                            items={
                              c.user_id === user.id
                                ? [
                                    {
                                      key: "delete",
                                      label: s.commentDeleteAction,
                                      destructive: true,
                                      icon: (color) => <Trash2 size={16} color={color} />,
                                      disabled: commentRemoval.pending,
                                      onPress: () => commentRemoval.request(c),
                                    },
                                  ]
                                : reflection
                                  ? [
                                      {
                                        key: "report-parent",
                                        label: parentReport.reported ? s.reflectionReported : s.reflectionReportAction,
                                        icon: (color) => <Flag size={16} color={color} />,
                                        disabled: parentReport.reported || parentReport.pending,
                                        onPress: parentReport.request,
                                      },
                                    ]
                                  : []
                            }
                          />
                        </View>
                      ) : null}
                    </View>
                    <View>
                      {/* An unclamped hidden copy tells whether the comment needs Show more. */}
                      <Text
                        aria-hidden
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        pointerEvents="none"
                        onLayout={(event) => {
                          const clamped = event.nativeEvent.layout.height > COMMENT_LINE_HEIGHT * COMMENT_CLAMP_LINES + 2;
                          setClampedIds((current) => {
                            if (current.has(c.id) === clamped) return current;
                            const next = new Set(current);
                            if (clamped) next.add(c.id);
                            else next.delete(c.id);
                            return next;
                          });
                        }}
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          opacity: 0,
                          fontFamily: "Manrope_400Regular",
                          fontSize: 13,
                          lineHeight: COMMENT_LINE_HEIGHT,
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {c.content}
                      </Text>
                      <Text
                        className="text-charcoal dark:text-neutral-300"
                        numberOfLines={expandedIds.has(c.id) ? undefined : COMMENT_CLAMP_LINES}
                        style={{
                          fontFamily: "Manrope_400Regular",
                          fontSize: 13,
                          lineHeight: COMMENT_LINE_HEIGHT,
                          ...textStartStyle(isRTL),
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {c.content}
                      </Text>
                    </View>
                    {clampedIds.has(c.id) || expandedIds.has(c.id) ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: expandedIds.has(c.id) }}
                        onPress={() =>
                          setExpandedIds((current) => {
                            const next = new Set(current);
                            if (next.has(c.id)) next.delete(c.id);
                            else next.add(c.id);
                            return next;
                          })
                        }
                        className="min-h-11 justify-center"
                        style={{ alignSelf: isRTL ? "flex-end" : "flex-start" }}
                      >
                        <Text
                          className="text-primary-accent dark:text-primary-bright"
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                        >
                          {expandedIds.has(c.id) ? s.sharedShowLess : s.sharedShowMore}
                        </Text>
                      </Pressable>
                    ) : null}
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
                            {formatNumber(c.likes_count ?? 0, uiLanguage)}
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
                {error && failure === "more" ? (
                  <Text
                    accessibilityRole="alert"
                    className="pb-3 text-center text-red-600 dark:text-red-400"
                    style={{
                      fontFamily: "Manrope_500Medium",
                      fontSize: 13,
                      lineHeight: 20,
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {error}
                  </Text>
                ) : null}
              </>
            )}
          </OverlayBody>

          {error && (failure === "auth" || (user && (failure === "post" || failure === "privacy" || failure === "like"))) ? (
            <Text
              accessibilityRole="alert"
              className="mx-5 mb-2 text-red-600 dark:text-red-400"
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 13,
                lineHeight: 20,
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {error}
            </Text>
          ) : user && isMinor ? (
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
                maxLength={COMMENT_MAX_LENGTH}
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
                accessibilityRole="button"
                accessibilityLabel={s.reflectionSend}
                // A 44 px target around the 18 px icon.
                className="-my-2 h-11 w-11 items-center justify-center"
                style={({ pressed }) => ({
                  opacity: pressed || submitting || !text.trim() ? 0.4 : 1,
                })}
              >
                <Send size={18} color={isDark ? "#5eead4" : "#003638"} />
              </Pressable>
            </View>
          ) : null}
          {user && text.length > COMMENT_COUNTER_THRESHOLD ? (
            <Text
              accessibilityLiveRegion="polite"
              className="mx-5 -mt-2 mb-3"
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 12,
                color: isDark ? "#a3a3a3" : "#6E5A47",
                ...textStartStyle(isRTL),
              }}
            >
              {interpolate(s.sharedCharacterCount, {
                n: formatNumber(text.length, uiLanguage),
                max: formatNumber(COMMENT_MAX_LENGTH, uiLanguage),
              })}
            </Text>
          ) : null}
          {user ? null : (
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
                onPress={() =>
                  closeForNavigation(() => {
                    // Only the reflection reference returns after sign-in; no comment or like is replayed.
                    if (reflectionId) {
                      captureAuthReturn({
                        route: "comments",
                        params:
                          authReturn.surface === "ayah"
                            ? { reflectionId, surah: authReturn.surah, ayah: authReturn.ayah }
                            : { reflectionId },
                      });
                    }
                    router.push("/auth/login");
                  })
                }
                accessibilityRole="button"
                // White on teal-700 in light (5.4:1); dark teal text on the bright accent in dark.
                className="mt-3 min-h-[44px] justify-center self-start rounded-full bg-primary-muted px-4 py-2 dark:bg-primary-bright"
                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, alignSelf: isRTL ? "flex-end" : "flex-start" })}
              >
                <Text className="text-white dark:text-[#042f2e]" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                  {s.authLogin}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </ResponsiveSheet>
      <DiscardChangesDialog {...dialogProps} title={s.commentDiscardTitle} />
      <ConfirmDialog
        visible={commentRemoval.open}
        title={s.commentDeleteTitle}
        message={s.commentDeleteBody}
        cancelLabel={s.reflectionCancel}
        confirmLabel={s.reflectionDeleteConfirm}
        pendingLabel={s.reflectionDeleting}
        destructive
        confirmLoading={commentRemoval.pending}
        error={commentRemoval.error}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={commentRemoval.cancel}
        onConfirm={() => void commentRemoval.confirm()}
      />
      <ConfirmDialog
        visible={parentReport.open}
        title={s.reflectionReportTitle}
        message={interpolate(s.reflectionReportFromCommentBody, { reference: referenceLabel ?? s.reflectionPostTitle })}
        cancelLabel={s.reflectionCancel}
        confirmLabel={s.reflectionReportConfirm}
        pendingLabel={s.reflectionReporting}
        tone="info"
        confirmLoading={parentReport.pending}
        error={parentReport.error}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={parentReport.cancel}
        onConfirm={() => void parentReport.confirm()}
      />
    </>
  );
}

function RetryButton({ label, onPress, isRTL }: { label: string; onPress: () => void; isRTL: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-11 justify-center rounded-full bg-surface-high px-5 py-2.5 dark:bg-surface-dark-high"
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, alignSelf: isRTL ? "flex-end" : "flex-start" })}
    >
      <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}
