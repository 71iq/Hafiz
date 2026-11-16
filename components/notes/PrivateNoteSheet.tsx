import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from "react-native";
import { formatAyahRef } from "@/lib/arabic";
import {
  OverlayBody,
  OverlayFooter,
  OverlayFooterLabel,
  OverlayHeader,
  ResponsiveSheet,
} from "@/components/ui/ResponsiveOverlay";
import { DiscardChangesDialog, isEditableTextDirty, useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { useOptionalOperationNotice } from "@/components/ui/OperationNoticeProvider";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabase } from "@/lib/database/provider";
import { formatNumber } from "@/lib/i18n/count";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import {
  createPrivateNote,
  isDuplicatePrivateNoteError,
  listPrivateNotesForAyah,
  updatePrivateNote,
  type PrivateNote,
} from "@/lib/notes/queries";
import { QF_NOTE_MAX_LENGTH, QF_NOTE_MIN_LENGTH, isQfSyncableNoteContent } from "@/lib/quran-foundation/user-types";
import { textStartStyle } from "@/lib/ui/direction";
import { AyahTextPreview, useAyahEditorContext } from "./AyahEditorPreview";

export const NOTE_COUNTER_THRESHOLD = 9000;
const INPUT_MIN_HEIGHT = 156;
const INPUT_MAX_SHARE = 0.6;

type Props = {
  open: boolean;
  onClose: () => void;
  surah: number;
  ayahStart: number;
  ayahEnd: number;
  note?: PrivateNote | null;
  ayahPreview?: string;
  initialContent?: string;
  onSaved?: () => void;
};

export function PrivateNoteSheet({
  open,
  onClose,
  surah,
  ayahStart,
  ayahEnd,
  note,
  ayahPreview,
  initialContent,
  onSaved,
}: Props) {
  const db = useDatabase();
  const s = useStrings();
  const showNotice = useOptionalOperationNotice();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const { width, height } = useWindowDimensions();
  const [openedNote, setOpenedNote] = useState<PrivateNote | null>(null);
  const activeNote = openedNote ?? note ?? null;
  const baseline = activeNote?.content ?? "";
  const startingContent = note ? note.content : (initialContent ?? "");
  const [content, setContent] = useState(startingContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [duplicate, setDuplicate] = useState<PrivateNote | "unknown" | null>(null);
  const [contentHeight, setContentHeight] = useState(INPUT_MIN_HEIGHT);
  const generation = useRef(0);
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 620);
  const inputHeight = Math.max(INPUT_MIN_HEIGHT, Math.min(contentHeight, maxOverlayHeight * INPUT_MAX_SHARE));
  const mutedColor = isDark ? "#737373" : "#A39B93";
  const helperColor = isDark ? "#a3a3a3" : "#6E5A47";
  const trimmedLength = content.trim().length;
  const tooLong = trimmedLength > QF_NOTE_MAX_LENGTH;
  const isValid = isQfSyncableNoteContent(content);
  const dirty = isEditableTextDirty(content, baseline);
  const ayah = useAyahEditorContext({ surah, ayahStart, ayahEnd }, open);

  const resetDraft = useCallback(() => {
    setOpenedNote(null);
    setContent(startingContent);
    setError(false);
    setDuplicate(null);
  }, [startingContent]);

  useLayoutEffect(() => {
    generation.current += 1;
    if (open) resetDraft();
  }, [open, note?.id, note?.content, surah, ayahStart, ayahEnd, resetDraft]);

  const { guard, dialogProps } = useDiscardGuard(dirty && !saving);
  const requestClose = useCallback(() => {
    if (saving) return;
    guard(onClose);
  }, [guard, onClose, saving]);

  const ownerRef = useRef(userId);
  useEffect(() => {
    if (ownerRef.current === userId) return;
    ownerRef.current = userId;
    generation.current += 1;
    resetDraft();
    if (open) onClose();
  }, [onClose, open, resetDraft, userId]);

  const handleContentChange = useCallback((value: string) => {
    setContent(value);
    setError(false);
    setDuplicate(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!isValid || saving) return;
    const attempt = generation.current;
    setSaving(true);
    setError(false);
    setDuplicate(null);
    try {
      if (activeNote) {
        await updatePrivateNote(db, activeNote.id, content);
      } else {
        await createPrivateNote(db, { surah, ayahStart, ayahEnd, content });
      }
      if (attempt !== generation.current) return;
      onSaved?.();
      onClose();
      showNotice(s.privateNoteSaved);
    } catch (e) {
      if (attempt !== generation.current) return;
      console.warn("[PrivateNoteSheet] save failed:", e);
      if (isDuplicatePrivateNoteError(e)) {
        const trimmed = content.trim();
        const existing = await listPrivateNotesForAyah(db, surah, ayahStart)
          .then((rows) =>
            rows.find(
              (row) =>
                row.id !== activeNote?.id &&
                row.ayahStart === ayahStart &&
                row.ayahEnd === ayahEnd &&
                row.content.trim() === trimmed,
            ),
          )
          .catch(() => undefined);
        if (attempt === generation.current) setDuplicate(existing ?? "unknown");
      } else {
        setError(true);
      }
    } finally {
      setSaving(false);
    }
  }, [activeNote, ayahEnd, ayahStart, content, db, isValid, onClose, onSaved, s.privateNoteSaved, saving, showNotice, surah]);

  const openExisting = useCallback(() => {
    if (!duplicate || duplicate === "unknown") return;
    setOpenedNote(duplicate);
    setContent(duplicate.content);
    setDuplicate(null);
    setError(false);
  }, [duplicate]);

  const fallbackReference = `${formatAyahRef(isRTL, surah, ayahStart)}${ayahStart !== ayahEnd ? `-${formatAyahRef(isRTL, ayahEnd)}` : ""}`;
  const helperStyle = { fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL) } as const;

  return (
    <>
      <ResponsiveSheet
        open={open}
        onClose={requestClose}
        maxWidth={560}
        maxHeight={maxOverlayHeight}
        dir={isRTL ? "rtl" : "ltr"}
        avoidKeyboard
      >
        <OverlayHeader
          title={activeNote ? s.privateNoteEdit : s.privateNoteTitle}
          subtitle={ayah.reference ?? ayahPreview ?? fallbackReference}
          onClose={requestClose}
          isRTL={isRTL}
        />
        <OverlayBody contentContainerClassName="px-5 py-4">
          {ayah.text ? (
            <View className="mb-3 rounded-2xl bg-surface-low px-3.5 py-3 dark:bg-surface-dark-low">
              <AyahTextPreview text={ayah.text} />
            </View>
          ) : null}
          <Input
            value={content}
            onChangeText={handleContentChange}
            accessibilityLabel={activeNote ? s.privateNoteEdit : s.privateNoteTitle}
            placeholder={s.privateNotePlaceholder}
            placeholderTextColor={mutedColor}
            multiline
            editable={!saving}
            dir={isRTL ? "rtl" : "ltr"}
            onContentSizeChange={(event) => setContentHeight(Math.ceil(event.nativeEvent.contentSize.height) + 28)}
            className="rounded-3xl bg-surface-low px-4 py-3.5 text-charcoal dark:bg-surface-dark-low dark:text-neutral-100"
            style={{ fontSize: 14, minHeight: INPUT_MIN_HEIGHT, height: inputHeight, textAlignVertical: "top" }}
          />
          <View
            className="mt-2 items-start justify-between gap-3"
            style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
          >
            <Text
              className="min-w-0 flex-1"
              style={{ ...helperStyle, color: tooLong ? (isDark ? "#f87171" : "#dc2626") : helperColor }}
            >
              {tooLong
                ? s.privateNoteLengthError
                : interpolate(s.noteMinLengthHint, { n: formatNumber(QF_NOTE_MIN_LENGTH, uiLanguage) })}
            </Text>
            {trimmedLength > NOTE_COUNTER_THRESHOLD ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{ ...helperStyle, color: tooLong ? (isDark ? "#f87171" : "#dc2626") : helperColor }}
              >
                {interpolate(s.sharedCharacterCount, {
                  n: formatNumber(trimmedLength, uiLanguage),
                  max: formatNumber(QF_NOTE_MAX_LENGTH, uiLanguage),
                })}
              </Text>
            ) : null}
          </View>
          {duplicate ? (
            <View className="mt-2">
              <Text accessibilityRole="alert" style={{ ...helperStyle, color: helperColor }}>
                {s.privateNoteDuplicate}
              </Text>
              {duplicate !== "unknown" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={openExisting}
                  className="mt-1 min-h-11 justify-center"
                  style={{ alignSelf: isRTL ? "flex-end" : "flex-start" }}
                >
                  <Text
                    className="text-primary-accent dark:text-primary-bright"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                  >
                    {s.noteOpenExisting}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" className="mt-2 text-red-600 dark:text-red-400" style={helperStyle}>
              {s.privateNoteSaveFailed}
            </Text>
          ) : null}
        </OverlayBody>
        <OverlayFooter isRTL={isRTL}>
          <Pressable
            accessibilityRole="button"
            onPress={requestClose}
            disabled={saving}
            className="min-h-11 flex-1 items-center justify-center rounded-full bg-surface-high px-4 py-2.5 dark:bg-surface-dark-high"
          >
            <OverlayFooterLabel
              className="text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            >
              {s.flashcardsCancel}
            </OverlayFooterLabel>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid || saving, busy: saving }}
            onPress={handleSave}
            disabled={!isValid || saving}
            className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-full bg-primary-accent px-4 py-2.5 dark:bg-primary-bright"
            style={({ pressed }) => ({ opacity: !isValid || saving ? 0.5 : pressed ? 0.8 : 1 })}
          >
            {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
            <OverlayFooterLabel style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#FFFFFF" }}>
              {saving ? s.saving : error ? s.sharedTryAgain : s.privateNoteSave}
            </OverlayFooterLabel>
          </Pressable>
        </OverlayFooter>
      </ResponsiveSheet>
      <DiscardChangesDialog {...dialogProps} title={s.noteDiscardTitle} />
    </>
  );
}
