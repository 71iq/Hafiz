import { useState, useCallback, useLayoutEffect, useRef } from "react";
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { DiscardChangesDialog, isEditableTextDirty, useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { Input } from "@/components/ui/Input";
import { AyahTextPreview, useAyahEditorContext } from "@/components/notes/AyahEditorPreview";
import { PrivateNoteSheet } from "@/components/notes/PrivateNoteSheet";
import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { formatNumber } from "@/lib/i18n/count";
import { pendingKeys, takeRecoveredDraft, useDraftAdopter, type RecoveredDraft } from "@/lib/reflections/pending";
import { useDatabase } from "@/lib/database/provider";
import { router } from "expo-router";
import { captureAuthReturn } from "@/lib/auth/return-origin";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { useReflectionMutationScope } from "./use-mutation-scope";
import { usePostReflection } from "./use-reflection-actions";
import { textStartStyle } from "@/lib/ui/direction";

export const REFLECTION_MIN_LENGTH = 10;
export const REFLECTION_MAX_LENGTH = 5000;
const INPUT_MIN_HEIGHT = 132;
/** The reflection input grows with its text up to this share of the sheet height. */
const INPUT_MAX_SHARE = 0.5;

type Props = {
  open: boolean;
  onClose: () => void;
  surah: number;
  ayahStart: number;
  ayahEnd: number;
  ayahPreview?: string; // text reference like "Al-Baqarah 2:255"
  /** After Post: the reflection shows at once and the sheet has closed while the server saves it. */
  onSuccess?: () => void;
  /** Called after this sheet closes for a navigation, so a sheet that contains it can close too. */
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
  const user = useAuthStore((s) => s.user);
  // The draft, also kept in a ref so two Post presses before a render publish it once.
  const [content, setContentState] = useState("");
  const contentRef = useRef("");
  const setContent = useCallback((next: string) => {
    contentRef.current = next;
    setContentState(next);
  }, []);
  const [failure, setFailure] = useState<RecoveredDraft["failure"] | null>(null);
  const error = failure === "post" ? s.reflectionPostFailed : null;
  const [privateNoteOpen, setPrivateNoteOpen] = useState(false);
  const [contentHeight, setContentHeight] = useState(INPUT_MIN_HEIGHT);
  const { retire } = useReflectionMutationScope(JSON.stringify([open, surah, ayahStart, ayahEnd]), user?.id, db);
  const postReflection = usePostReflection();
  // A post that failed after this sheet closed comes back here, with its reason, when the input is empty.
  const draftKey = open && user ? pendingKeys.reflectionDraft(user.id, { surah, ayahStart, ayahEnd }) : null;
  const adoptDraft = useCallback(
    (draft: RecoveredDraft) => {
      if (contentRef.current.trim()) return false;
      setContent(draft.content);
      setFailure(draft.failure);
      return true;
    },
    [setContent],
  );
  useDraftAdopter(draftKey, adoptDraft);
  // A new target, account or database starts empty, or from its failed draft. An account change
  // clears the draft without asking, so a guest or another account never inherits it.
  useLayoutEffect(() => {
    setContent("");
    setFailure(null);
    setPrivateNoteOpen(false);
    const draft = draftKey ? takeRecoveredDraft(draftKey) : null;
    if (draft) adoptDraft(draft);
  }, [open, surah, ayahStart, ayahEnd, user?.id, db, draftKey, setContent, adoptDraft]);

  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 640);
  const inputHeight = Math.max(INPUT_MIN_HEIGHT, Math.min(contentHeight, maxOverlayHeight * INPUT_MAX_SHARE));
  const mutedColor = isDark ? "#737373" : "#A39B93";
  const helperColor = isDark ? "#a3a3a3" : "#6E5A47";
  const errorColor = isDark ? "#f87171" : "#dc2626";
  // Counted as posted: surrounding whitespace is trimmed before saving.
  const charCount = content.trim().length;
  const isValid = charCount >= REFLECTION_MIN_LENGTH && charCount <= REFLECTION_MAX_LENGTH;
  const dirty = isEditableTextDirty(content, "");
  const ayah = useAyahEditorContext({ surah, ayahStart, ayahEnd }, open);
  const reference = ayah.reference ?? ayahPreview;

  // Post publishes at once: the sheet closes and the reflection shows while the server saves it.
  // A failure brings the draft back to this sheet (lib/reflections/pending.ts).
  const handleSubmit = useCallback(() => {
    const draft = contentRef.current,
      length = draft.trim().length;
    if (!open || !user || length < REFLECTION_MIN_LENGTH || length > REFLECTION_MAX_LENGTH) return;
    const sent = postReflection({ viewerId: user.id, surah, ayahStart, ayahEnd, draft });
    if (!sent) return;
    retire();
    setContent("");
    setFailure(null);
    onClose();
    onSuccess?.();
  }, [open, user, surah, ayahStart, ayahEnd, postReflection, retire, setContent, onClose, onSuccess]);

  const closeNow = useCallback(() => {
    if (!retire()) return;
    setContent("");
    setFailure(null);
    onClose();
  }, [onClose, retire, setContent]);

  const { guard, dialogProps } = useDiscardGuard(dirty);
  const handleClose = useCallback(() => guard(closeNow), [closeNow, guard]);

  const handleLogin = useCallback(() => {
    // The return target holds only the ayah range; the guest's text is not carried into the account.
    captureAuthReturn({ route: "reflection-editor", params: { surah, ayahStart, ayahEnd } });
    closeNow();
    onNavigate?.();
    router.push("/auth/login");
  }, [ayahEnd, ayahStart, closeNow, onNavigate, surah]);

  const privateNoteSaved = useCallback(() => {
    // The note was the chosen destination: the reflection draft is done, and nothing was posted.
    setPrivateNoteOpen(false);
    closeNow();
  }, [closeNow]);

  const savePrivatelyButton = (
    <Pressable
      accessibilityRole="button"
      onPress={() => setPrivateNoteOpen(true)}
      className="min-h-11 items-center justify-center rounded-full border border-warm-300 px-5 py-2.5 dark:border-neutral-700"
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
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
                value={content}
                onChangeText={(next) => {
                  setContent(next);
                  if (failure) setFailure(null);
                }}
                accessibilityLabel={s.reflectionWriteTitle}
                placeholder={s.reflectionPlaceholder}
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
                  {failure === "post" ? (
                    <View
                      className="flex-wrap gap-2"
                      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
                    >
                      <Pressable
                        accessibilityRole="button"
                        onPress={handleSubmit}
                        disabled={!isValid}
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

              {/* Who sees this post, beside the action that publishes it. */}
              <Text
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 12,
                  lineHeight: 18,
                  // A readable tone (about 6:1 and 7:1), not the placeholder's: this line tells the
                  // writer who can see what they write.
                  color: helperColor,
                  marginBottom: 8,
                  ...textStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.reflectionAudiencePublic}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !isValid }}
                onPress={handleSubmit}
                disabled={!isValid}
                className="min-h-11 flex-row items-center justify-center gap-2 rounded-full bg-primary-accent px-5 py-2.5 dark:bg-primary-bright"
                style={({ pressed }) => ({
                  opacity: !isValid ? 0.5 : pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#FFFFFF" }}>
                  {s.reflectionSubmit}
                </Text>
              </Pressable>
            </>
          )}
        </OverlayBody>
      </ResponsiveSheet>
      <DiscardChangesDialog {...dialogProps} title={s.reflectionDiscardTitle} />
      {/* Saving privately is an explicit choice; it never publishes and the draft is copied, not posted. */}
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
