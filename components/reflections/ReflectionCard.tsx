import { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import { Heart, MessageCircle, MoreHorizontal, Flag } from "lucide-react-native";
import { useAuthStore } from "@/lib/auth/store";
import { hapticLight } from "@/lib/haptics";
import { toggleLike, reportReflection } from "@/lib/reflections/api";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import type { Reflection } from "@/lib/reflections/types";

type Props = {
  reflection: Reflection;
  onLikeToggled: (reflectionId: string, liked: boolean, delta: number) => void;
  onCommentsPress: (reflectionId: string) => void;
  variant?: "compact" | "feed";
  showReference?: boolean;
  referenceLabel?: string;
  onReferencePress?: (reflection: Reflection) => void;
  onAuthRequired?: () => void;
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

export function ReflectionCard({
  reflection,
  onLikeToggled,
  onCommentsPress,
  variant = "compact",
  showReference = false,
  referenceLabel,
  onReferencePress,
  onAuthRequired,
}: Props) {
  const { isDark, isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  const user = useAuthStore((s) => s.user);
  const [liked, setLiked] = useState(reflection.user_has_liked ?? false);
  const [likesCount, setLikesCount] = useState(reflection.likes_count);
  const [showMenu, setShowMenu] = useState(false);
  const [reported, setReported] = useState(false);

  const authorName =
    reflection.profiles?.display_name || reflection.profiles?.username || s.genericAnonymous;

  useEffect(() => {
    setLiked(reflection.user_has_liked ?? false);
    setLikesCount(reflection.likes_count);
  }, [reflection.id, reflection.likes_count, reflection.user_has_liked]);

  const handleLike = useCallback(async () => {
    if (!user) {
      onAuthRequired?.();
      return;
    }
    hapticLight();
    const wasLiked = liked;
    // Optimistic update
    setLiked(!wasLiked);
    setLikesCount((c) => c + (wasLiked ? -1 : 1));
    onLikeToggled(reflection.id, !wasLiked, wasLiked ? -1 : 1);

    try {
      await toggleLike(user.id, reflection.id, wasLiked);
    } catch {
      // Revert on error
      setLiked(wasLiked);
      setLikesCount((c) => c + (wasLiked ? 1 : -1));
      onLikeToggled(reflection.id, wasLiked, wasLiked ? 1 : -1);
    }
  }, [user, liked, reflection.id, onLikeToggled, onAuthRequired]);

  const handleReport = useCallback(async () => {
    if (!user) return;
    setShowMenu(false);
    try {
      await reportReflection(user.id, reflection.id);
      setReported(true);
    } catch {
      // silently fail
    }
  }, [user, reflection.id]);

  const mutedColor = isDark ? "#737373" : "#A39B93";
  const heartColor = liked ? "#ef4444" : mutedColor;
  const contentAlign = isRTL ? "right" : "left";
  const rowClassName = isRTL ? "flex-row-reverse" : "flex-row";
  const menuSide = isRTL ? { left: 12 } : { right: 12 };
  const isFeed = variant === "feed";

  return (
    <View
      className={isFeed ? "mb-3 border px-4 py-4" : "mb-2.5 px-4 py-3.5"}
      style={{
        backgroundColor: isDark ? "#171717" : "#FAF8F5",
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
      <View className={`${rowClassName} items-center justify-between mb-2`}>
        <View className={`${rowClassName} items-center gap-2`}>
          <View
            className={`${isFeed ? "h-10 w-10" : "h-8 w-8"} rounded-full items-center justify-center`}
            style={{ backgroundColor: isDark ? "#003638" : "#00595B" }}
          >
            <Text
              style={{ fontFamily: "Manrope_700Bold", fontSize: isFeed ? 14 : 12, color: "#FDDC91" }}
            >
              {authorName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: isFeed ? 14 : 13, textAlign: contentAlign }}
          >
            {authorName}
          </Text>
          <Text
            style={{ fontFamily: "Manrope_400Regular", fontSize: 11, color: mutedColor }}
          >
            {relativeTime(reflection.created_at, s.justNow, uiLanguage)}
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
            backgroundColor: isDark ? "#262626" : "#FFFFFF",
            shadowColor: "#003638",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.08,
            shadowRadius: 16,
            elevation: 4,
          }}
        >
          <Pressable
            onPress={handleReport}
            disabled={reported}
            className={`${rowClassName} items-center gap-2 px-3 py-2`}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Flag size={14} color={reported ? mutedColor : "#ef4444"} />
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 13,
                color: reported ? mutedColor : (isDark ? "#e5e5e5" : "#2D2D2D"),
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

      <View
        className={`${rowClassName} items-center gap-2`}
        style={isFeed ? { borderTopWidth: 1, borderTopColor: isDark ? "#242424" : "#EEE7DE", paddingTop: 12 } : undefined}
      >
        <Pressable
          onPress={handleLike}
          className={`${rowClassName} items-center gap-1 rounded-full px-2.5 py-1.5`}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            backgroundColor: isDark ? "#202020" : "#F0EAE2",
          })}
        >
          <Heart
            size={15}
            color={heartColor}
            fill={liked ? "#ef4444" : "none"}
          />
          {(isFeed || likesCount > 0) && (
            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: mutedColor }}>
              {likesCount}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => onCommentsPress(reflection.id)}
          className={`${rowClassName} items-center gap-1 rounded-full px-2.5 py-1.5`}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            backgroundColor: isDark ? "#202020" : "#F0EAE2",
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
    </View>
  );
}
