import { useLayoutEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { reflectionQueryKeys } from "@/lib/reflections/query-keys";
import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { Heart, MessageCircle, Flag, Trash2 } from "lucide-react-native";
import { useAuthStore } from "@/lib/auth/store";
import { toggleLike } from "@/lib/reflections/api";
import { isPendingId, pendingKeys, useIsHidden } from "@/lib/reflections/pending";
import { useOptimisticLike } from "./use-optimistic-like";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { formatCompactCount } from "@/lib/reflections/format";
import type { Reflection } from "@/lib/reflections/types";
import { ProfileIdentity } from "@/components/profile/ProfileIdentity";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { formatCommentDateTime, formatLocalRelativeTime, ReflectionTime } from "./ReflectionTime";
import { useDeleteReflection, useReportReflection } from "./use-reflection-actions";

/** Feed cards clamp long reflections to this many lines; Read more opens the full post. */
export const REFLECTION_CLAMP_LINES = 8;

type Props = {
  reflection: Reflection;
  onLikeToggled: (reflectionId: string, liked: boolean, delta: number) => void;
  onCommentsPress: (reflectionId: string) => void;
  onPress?: (reflectionId: string) => void;
  variant?: "compact" | "feed";
  showReference?: boolean;
  referenceLabel?: string;
  onReferencePress?: (reflection: Reflection) => void;
  onAuthRequired?: () => void;
  /** Called before the card navigates away, so the sheet that shows it can close first. */
  onNavigate?: () => void;
  /** Clamp long content and offer Read more (which calls onPress). The full-post view leaves this off. */
  clamp?: boolean;
  /** When the author confirms deleting it and it leaves the lists, so a detail view can close. */
  onGone?: (reflection: Reflection) => void;
};

export function ReflectionCard({
  reflection,
  onLikeToggled,
  onCommentsPress,
  onPress,
  variant = "compact",
  showReference = false,
  referenceLabel,
  onReferencePress,
  onAuthRequired,
  onNavigate,
  clamp = false,
  onGone,
}: Props) {
  const { isDark, isRTL, uiLanguage, themeColors } = useSettings();
  const s = useStrings();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<"like" | "auth" | null>(null);
  const [timeRevealed, setTimeRevealed] = useState(false);
  const [clamped, setClamped] = useState(false);
  const report = useReportReflection(reflection);
  const removal = useDeleteReflection(reflection, onGone);
  const isOwn = !!user && reflection.user_id === user.id;
  // A post the server has not named yet shows at once but takes no likes, replies or menu actions.
  const sending = isPendingId(reflection.id);
  const hidden = useIsHidden(user ? pendingKeys.reflection(user.id, reflection.id) : null);
  const error = failure === "like" ? s.reflectionLikeFailed : failure === "auth" ? s.reflectionFeedAuthRequired : null;
  const authorName = reflection.profiles?.display_name || reflection.profiles?.username || s.genericAnonymous;

  // The server now holds `liked`: lists that keep their own rows adjust, and shared lists refetch.
  const reconcileLike = useCallback(
    (liked: boolean, delta: -1 | 0 | 1) => {
      if (!delta) return;
      onLikeToggled(reflection.id, liked, delta);
      for (let ayah = reflection.ayah_start; ayah <= reflection.ayah_end; ayah++) {
        void queryClient.invalidateQueries({
          queryKey: reflectionQueryKeys.reflections.ayah({ surah: reflection.surah, ayah }),
        });
      }
      void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.feed.all });
    },
    [onLikeToggled, queryClient, reflection],
  );
  const like = useOptimisticLike({
    kind: "reflection",
    id: reflection.id,
    liked: reflection.user_has_liked ?? false,
    count: reflection.likes_count,
    send: (userId, liked) => toggleLike(userId, reflection.id, !liked),
    onSettled: reconcileLike,
    onFailed: (liked, delta) => {
      reconcileLike(liked, delta);
      setFailure("like");
    },
  });
  const { liked, count: likesCount, toggle: toggleLikeChoice } = like;

  useLayoutEffect(() => {
    setFailure(null);
    setTimeRevealed(false);
  }, [reflection.id, user?.id]);

  const handleLike = useCallback(() => {
    if (!user) {
      // The surface stays open and explains itself; no like is replayed after signing in.
      if (onAuthRequired) onAuthRequired();
      else setFailure("auth");
      return;
    }
    if (sending) return;
    setFailure(null);
    toggleLikeChoice();
  }, [user, sending, toggleLikeChoice, onAuthRequired]);

  const mutedColor = isDark ? "#737373" : "#A39B93";
  const heartColor = liked ? "#ef4444" : mutedColor;
  const contentAlign = isRTL ? ("right" as const) : ("left" as const);
  const rowClassName = isRTL ? "flex-row-reverse" : "flex-row";
  const rowFlexStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? ("row-reverse" as const) : ("row" as const),
  };
  const isFeed = variant === "feed";
  const openProfile = useCallback(() => {
    onNavigate?.();
    router.push(reflection.user_id === user?.id ? ("/profile" as any) : (`/profile/${reflection.user_id}` as any));
  }, [onNavigate, reflection.user_id, user?.id]);
  const contentStyle = {
    fontFamily: "Manrope_400Regular",
    fontSize: isFeed ? 15 : 14,
    lineHeight: isFeed ? 25 : 23,
    textAlign: contentAlign,
    writingDirection: isRTL ? ("rtl" as const) : ("ltr" as const),
  };
  const canClamp = clamp && !!onPress && !sending;
  const contentText = (
    <View style={{ marginBottom: canClamp && clamped ? 4 : isFeed ? 14 : 12 }}>
      {canClamp ? (
        // An unclamped hidden copy tells whether the reflection needs Read more.
        <Text
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          onLayout={(event) => {
            const next = event.nativeEvent.layout.height > contentStyle.lineHeight * REFLECTION_CLAMP_LINES + 2;
            setClamped((current) => (current === next ? current : next));
          }}
          style={{ ...contentStyle, position: "absolute", left: 0, right: 0, opacity: 0 }}
        >
          {reflection.content}
        </Text>
      ) : null}
      <Text
        className="text-charcoal dark:text-neutral-200"
        numberOfLines={canClamp ? REFLECTION_CLAMP_LINES : undefined}
        style={contentStyle}
      >
        {reflection.content}
      </Text>
    </View>
  );
  const menuItems: DropdownMenuItem[] = isOwn
    ? [
        {
          key: "delete",
          label: s.reflectionDeleteAction,
          destructive: true,
          icon: (color) => <Trash2 size={16} color={color} />,
          onPress: removal.request,
        },
      ]
    : [
        {
          key: "report",
          label: report.reported ? s.reflectionReported : s.reflectionReportAction,
          icon: (color) => <Flag size={16} color={color} />,
          onPress: report.request,
          disabled: report.reported,
        },
      ];

  // Deleted on this device: gone at once, and back if the server refuses.
  if (hidden) return null;

  return (
    <>
      <View
        className={isFeed ? "mb-3 border px-4 py-4" : "mb-2.5 px-4 py-3.5"}
        style={{
          backgroundColor: themeColors.surfaceLow,
          position: "relative",
          borderRadius: isFeed ? 28 : 24,
          borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,54,56,0.08)",
          borderWidth: isFeed ? 1 : 0,
          shadowColor: "#003638",
          shadowOffset: { width: 0, height: isFeed ? 8 : 0 },
          shadowOpacity: isFeed && !isDark ? 0.045 : 0,
          shadowRadius: isFeed ? 22 : 0,
          elevation: isFeed ? 1 : 0,
        }}
      >
        <View className={`${rowClassName} items-center justify-between mb-2`} style={rowFlexStyle}>
          <View className={`${rowClassName} min-w-0 flex-1 items-center gap-2`} style={rowFlexStyle}>
            <Pressable
              onPress={openProfile}
              accessibilityRole="button"
              className="min-w-0 flex-1"
              style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
            >
              <ProfileIdentity
                displayName={authorName}
                username={reflection.profiles?.username}
                avatarUrl={reflection.profiles?.avatar_url}
                isDark={isDark}
                isRTL={isRTL}
                avatarSize={isFeed ? 40 : 32}
                nameSize={isFeed ? 14 : 13}
                handleSize={10}
              />
            </Pressable>
            <ReflectionTime
              relative={formatLocalRelativeTime(reflection.created_at, s.justNow, uiLanguage)}
              full={formatCommentDateTime(reflection.created_at, uiLanguage)}
              hint={s.commentFullDateHint}
              revealed={timeRevealed}
              onReveal={setTimeRevealed}
              color={mutedColor}
            />
          </View>

          {user && !sending ? (
            <DropdownMenu items={menuItems} triggerLabel={s.reflectionMoreOptions} align="end" isRTL={isRTL} />
          ) : null}
        </View>

        {/* Lone actions sit in pinned rows: hand-mirrored alignSelf flipped twice under an RTL ancestor. */}
        {showReference && referenceLabel ? (
          <View className={`${rowClassName} mb-2`} style={rowFlexStyle}>
            <Pressable
              onPress={() => onReferencePress?.(reflection)}
              accessibilityRole="link"
              hitSlop={8}
              className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-3 py-1.5"
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, textAlign: contentAlign }}
              >
                {referenceLabel}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {onPress && !sending ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onPress(reflection.id)}
            style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
          >
            {contentText}
          </Pressable>
        ) : (
          contentText
        )}
        {canClamp && clamped ? (
          <View className={`${rowClassName} mb-2`} style={rowFlexStyle}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onPress?.(reflection.id)}
              className="min-h-11 justify-center"
            >
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
              >
                {s.reflectionReadMore}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View
          className={`${rowClassName} items-center gap-2`}
          style={{
            ...rowFlexStyle,
            ...(isFeed ? { borderTopWidth: 1, borderTopColor: themeColors.surfaceHigh, paddingTop: 12 } : null),
          }}
        >
          <Pressable
            onPress={handleLike}
            accessibilityRole="button"
            accessibilityLabel={liked ? s.removeReflectionLike : s.likeReflection}
            accessibilityValue={{ text: formatCompactCount(likesCount, uiLanguage) }}
            disabled={sending}
            className={`${rowClassName} items-center gap-1 rounded-full px-2.5 py-1.5`}
            style={({ pressed }) => ({
              ...rowFlexStyle,
              opacity: pressed || sending ? 0.6 : 1,
              backgroundColor: themeColors.surfaceMid,
            })}
          >
            <Heart size={15} color={heartColor} fill={liked ? "#ef4444" : "none"} />
            {(isFeed || likesCount > 0) && (
              <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: mutedColor }}>
                {formatCompactCount(likesCount, uiLanguage)}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => onCommentsPress(reflection.id)}
            accessibilityRole="button"
            accessibilityLabel={s.reflectionComments}
            accessibilityValue={{ text: formatCompactCount(reflection.comments_count, uiLanguage) }}
            disabled={sending}
            className={`${rowClassName} items-center gap-1 rounded-full px-2.5 py-1.5`}
            style={({ pressed }) => ({
              ...rowFlexStyle,
              opacity: pressed || sending ? 0.6 : 1,
              backgroundColor: themeColors.surfaceMid,
            })}
          >
            <MessageCircle size={15} color={mutedColor} />
            {(isFeed || reflection.comments_count > 0) && (
              <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: mutedColor }}>
                {formatCompactCount(reflection.comments_count, uiLanguage)}
              </Text>
            )}
          </Pressable>
        </View>

        {error ? (
          <Text
            className="mt-2 text-red-600 dark:text-red-400"
            style={{
              fontFamily: "Manrope_500Medium",
              fontSize: 12,
              textAlign: contentAlign,
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {error}
          </Text>
        ) : null}
      </View>
      <ConfirmDialog
        visible={removal.open}
        title={s.reflectionDeleteTitle}
        message={s.reflectionDeleteBody}
        cancelLabel={s.reflectionCancel}
        confirmLabel={s.reflectionDeleteConfirm}
        destructive
        isDark={isDark}
        isRTL={isRTL}
        onCancel={removal.cancel}
        onConfirm={removal.confirm}
      />
      <ConfirmDialog
        visible={report.open}
        title={s.reflectionReportTitle}
        message={s.reflectionReportBody}
        cancelLabel={s.reflectionCancel}
        confirmLabel={s.reflectionReportConfirm}
        tone="info"
        isDark={isDark}
        isRTL={isRTL}
        onCancel={report.cancel}
        onConfirm={report.confirm}
      />
    </>
  );
}
