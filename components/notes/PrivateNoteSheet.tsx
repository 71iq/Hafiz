import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { createPrivateNote, updatePrivateNote, type PrivateNote } from "@/lib/notes/queries";

type Props = {
  open: boolean;
  onClose: () => void;
  surah: number;
  ayahStart: number;
  ayahEnd: number;
  note?: PrivateNote | null;
  ayahPreview?: string;
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
  onSaved,
}: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const { width, height } = useWindowDimensions();
  const [content, setContent] = useState(note?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 620);
  const mutedColor = isDark ? "#737373" : "#A39B93";
  const isValid = content.trim().length > 0;

  useEffect(() => {
    if (open) {
      setContent(note?.content ?? "");
      setError(false);
    }
  }, [note?.content, open]);

  const handleSave = useCallback(async () => {
    if (!isValid || saving) return;
    setSaving(true);
    setError(false);
    try {
      if (note) {
        await updatePrivateNote(db, note.id, content);
      } else {
        await createPrivateNote(db, { surah, ayahStart, ayahEnd, content });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      console.warn("[PrivateNoteSheet] save failed:", e);
      setError(true);
    } finally {
      setSaving(false);
    }
  }, [ayahEnd, ayahStart, content, db, isValid, note, onClose, onSaved, saving, surah]);

  return (
    <ResponsiveSheet
      open={open}
      onClose={onClose}
      maxWidth={560}
      maxHeight={maxOverlayHeight}
      surfaceColor={isDark ? "#1a1a1a" : "#FFF8F1"}
    >
      <OverlayHeader
        title={note ? s.privateNoteEdit : s.privateNoteTitle}
        subtitle={ayahPreview ?? `${surah}:${ayahStart}${ayahStart !== ayahEnd ? `-${ayahEnd}` : ""}`}
        onClose={onClose}
        showHandle={isPhone}
        isRTL={isRTL}
      />
      <OverlayBody contentContainerClassName="px-5 py-4">
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder={s.privateNotePlaceholder}
          placeholderTextColor={mutedColor}
          multiline
          textAlignVertical="top"
          className="rounded-3xl bg-surface-low dark:bg-surface-dark-low px-4 py-3.5 text-charcoal dark:text-neutral-100"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 14,
            lineHeight: 22,
            minHeight: 156,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        />
        {error && (
          <Text
            className="mt-2 text-red-600 dark:text-red-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
          >
            {s.privateNoteSaveFailed}
          </Text>
        )}
      </OverlayBody>
      <OverlayFooter isRTL={isRTL}>
        <Pressable
          onPress={onClose}
          className="flex-1 items-center rounded-full bg-surface-high py-3 dark:bg-surface-dark-high"
        >
          <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
            {s.flashcardsCancel}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={!isValid || saving}
          className="flex-1 items-center rounded-full bg-primary-accent py-3 dark:bg-primary-bright"
          style={({ pressed }) => ({ opacity: !isValid || saving ? 0.5 : pressed ? 0.8 : 1 })}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#FFFFFF" }}>
              {s.privateNoteSave}
            </Text>
          )}
        </Pressable>
      </OverlayFooter>
    </ResponsiveSheet>
  );
}
