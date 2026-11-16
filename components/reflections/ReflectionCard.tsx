import { useLayoutEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { reflectionQueryKeys } from "@/lib/reflections/query-keys";
import { useReflectionMutationScope, type ReflectionMutationLease } from "./use-mutation-scope";
import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { Heart, MessageCircle, Flag, Trash2 } from "lucide-react-native";
import { useAuthStore } from "@/lib/auth/store";
import { hapticLight } from "@/lib/haptics";
import { toggleLike } from "@/lib/reflections/api";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { formatCompactCount } from "@/lib/reflections/format";
import type { Reflection } from "@/lib/reflections/types";
import { ProfileIdentity } from "@/components/profile/ProfileIdentity";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { formatCommentDateTime, formatLocalRelativeTime, ReflectionTime } from "./ReflectionTime";
import { useDeleteReflection, useReportReflection } from "./use-reflection-actions";

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
  onNavigate?: () => void;
  clamp?: boolean;
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
  const { begin, pending } = useReflectionMutationScope(reflection.id, user?.id);
  const currentReflection = useRef(reflection);
  useLayoutEffect(() => {
    currentReflection.current = reflection;
  }, [reflection]);
  const [preview, setPreview] = useState<{
    lease: ReflectionMutationLease;
    baseLiked: boolean;
    baseCount: number;
    liked: boolean;
    count: number;
  } | null>(null);
  const [failure, setFailure] = useState<"like" | "auth" | null>(null);
  const [timeRevealed, setTimeRevealed] = useState(false);
  const [clamped, setClamped] = useState(false);
  const likeBusy = pending.has("like");
  const report = useReportReflection(reflection);
  const removal = useDeleteReflection(reflection, onGone);
  const isOwn = !!user && reflection.user_id === user.id;
  const canonicalLiked = reflection.user_has_liked ?? false;
  const activePreview =
    preview?.lease.isCurrent() && preview.baseLiked === canonicalLiked && preview.baseCount === reflection.likes_count
      ? preview
      : null;
  const liked = activePreview?.liked ?? canonicalLiked;
  const likesCount = activePreview?.count ?? reflection.likes_count;
  const error = failure === "like" ? s.reflectionLikeFailed : failure === "auth" ? s.reflectionFeedAuthRequired : null;
  const authorName = reflection.profiles?.display_name || reflection.profiles?.username || s.genericAnonymous;

  useLayoutEffect(() => {
    setPreview(null);
    setFailure(null);
    setTimeRevealed(false);
  }, [reflection.id, user?.id]);

  const handleLike = useCallback(async () => {
    if (!user) {
      if (onAuthRequired) onAuthRequired();
      else setFailure("auth");
      return;
    }
    const lease = begin("like");
    if (!lease) return;
    const desired = !liked;
    setFailure(null);
    hapticLight();
    setPreview({
      lease,
      baseLiked: canonicalLiked,
      baseCount: reflection.likes_count,
      liked: desired,
      count: Math.max(0, likesCount + (desired ? 1 : -1)),
    });
    try {
      await toggleLike(user.id, reflection.id, liked);
      if (!lease.isCurrent()) return;
      const latest = currentReflection.current,
        before = latest.user_has_liked ?? false;
      const delta = before === desired ? 0 : desired ? 1 : -1;
      setPreview({
        lease,
        baseLiked: before,
        baseCount: latest.likes_count,
        liked: desired,
        count: Math.max(0, latest.likes_count + delta),
      });
      if (delta) onLikeToggled(reflection.id, desired, delta);
      for (let ayah = reflection.ayah_start; ayah <= reflection.ayah_end; ayah++) {
        void queryClient.invalidateQueries({
          queryKey: reflectionQueryKeys.reflections.ayah({ surah: reflection.surah, ayah }),
        });
      }
      void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.feed.all });
    } catch {
      if (lease.isCurrent()) {
        setPreview(null);
        setFailure("like");
      }
    } finally {
      lease.release();
    }
  }, [user, begin, liked, canonicalLiked, likesCount, reflection, onLikeToggled, onAuthRequired, queryClient]);

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
  const canClamp = clamp && !!onPress;
  const contentText = (
    <View style={{ marginBottom: canClamp && clamped ? 4 : isFeed ? 14 : 12 }}>
      {canClamp ? (
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
          disabled: removal.pending,
        },
      ]
    : [
        {
          key: "report",
          label: report.reported ? s.reflectionReported : s.reflectionReportAction,
          icon: (color) => <Flag size={16} color={color} />,
          onPress: report.request,
          disabled: report.reported || report.pending,
        },
      ];

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
          <View className={`${rowClassName} items-center gap-2`} style={rowFlexStyle}>
            <Pressable
              onPress={openProfile}
              accessibilityRole="button"
              className="min-w-0"
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

          {user ? (
            <DropdownMenu items={menuItems} triggerLabel={s.reflectionMoreOptions} align="end" isRTL={isRTL} />
          ) : null}
        </View>

        {showReference && referenceLabel ? (
          <Pressable
            onPress={() => onReferencePress?.(reflection)}
            accessibilityRole="link"
            hitSlop={8}
            className={`mb-2 self-start rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-3 py-1.5 ${isRTL ? "self-end" : "self-start"}`}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Text
              className="text-primary-accent dark:text-primary-bright"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, textAlign: contentAlign }}
            >
              {referenceLabel}
            </Text>
          </Pressable>
        ) : null}

        {onPress ? (
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
          <Pressable
            accessibilityRole="button"
            onPress={() => onPress?.(reflection.id)}
            className="mb-2 min-h-11 justify-center"
            style={{ alignSelf: isRTL ? "flex-end" : "flex-start" }}
          >
            <Text
              className="text-primary-accent dark:text-primary-bright"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
            >
              {s.reflectionReadMore}
            </Text>
          </Pressable>
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
            disabled={likeBusy}
            className={`${rowClassName} items-center gap-1 rounded-full px-2.5 py-1.5`}
            style={({ pressed }) => ({
              ...rowFlexStyle,
              opacity: pressed || likeBusy ? 0.6 : 1,
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
            className={`${rowClassName} items-center gap-1 rounded-full px-2.5 py-1.5`}
            style={({ pressed }) => ({
              ...rowFlexStyle,
              opacity: pressed ? 0.6 : 1,
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
        pendingLabel={s.reflectionDeleting}
        destructive
        confirmLoading={removal.pending}
        error={removal.error}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={removal.cancel}
        onConfirm={() => void removal.confirm()}
      />
      <ConfirmDialog
        visible={report.open}
        title={s.reflectionReportTitle}
        message={s.reflectionReportBody}
        cancelLabel={s.reflectionCancel}
        confirmLabel={s.reflectionReportConfirm}
        pendingLabel={s.reflectionReporting}
        tone="info"
        confirmLoading={report.pending}
        error={report.error}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={report.cancel}
        onConfirm={() => void report.confirm()}
      />
    </>
  );
}
