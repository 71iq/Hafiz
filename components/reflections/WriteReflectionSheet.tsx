import { useState, useCallback } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, useWindowDimensions } from "react-native";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { createReflection } from "@/lib/reflections/api";
import { useDatabase } from "@/lib/database/provider";
import { recordAchievementEvent } from "@/lib/achievements/queries";
import { useQueryClient } from "@tanstack/react-query";
import { interpolate } from "@/lib/i18n/useStrings";
import { router } from "expo-router";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";

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
  const { isDark, isRTL } = useSettings();
  const { width, height } = useWindowDimensions();
  const s = useStrings();
  const db = useDatabase();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 640);
  const surfaceColor = isDark ? "#1a1a1a" : "#FFF8F1";
  const mutedColor = isDark ? "#737373" : "#A39B93";
  const charCount = content.length;
  const isValid = charCount >= 10 && charCount <= 5000;

  const handleSubmit = useCallback(async () => {
    if (!user || !isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const reflection = await createReflection(user.id, surah, ayahStart, ayahEnd, content.trim());
      recordAchievementEvent(db, {
        type: "public_reflection_created",
        reflectionId: reflection.id,
        surah,
        ayahStart,
        ayahEnd,
        createdAt: reflection.created_at,
      }).catch(console.warn);
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
        : e.message || s.reflectionPostFailed;
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [user, isValid, surah, ayahStart, ayahEnd, content, queryClient, onClose, onSuccess, db]);

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
    <ResponsiveSheet
      open={open}
      onClose={handleClose}
      maxWidth={560}
      maxHeight={maxOverlayHeight}
      surfaceColor={surfaceColor}
    >
      <OverlayHeader
        title={s.addReflection}
        subtitle={s.reflections}
        onClose={handleClose}
        showHandle={isPhone}
        isRTL={isRTL}
      />
      <OverlayBody contentContainerClassName="px-5 pb-6">
        {!user ? (
          <View className="items-center py-4">
            <Text
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 14,
                color: mutedColor,
                marginBottom: 12,
                textAlign: isRTL ? "right" : "left",
              }}
            >
              {s.reflectionLoginRequired}
            </Text>
            <Pressable
              onPress={handleLogin}
              className="rounded-full bg-primary-accent dark:bg-primary-bright px-6 py-3"
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            >
              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#FFFFFF" }}>{s.authLogin}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {ayahPreview && (
              <View className="rounded-2xl bg-surface-low dark:bg-surface-dark-low px-3.5 py-3 mb-3">
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    fontSize: 10,
                    color: mutedColor,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    marginBottom: 4,
                    textAlign: isRTL ? "right" : "left",
                  }}
                >
                  {s.reflectionAyahLabel}
                </Text>
                <Text
                  className="text-warm-500 dark:text-neutral-400"
                  style={{ fontFamily: "NotoSerif_700Bold", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
                >
                  {ayahPreview}
                </Text>
              </View>
            )}

            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder={s.reflectionPlaceholder}
              placeholderTextColor={mutedColor}
              multiline
              maxLength={5000}
              textAlignVertical="top"
              className="rounded-3xl bg-surface-low dark:bg-surface-dark-low text-charcoal dark:text-neutral-100 px-4 py-3.5 mb-2"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 14,
                lineHeight: 22,
                minHeight: 132,
                maxHeight: 220,
                textAlign: isRTL ? "right" : "left",
              }}
            />

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
                  {interpolate(s.reflectionMinChars, { n: "10" })}
                </Text>
              )}
            </View>

            {error && (
              <Text
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 12,
                  color: "#ef4444",
                  marginBottom: 8,
                  textAlign: isRTL ? "right" : "left",
                }}
              >
                {error}
              </Text>
            )}

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
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#FFFFFF" }}>{s.reflectionSubmit}</Text>
              )}
            </Pressable>
          </>
        )}
      </OverlayBody>
    </ResponsiveSheet>
  );}
