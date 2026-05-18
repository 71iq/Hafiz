import { useState, useCallback, useEffect } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator } from "react-native";
import { Send } from "lucide-react-native";
import { router } from "expo-router";
import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { fetchComments, addComment } from "@/lib/reflections/api";
import type { ReflectionComment } from "@/lib/reflections/types";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";

type Props = {
  reflectionId: string | null;
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

export function CommentsSheet({ reflectionId, onClose, onCommentAdded }: Props) {
  const { isDark, isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  const user = useAuthStore((s) => s.user);
  const [comments, setComments] = useState<ReflectionComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!reflectionId) return;
    setLoading(true);
    fetchComments(reflectionId)
      .then(setComments)
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [reflectionId]);

  const handleSubmit = useCallback(async () => {
    if (!user || !reflectionId || !text.trim()) return;
    setSubmitting(true);
    try {
      const comment = await addComment(user.id, reflectionId, text.trim());
      setComments((prev) => [...prev, comment]);
      setText("");
      onCommentAdded(reflectionId);
    } catch (e) {
      console.warn("[Comments] Failed to add:", e);
    } finally {
      setSubmitting(false);
    }
  }, [user, reflectionId, text, onCommentAdded]);

  const mutedColor = isDark ? "#737373" : "#A39B93";

  return (
    <ResponsiveSheet open={!!reflectionId} onClose={onClose} maxWidth={760}>
      <OverlayHeader title={s.reflectionComments} subtitle={s.reflections} onClose={onClose} showHandle isRTL={isRTL} />
      <View className="flex-1 min-h-0 px-5 pt-4 pb-4 gap-3">
        <View
          className="rounded-2xl px-3 py-2"
          style={{ backgroundColor: isDark ? "#141414" : "#F7F3EC" }}
        >
          <Text
            style={{
              fontFamily: "Manrope_600SemiBold",
              fontSize: 10,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: mutedColor,
              textAlign: isRTL ? "right" : "left",
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {s.reflectionThreadLabel}
          </Text>
        </View>

        <OverlayBody className="flex-1 min-h-0" contentContainerClassName="pb-2">
          {loading ? (
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
            comments.map((c) => (
              <View key={c.id} className="mb-3">
                <View className={`items-center gap-2 mb-1 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                  <Text
                    className="text-charcoal dark:text-neutral-200"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                  >
                    {c.profiles?.display_name || c.profiles?.username || s.genericAnonymous}
                  </Text>
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
            ))
          )}
        </OverlayBody>

        {user ? (
          <View
            className={`items-center gap-2 rounded-2xl border border-warm-200 bg-surface-low px-3.5 py-2.5 dark:border-neutral-700 dark:bg-surface-dark-low ${isRTL ? "flex-row-reverse" : "flex-row"}`}
          >
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={s.reflectionAddComment}
              placeholderTextColor={mutedColor}
              multiline={false}
              maxLength={2000}
              className="flex-1 text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 14,
                padding: 0,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
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
          <View className="rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-3">
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
  );
}
