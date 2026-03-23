import { useState, useCallback, useEffect } from "react";
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Send } from "lucide-react-native";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/Sheet";
import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { fetchComments, addComment } from "@/lib/reflections/api";
import type { ReflectionComment } from "@/lib/reflections/types";

type Props = {
  reflectionId: string | null;
  onClose: () => void;
  onCommentAdded: (reflectionId: string) => void;
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(dateStr).toLocaleDateString();
}

export function CommentsSheet({ reflectionId, onClose, onCommentAdded }: Props) {
  const { isDark } = useSettings();
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
    <Sheet open={!!reflectionId} onClose={onClose}>
      <SheetHeader>
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, textAlign: "center" }}
        >
          {s.reflectionComments}
        </Text>
      </SheetHeader>
      <SheetContent>
        <ScrollView style={{ maxHeight: 300, marginBottom: 12 }}>
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
                <View className="flex-row items-center gap-2 mb-1">
                  <Text
                    className="text-charcoal dark:text-neutral-200"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                  >
                    {c.profiles?.display_name || c.profiles?.username || "Anonymous"}
                  </Text>
                  <Text style={{ fontFamily: "Manrope_400Regular", fontSize: 10, color: mutedColor }}>
                    {timeAgo(c.created_at)}
                  </Text>
                </View>
                <Text
                  className="text-charcoal dark:text-neutral-300"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 20 }}
                >
                  {c.content}
                </Text>
              </View>
            ))
          )}
        </ScrollView>

        {/* Comment input */}
        {user && (
          <View
            className="flex-row items-center gap-2 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-3 py-2"
          >
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={s.reflectionAddComment}
              placeholderTextColor={mutedColor}
              multiline
              maxLength={2000}
              className="flex-1 text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 14,
                maxHeight: 80,
                padding: 0,
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
        )}
      </SheetContent>
    </Sheet>
  );
}
