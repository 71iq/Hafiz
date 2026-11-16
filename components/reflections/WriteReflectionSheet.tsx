import { reflectionQueryKeys } from "@/lib/reflections/query-keys";
import { useState, useCallback, useLayoutEffect } from "react";
import { View, Text, Pressable, ActivityIndicator, useWindowDimensions } from "react-native";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { DiscardChangesDialog, isEditableTextDirty, useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { useOptionalOperationNotice } from "@/components/ui/OperationNoticeProvider";
import { Input } from "@/components/ui/Input";
import { AyahTextPreview, useAyahEditorContext } from "@/components/notes/AyahEditorPreview";
import { PrivateNoteSheet } from "@/components/notes/PrivateNoteSheet";
import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { formatNumber } from "@/lib/i18n/count";
import { createReflection } from "@/lib/reflections/api";
import { SavedRowUnreadableError } from "@/lib/reflections/rows";
import { ReflectionPrivacyChangedError } from "@/lib/reflections/errors";
import { useDatabase } from "@/lib/database/provider";
import { recordAchievementEvent } from "@/lib/achievements/queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchProfilePrivacy, profilePrivacyKeys } from "@/lib/profile/privacy";
import { requireSocialOwner } from "@/lib/social/owner";
import { router } from "expo-router";
import { captureAuthReturn } from "@/lib/auth/return-origin";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { useReflectionMutationScope } from "./use-mutation-scope";
import { findJuzForAyah, loadMushafIndex } from "@/lib/mushaf/position";
import { textStartStyle } from "@/lib/ui/direction";

export const REFLECTION_MIN_LENGTH = 10;
export const REFLECTION_MAX_LENGTH = 5000;
const INPUT_MIN_HEIGHT = 132;
const INPUT_MAX_SHARE = 0.5;

type Props = {
  open: boolean;
  onClose: () => void;
  surah: number;
  ayahStart: number;
  ayahEnd: number;
  ayahPreview?: string;
  onSuccess?: () => void;
  onNavigate?: () => void;
};

export function WriteReflectionSheet({
  open,
  onClose,
  surah,
  ayahStart,
  ayahEnd,
  ayahPreview,
  onSuccess,
  onNavigate,
}: Props) {
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { width, height } = useWindowDimensions();
  const s = useStrings();
  const db = useDatabase();
  const showNotice = useOptionalOperationNotice();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const ownPrivacy = useQuery({
    queryKey: profilePrivacyKeys.mine(user?.id ?? null),
    queryFn: () => fetchProfilePrivacy(requireSocialOwner(user?.id ?? "")),
    enabled: false,
  });
  const isMinor = ownPrivacy.data?.isMinor === true;
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [privateNoteOpen, setPrivateNoteOpen] = useState(false);
  const [contentHeight, setContentHeight] = useState(INPUT_MIN_HEIGHT);
  const { begin, pending, retire } = useReflectionMutationScope(
    JSON.stringify([open, surah, ayahStart, ayahEnd]),
    user?.id,
    db,
  );
  const submitting = pending.has("submit");
  useLayoutEffect(() => {
    setContent("");
    setError(null);
    setPrivateNoteOpen(false);
  }, [open, surah, ayahStart, ayahEnd, user?.id, db]);

  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 640);
  const inputHeight = Math.max(INPUT_MIN_HEIGHT, Math.min(contentHeight, maxOverlayHeight * INPUT_MAX_SHARE));
  const mutedColor = isDark ? "#737373" : "#A39B93";
  const helperColor = isDark ? "#a3a3a3" : "#6E5A47";
  const errorColor = isDark ? "#f87171" : "#dc2626";
  const charCount = content.trim().length;
  const isValid = charCount >= REFLECTION_MIN_LENGTH && charCount <= REFLECTION_MAX_LENGTH;
  const dirty = isEditableTextDirty(content, "");
  const ayah = useAyahEditorContext({ surah, ayahStart, ayahEnd }, open);
  const reference = ayah.reference ?? ayahPreview;

  const handleSubmit = useCallback(async () => {
    if (!open || !user || !isValid) return;
    const lease = begin("submit");
    if (!lease) return;
    setError(null);
    const finishPosted = () => {
      for (let a = ayahStart; a <= ayahEnd; a++) {
        queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.reflections.ayah({ surah, ayah: a }) });
        queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.countAyah({ surah, ayah: a }) });
      }
      queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.feed.all });
      setContent("");
      onClose();
      onSuccess?.();
      showNotice(s.reflectionPosted);
    };
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
        isMinor,
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
      finishPosted();
    } catch (error) {
      const privacyChanged = error instanceof ReflectionPrivacyChangedError;
      if (privacyChanged) void queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.mine(user.id) });
      if (!lease.isCurrent()) return;
      if (error instanceof SavedRowUnreadableError) {
        finishPosted();
        return;
      }
      if (privacyChanged) {
        setError(s.reflectionPrivacyChanged);
        return;
      }
      console.warn("[WriteReflection] Failed to post:", error);
      setError(s.reflectionPostFailed);
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
    isMinor,
    queryClient,
    onClose,
    onSuccess,
    showNotice,
    db,
    s.reflectionPosted,
    s.reflectionPostFailed,
    s.reflectionPrivacyChanged,
  ]);

  const closeNow = useCallback(() => {
    if (!retire()) return;
    setContent("");
    setError(null);
    onClose();
  }, [onClose, retire]);

  const { guard, dialogProps } = useDiscardGuard(dirty);
  const handleClose = useCallback(() => guard(closeNow), [closeNow, guard]);

  const handleLogin = useCallback(() => {
    captureAuthReturn({ route: "reflection-editor", params: { surah, ayahStart, ayahEnd } });
    closeNow();
    onNavigate?.();
    router.push("/auth/login");
  }, [ayahEnd, ayahStart, closeNow, onNavigate, surah]);

  const privateNoteSaved = useCallback(() => {
    setPrivateNoteOpen(false);
    closeNow();
  }, [closeNow]);

  const savePrivatelyButton = (
    <Pressable
      accessibilityRole="button"
      onPress={() => setPrivateNoteOpen(true)}
      disabled={submitting}
      className="min-h-11 items-center justify-center rounded-full border border-warm-300 px-5 py-2.5 dark:border-neutral-700"
      style={({ pressed }) => ({ opacity: submitting ? 0.5 : pressed ? 0.8 : 1 })}
    >
      <Text
        className="text-charcoal dark:text-neutral-200"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, textAlign: "center" }}
      >
        {s.reflectionSaveAsPrivateNote}
      </Text>
    </Pressable>
  );

  return (
    <>
      <ResponsiveSheet
        open={open}
        onClose={handleClose}
        maxWidth={560}
        maxHeight={maxOverlayHeight}
        dir={isRTL ? "rtl" : "ltr"}
        avoidKeyboard
      >
        <OverlayHeader title={s.reflectionWriteTitle} subtitle={reference} onClose={handleClose} isRTL={isRTL} />
        <OverlayBody contentContainerClassName="px-5 pt-4 pb-6">
          {ayah.text ? (
            <View className="mb-3 rounded-2xl bg-surface-low px-3.5 py-3 dark:bg-surface-dark-low">
              <AyahTextPreview text={ayah.text} />
            </View>
          ) : null}
          {!user ? (
            <View className="gap-3 py-2">
              <Text
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 14,
                  lineHeight: 22,
                  color: helperColor,
                  ...textStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.reflectionLoginRequired}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={handleLogin}
                className="min-h-11 items-center justify-center rounded-full bg-primary-accent px-6 py-2.5 dark:bg-primary-bright"
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
              >
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#FFFFFF" }}>{s.authLogin}</Text>
              </Pressable>
              {savePrivatelyButton}
            </View>
          ) : (
            <>
              <Input
                editable={!submitting}
                value={content}
                onChangeText={(next) => {
                  setContent(next);
                  if (error) setError(null);
                }}
                accessibilityLabel={s.reflectionWriteTitle}
                placeholder={isMinor ? s.reflectionPlaceholderPrivate : s.reflectionPlaceholder}
                placeholderTextColor={mutedColor}
                multiline
                maxLength={REFLECTION_MAX_LENGTH}
                dir={isRTL ? "rtl" : "ltr"}
                onContentSizeChange={(event) => setContentHeight(Math.ceil(event.nativeEvent.contentSize.height) + 28)}
                className="mb-2 rounded-3xl bg-surface-low px-4 py-3.5 text-charcoal dark:bg-surface-dark-low dark:text-neutral-100"
                style={{ fontSize: 14, minHeight: INPUT_MIN_HEIGHT, height: inputHeight, textAlignVertical: "top" }}
              />

              <View
                className="mb-3 items-center justify-between gap-3"
                style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
              >
                <Text
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 12,
                    color: charCount > 0 && charCount < REFLECTION_MIN_LENGTH ? errorColor : helperColor,
                  }}
                >
                  {interpolate(s.sharedCharacterCount, {
                    n: formatNumber(charCount, uiLanguage),
                    max: formatNumber(REFLECTION_MAX_LENGTH, uiLanguage),
                  })}
                </Text>
                {charCount > 0 && charCount < REFLECTION_MIN_LENGTH ? (
                  <Text style={{ fontFamily: "Manrope_400Regular", fontSize: 12, color: errorColor }}>
                    {interpolate(s.reflectionMinChars, { n: formatNumber(REFLECTION_MIN_LENGTH, uiLanguage) })}
                  </Text>
                ) : null}
              </View>

              {error ? (
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
                  {error === s.reflectionPostFailed ? (
                    <View
                      className="flex-wrap gap-2"
                      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
                    >
                      <Pressable
                        accessibilityRole="button"
                        onPress={handleSubmit}
                        disabled={submitting || !isValid}
                        className="min-h-11 items-center justify-center rounded-full bg-surface-high px-5 py-2.5 dark:bg-surface-dark-high"
                      >
                        <Text
                          className="text-charcoal dark:text-neutral-200"
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
                        >
                          {s.sharedTryAgain}
                        </Text>
                      </Pressable>
                      {savePrivatelyButton}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {error !== s.reflectionPrivacyChanged ? (
                <Text
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 12,
                    lineHeight: 18,
                    color: helperColor,
                    marginBottom: 8,
                    ...textStartStyle(isRTL),
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {isMinor ? s.reflectionMinorPrivate : s.reflectionAudiencePublic}
                </Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !isValid || submitting, busy: submitting }}
                onPress={handleSubmit}
                disabled={!isValid || submitting}
                className="min-h-11 flex-row items-center justify-center gap-2 rounded-full bg-primary-accent px-5 py-2.5 dark:bg-primary-bright"
                style={({ pressed }) => ({
                  opacity: !isValid || submitting ? 0.5 : pressed ? 0.8 : 1,
                })}
              >
                {submitting ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#FFFFFF" }}>
                  {submitting ? s.reflectionPosting : s.reflectionSubmit}
                </Text>
              </Pressable>
            </>
          )}
        </OverlayBody>
      </ResponsiveSheet>
      <DiscardChangesDialog {...dialogProps} title={s.reflectionDiscardTitle} />
      <PrivateNoteSheet
        open={open && privateNoteOpen}
        onClose={() => setPrivateNoteOpen(false)}
        onSaved={privateNoteSaved}
        surah={surah}
        ayahStart={ayahStart}
        ayahEnd={ayahEnd}
        initialContent={content}
      />
    </>
  );
}
