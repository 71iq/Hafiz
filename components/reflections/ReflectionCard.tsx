import { useLayoutEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { reflectionQueryKeys } from "@/lib/reflections/query-keys";
import { useReflectionMutationScope, type ReflectionMutationLease } from "./use-mutation-scope";
import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { Heart, MessageCircle, MoreHorizontal, Flag } from "lucide-react-native";
import { useAuthStore } from "@/lib/auth/store";
import { hapticLight } from "@/lib/haptics";
import { toggleLike, reportReflection } from "@/lib/reflections/api";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { formatRelativeTime } from "@/lib/i18n/relative-time";
import type { Reflection } from "@/lib/reflections/types";
import { ProfileIdentity } from "@/components/profile/ProfileIdentity";

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
  const [showMenu, setShowMenu] = useState(false);
  const [reported, setReported] = useState(false);
  const [failure, setFailure] = useState<"like" | "report" | null>(null);
  const likeBusy = pending.has("like"),
    reportBusy = pending.has("report");
  const canonicalLiked = reflection.user_has_liked ?? false;
  const activePreview =
    preview?.lease.isCurrent() && preview.baseLiked === canonicalLiked && preview.baseCount === reflection.likes_count
      ? preview
      : null;
  const liked = activePreview?.liked ?? canonicalLiked;
  const likesCount = activePreview?.count ?? reflection.likes_count;
  const error = failure === "like" ? s.reflectionLikeFailed : failure === "report" ? s.reflectionReportFailed : null;
  const authorName = reflection.profiles?.display_name || reflection.profiles?.username || s.genericAnonymous;

  useLayoutEffect(() => {
    setPreview(null);
    setReported(false);
    setFailure(null);
    setShowMenu(false);
  }, [reflection.id, user?.id]);

  const handleLike = useCallback(async () => {
    if (!user) {
      onAuthRequired?.();
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

  const handleReport = useCallback(async () => {
    if (!user || reported) return;
    const lease = begin("report");
    if (!lease) return;
    setShowMenu(false);
    setFailure(null);
    try {
      await reportReflection(user.id, reflection.id);
      if (lease.isCurrent()) setReported(true);
    } catch {
      if (lease.isCurrent()) setFailure("report");
    } finally {
      lease.release();
    }
  }, [user, reported, begin, reflection.id]);

  const mutedColor = isDark ? "#737373" : "#A39B93";
  const heartColor = liked ? "#ef4444" : mutedColor;
  const contentAlign = isRTL ? "right" : "left";
  const rowClassName = isRTL ? "flex-row-reverse" : "flex-row";
  const rowFlexStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? ("row-reverse" as const) : ("row" as const),
  };
  const menuSide = isRTL ? { left: 12 } : { right: 12 };
  const isFeed = variant === "feed";
  const openProfile = useCallback(() => {
    onNavigate?.();
    router.push(reflection.user_id === user?.id ? ("/profile" as any) : (`/profile/${reflection.user_id}` as any));
  }, [onNavigate, reflection.user_id, user?.id]);
  const contentText = (
    <Text
      className="text-charcoal dark:text-neutral-200"
      style={{
        fontFamily: "Manrope_400Regular",
        fontSize: isFeed ? 15 : 14,
        lineHeight: isFeed ? 25 : 23,
        marginBottom: isFeed ? 14 : 12,
        textAlign: contentAlign,
        writingDirection: isRTL ? "rtl" : "ltr",
      }}
    >
      {reflection.content}
    </Text>
  );

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
            <Text style={{ fontFamily: "Manrope_400Regular", fontSize: 11, color: mutedColor }}>
              {formatRelativeTime(reflection.created_at, s.justNow, uiLanguage)}
            </Text>
          </View>

          {user && (
            <Pressable
              onPress={() => setShowMenu((v) => !v)}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
            >
              <MoreHorizontal size={16} color={mutedColor} />
            </Pressable>
          )}
        </View>

        {showMenu && (
          <View
            style={{
              position: "absolute",
              top: 40,
              ...menuSide,
              zIndex: 10,
              borderRadius: 12,
              padding: 4,
              backgroundColor: themeColors.surfaceBright,
              shadowColor: "#003638",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.08,
              shadowRadius: 16,
              elevation: 4,
            }}
          >
            <Pressable
              onPress={handleReport}
              disabled={reported || reportBusy}
              className={`${rowClassName} items-center gap-2 px-3 py-2`}
              style={({ pressed }) => ({
                ...rowFlexStyle,
                opacity: pressed || reported || reportBusy ? 0.6 : 1,
              })}
            >
              <Flag size={14} color={reported ? mutedColor : "#ef4444"} />
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 13,
                  color: reported ? mutedColor : isDark ? "#e5e5e5" : "#2D2D2D",
                }}
              >
                {reported ? s.reflectionReported : s.reflectionReport}
              </Text>
            </Pressable>
          </View>
        )}

        {showReference && referenceLabel ? (
          <Pressable
            onPress={() => onReferencePress?.(reflection)}
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
              <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: mutedColor }}>{likesCount}</Text>
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
                {reflection.comments_count}
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
    </>
  );
}
