import { reflectionQueryKeys } from "@/lib/reflections/query-keys";
import { useState, useCallback, useLayoutEffect } from "react";
import { View, Text, Pressable, ActivityIndicator, useWindowDimensions } from "react-native";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { createReflection } from "@/lib/reflections/api";
import { useDatabase } from "@/lib/database/provider";
import { recordAchievementEvent } from "@/lib/achievements/queries";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { useReflectionMutationScope } from "./use-mutation-scope";
import { findJuzForAyah, loadMushafIndex } from "@/lib/mushaf/position";

type Props = {
  open: boolean;
  onClose: () => void;
  surah: number;
  ayahStart: number;
  ayahEnd: number;
  ayahPreview?: string; // text reference like "Al-Baqarah 2:255"
  onSuccess?: () => void;
};

export function WriteReflectionSheet({ open, onClose, surah, ayahStart, ayahEnd, ayahPreview, onSuccess }: Props) {
  const { isDark, isRTL } = useSettings();
  const { width, height } = useWindowDimensions();
  const s = useStrings();
  const db = useDatabase();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { begin, pending, retire } = useReflectionMutationScope(
    JSON.stringify([open, surah, ayahStart, ayahEnd]),
    user?.id,
    db,
  );
  const submitting = pending.has("submit");
  useLayoutEffect(() => {
    setContent("");
    setError(null);
  }, [open, surah, ayahStart, ayahEnd, user?.id, db]);

  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 640);
  const mutedColor = isDark ? "#737373" : "#A39B93";
  const charCount = content.length;
  const isValid = charCount >= 10 && charCount <= 5000;

  const handleSubmit = useCallback(async () => {
    if (!open || !user || !isValid) return;
    const lease = begin("submit");
    if (!lease) return;
    setError(null);
    try {
      const mushafIndex = await loadMushafIndex(db);
      if (!lease.isCurrent()) return;
      const juzStart = findJuzForAyah(mushafIndex, surah, ayahStart);
      const juzEnd = findJuzForAyah(mushafIndex, surah, ayahEnd);
      const reflection = await createReflection(
        user.id,
        surah,
        ayahStart,
        ayahEnd,
        Math.min(juzStart, juzEnd),
        Math.max(juzStart, juzEnd),
        content.trim(),
        lease.isCurrent,
      );
      if (!lease.isCurrent()) return;
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
        queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.reflections.ayah({ surah, ayah: a }) });
        queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.count({ surah, ayah: a }) });
      }
      queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.feed.all });
      setContent("");
      onClose();
      onSuccess?.();
    } catch (error) {
      if (!lease.isCurrent()) return;
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const message =
        error && typeof error === "object" && "message" in error && typeof error.message === "string"
          ? error.message
          : undefined;
      setError(
        code === "PGRST205" || code === "PGRST204" || message?.includes("schema cache")
          ? s.reflectionSetupRequired
          : message || s.reflectionPostFailed,
      );
    } finally {
      lease.release();
    }
  }, [
    open,
    user,
    isValid,
    begin,
    surah,
    ayahStart,
    ayahEnd,
    content,
    queryClient,
    onClose,
    onSuccess,
    db,
    s.reflectionSetupRequired,
    s.reflectionPostFailed,
  ]);

  const handleClose = useCallback(() => {
    if (!retire()) return;
    setContent("");
    setError(null);
    onClose();
  }, [onClose, retire]);

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
      dir={isRTL ? "rtl" : "ltr"}
      avoidKeyboard
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

            <Input
              editable={!submitting}
              value={content}
              onChangeText={setContent}
              placeholder={s.reflectionPlaceholder}
              placeholderTextColor={mutedColor}
              multiline
              maxLength={5000}
              dir={isRTL ? "rtl" : "ltr"}
              className="mb-2 rounded-3xl bg-surface-low px-4 py-3.5 text-charcoal dark:bg-surface-dark-low dark:text-neutral-100"
              style={{
                fontSize: 14,
                minHeight: 132,
                maxHeight: 220,
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
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#FFFFFF" }}>
                  {s.reflectionSubmit}
                </Text>
              )}
            </Pressable>
          </>
        )}
      </OverlayBody>
    </ResponsiveSheet>
  );
}
