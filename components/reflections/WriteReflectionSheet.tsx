import { useState, useCallback } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator } from "react-native";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/Sheet";
import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { createReflection } from "@/lib/reflections/api";
import { useQueryClient } from "@tanstack/react-query";
import { interpolate } from "@/lib/i18n/useStrings";
import { router } from "expo-router";

type Props = {
  open: boolean;
  onClose: () => void;
  surah: number;
  ayahStart: number;
  ayahEnd: number;
  ayahPreview?: string; // text reference like "Al-Baqarah 2:255"
  onSuccess?: () => void;
};

export function WriteReflectionSheet({
  open,
  onClose,
  surah,
  ayahStart,
  ayahEnd,
  ayahPreview,
  onSuccess,
}: Props) {
  const { isDark } = useSettings();
  const s = useStrings();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutedColor = isDark ? "#737373" : "#A39B93";
  const charCount = content.length;
  const isValid = charCount >= 10 && charCount <= 5000;

  const handleSubmit = useCallback(async () => {
    if (!user || !isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await createReflection(user.id, surah, ayahStart, ayahEnd, content.trim());
      // Invalidate reflection queries for this ayah range
      for (let a = ayahStart; a <= ayahEnd; a++) {
        queryClient.invalidateQueries({ queryKey: ["reflections", surah, a] });
        queryClient.invalidateQueries({ queryKey: ["reflectionCount", surah, a] });
      }
      setContent("");
      onClose();
      onSuccess?.();
    } catch (e: any) {
      const message = e.code === "PGRST205" || e.message?.includes("schema cache")
        ? s.reflectionSetupRequired
        : e.message || "Failed to post reflection";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [user, isValid, surah, ayahStart, ayahEnd, content, queryClient, onClose, onSuccess]);

  const handleClose = useCallback(() => {
    setContent("");
    setError(null);
    onClose();
  }, [onClose]);

  const handleLogin = useCallback(() => {
    handleClose();
    router.push("/auth/login");
  }, [handleClose]);

  return (
    <Sheet open={open} onClose={handleClose}>
      <SheetHeader>
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, textAlign: "center" }}
        >
          {s.addReflection}
        </Text>
      </SheetHeader>
      <SheetContent>
        {!user ? (
          /* Not logged in */
          <View className="items-center py-4">
            <Text
              style={{ fontFamily: "Manrope_400Regular", fontSize: 14, color: mutedColor, marginBottom: 12 }}
            >
              {s.reflectionLoginRequired}
            </Text>
            <Pressable
              onPress={handleLogin}
              className="rounded-full bg-primary-accent dark:bg-primary-bright px-6 py-3"
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            >
              <Text
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#FFFFFF" }}
              >
                {s.authLogin}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Ayah reference */}
            {ayahPreview && (
              <View className="rounded-xl bg-surface-low dark:bg-surface-dark-low px-3 py-2 mb-3">
                <Text
                  className="text-warm-500 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
                >
                  {ayahPreview}
                </Text>
              </View>
            )}

            {/* Text area */}
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder={s.reflectionPlaceholder}
              placeholderTextColor={mutedColor}
              multiline
              maxLength={5000}
              textAlignVertical="top"
              className="rounded-2xl bg-surface-low dark:bg-surface-dark-low text-charcoal dark:text-neutral-100 px-4 py-3 mb-2"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 14,
                lineHeight: 22,
                minHeight: 120,
                maxHeight: 200,
              }}
            />

            {/* Character count */}
            <View className="flex-row items-center justify-between mb-3">
              <Text
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 11,
                  color: charCount < 10 ? "#ef4444" : mutedColor,
                }}
              >
                {interpolate(s.reflectionCharCount, { n: String(charCount) })}
              </Text>
              {charCount > 0 && charCount < 10 && (
                <Text style={{ fontFamily: "Manrope_400Regular", fontSize: 11, color: "#ef4444" }}>
                  {interpolate("Min {{n}} characters", { n: "10" })}
                </Text>
              )}
            </View>

            {/* Error message */}
            {error && (
              <Text
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 12,
                  color: "#ef4444",
                  marginBottom: 8,
                }}
              >
                {error}
              </Text>
            )}

            {/* Submit button */}
            <Pressable
              onPress={handleSubmit}
              disabled={!isValid || submitting}
              className="rounded-full bg-primary-accent dark:bg-primary-bright py-3 items-center"
              style={({ pressed }) => ({
                opacity: !isValid || submitting ? 0.5 : pressed ? 0.8 : 1,
              })}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#FFFFFF" }}
                >
                  {s.reflectionSubmit}
                </Text>
              )}
            </Pressable>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
