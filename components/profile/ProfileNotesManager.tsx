import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { BookOpen, Edit3, NotebookPen, Search, Trash2, type LucideIcon } from "lucide-react-native";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { PrivateNoteSheet } from "@/components/notes/PrivateNoteSheet";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { setPendingDeepLink } from "@/lib/deep-link";
import { toArabicNumber } from "@/lib/arabic";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import {
  deletePrivateNote,
  searchPrivateNotes,
  type PrivateNoteSearchResult,
} from "@/lib/notes/queries";

const PROFILE_NOTES_PREVIEW_LIMIT = 4;

export function ProfileNotesManager() {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { width, height } = useWindowDimensions();
  const [notes, setNotes] = useState<PrivateNoteSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<PrivateNoteSearchResult | null>(null);
  const [deletingNote, setDeletingNote] = useState<PrivateNoteSearchResult | null>(null);
  const [allNotesOpen, setAllNotesOpen] = useState(false);
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 720);

  const refreshNotes = useCallback(() => {
    setError(null);
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      searchPrivateNotes(db, "")
        .then((rows) => {
          if (!cancelled) {
            setNotes(rows);
            setError(null);
          }
        })
        .catch((e) => {
          console.warn("[ProfileNotesManager] notes search failed:", e);
          if (!cancelled) {
            setNotes([]);
            setError(s.genericActionFailed);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [db, reloadToken, s.genericActionFailed]);

  const countLabel = useMemo(
    () => interpolate(s.profileNotesCount, { n: isRTL ? toArabicNumber(notes.length) : notes.length }),
    [isRTL, notes.length, s.profileNotesCount]
  );
  const previewNotes = useMemo(() => notes.slice(0, PROFILE_NOTES_PREVIEW_LIMIT), [notes]);
  const hasMoreNotes = notes.length > previewNotes.length;

  const confirmDelete = useCallback(async () => {
    if (!deletingNote || deleteBusy) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await deletePrivateNote(db, deletingNote.id);
      setDeletingNote(null);
      refreshNotes();
    } catch (e) {
      console.warn("[ProfileNotesManager] note delete failed:", e);
      setError(s.privateNoteDeleteFailed);
    } finally {
      setDeleteBusy(false);
    }
  }, [db, deleteBusy, deletingNote, refreshNotes, s.privateNoteDeleteFailed]);

  const openAyah = useCallback((note: PrivateNoteSearchResult) => {
    setAllNotesOpen(false);
    setPendingDeepLink({ surah: note.surah, ayah: note.ayahStart });
    router.push("/(tabs)/mushaf" as any);
  }, []);

  const openEdit = useCallback((note: PrivateNoteSearchResult) => {
    setAllNotesOpen(false);
    setEditingNote(note);
  }, []);

  const openDelete = useCallback((note: PrivateNoteSearchResult) => {
    setAllNotesOpen(false);
    setDeletingNote(note);
  }, []);

  const title = s.profileNotesEmptyTitle;
  const subtitle = s.profileNotesEmptySubtitle;
  const mutedColor = isDark ? "#737373" : "#A39B93";
  const iconColor = isDark ? "#2dd4bf" : "#0d9488";

  return (
    <View className="gap-3">
      <View className={`items-start justify-between gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
        <View className="min-w-0 flex-1">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{
              fontFamily: "Manrope_700Bold",
              fontSize: 18,
              textAlign: isRTL ? "right" : "left",
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {s.profileNotesTitle}
          </Text>
          <Text
            className="mt-1 text-warm-400 dark:text-neutral-500"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 13,
              lineHeight: 19,
              textAlign: isRTL ? "right" : "left",
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {s.profileNotesSubtitle}
          </Text>
        </View>
        <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
          <View className="rounded-full bg-primary-accent/10 px-3 py-1.5 dark:bg-primary-bright/10">
            <Text
              className="text-primary-accent dark:text-primary-bright"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
            >
              {countLabel}
            </Text>
          </View>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            className="h-10 w-10 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
          >
            <Search size={17} color={mutedColor} />
          </View>
        </View>
      </View>

      {error ? (
        <Text
          className="text-red-600 dark:text-red-400"
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 13,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {error}
        </Text>
      ) : null}

      {loading ? (
        <View className="items-center justify-center py-8">
          <ActivityIndicator size="small" color={iconColor} />
        </View>
      ) : notes.length === 0 ? (
        <EmptyState icon={NotebookPen} title={title} subtitle={subtitle} isDark={isDark} />
      ) : (
        <View className="gap-3">
          {previewNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              isDark={isDark}
              isRTL={isRTL}
              uiLanguage={uiLanguage}
              onEdit={() => openEdit(note)}
              onDelete={() => openDelete(note)}
              onOpenAyah={() => openAyah(note)}
            />
          ))}
          {hasMoreNotes && (
            <Pressable
              onPress={() => setAllNotesOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={s.profileNotesViewAll}
              className={`items-center justify-center gap-2 rounded-full bg-surface-high px-4 py-3 dark:bg-surface-dark-high ${
                isRTL ? "flex-row-reverse" : "flex-row"
              }`}
              style={({ pressed }) => ({ opacity: pressed ? 0.76 : 1 })}
            >
              <NotebookPen size={15} color={iconColor} />
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
              >
                {s.profileNotesViewAll}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <ResponsiveSheet
        open={allNotesOpen}
        onClose={() => setAllNotesOpen(false)}
        maxWidth={720}
        maxHeight={maxOverlayHeight}
        surfaceColor={isDark ? "#1a1a1a" : "#FFF8F1"}
      >
        <OverlayHeader
          title={s.profileNotesTitle}
          subtitle={countLabel}
          onClose={() => setAllNotesOpen(false)}
          showHandle={isPhone}
          isRTL={isRTL}
        />
        <OverlayBody contentContainerClassName="gap-3 px-5 py-4">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              isDark={isDark}
              isRTL={isRTL}
              uiLanguage={uiLanguage}
              onEdit={() => openEdit(note)}
              onDelete={() => openDelete(note)}
              onOpenAyah={() => openAyah(note)}
            />
          ))}
        </OverlayBody>
      </ResponsiveSheet>

      <PrivateNoteSheet
        open={!!editingNote}
        onClose={() => setEditingNote(null)}
        surah={editingNote?.surah ?? 1}
        ayahStart={editingNote?.ayahStart ?? 1}
        ayahEnd={editingNote?.ayahEnd ?? 1}
        note={editingNote}
        onSaved={refreshNotes}
      />
      <ConfirmDialog
        visible={!!deletingNote}
        title={s.profileNotesDeleteTitle}
        message={s.profileNotesDeleteMessage}
        cancelLabel={s.flashcardsCancel}
        confirmLabel={s.profileNotesDelete}
        destructive
        isDark={isDark}
        isRTL={isRTL}
        confirmLoading={deleteBusy}
        onCancel={() => {
          if (!deleteBusy) setDeletingNote(null);
        }}
        onConfirm={confirmDelete}
      />
    </View>
  );
}

function NoteCard({
  note,
  isDark,
  isRTL,
  uiLanguage,
  onEdit,
  onDelete,
  onOpenAyah,
}: {
  note: PrivateNoteSearchResult;
  isDark: boolean;
  isRTL: boolean;
  uiLanguage: "en" | "ar";
  onEdit: () => void;
  onDelete: () => void;
  onOpenAyah: () => void;
}) {
  const s = useStrings();
  const refLabel = formatAyahRef(note, isRTL);
  const surahName = uiLanguage === "ar" ? note.surahNameArabic : note.surahNameEnglish;
  const date = new Date(note.updatedAt).toLocaleDateString(uiLanguage === "ar" ? "ar" : "en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const updatedLabel = interpolate(s.profileNotesUpdated, { date });
  const mutedColor = isDark ? "#737373" : "#A39B93";
  const iconColor = isDark ? "#2dd4bf" : "#0d9488";

  return (
    <View className="rounded-2xl bg-surface-low p-3 dark:bg-surface-dark-low">
      <View className={`items-start gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
        <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
          <NotebookPen size={18} color={iconColor} />
        </View>
        <View className="min-w-0 flex-1">
          <View className={`items-start justify-between gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
            <View className="min-w-0 flex-1">
              <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                <Text
                  className="text-primary-accent dark:text-primary-bright"
                  style={{
                    fontFamily: "Manrope_700Bold",
                    fontSize: 13,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {refLabel}
                </Text>
                <Text
                  className="min-w-0 flex-1 text-warm-500 dark:text-neutral-400"
                  numberOfLines={1}
                  style={{
                    fontFamily: "Manrope_500Medium",
                    fontSize: 12,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {surahName}
                </Text>
              </View>
            </View>
            <View className={`shrink-0 items-center gap-1.5 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
              <NoteAction icon={BookOpen} label={s.profileNotesOpenAyah} color={iconColor} onPress={onOpenAyah} />
              <NoteAction icon={Edit3} label={s.profileNotesEdit} color={mutedColor} onPress={onEdit} />
              <NoteAction icon={Trash2} label={s.profileNotesDelete} color={isDark ? "#ef4444" : "#dc2626"} onPress={onDelete} />
            </View>
          </View>
          <Text
            selectable
            className="mt-1.5 text-charcoal dark:text-neutral-100"
            numberOfLines={4}
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 14,
              lineHeight: 22,
              textAlign: isRTL ? "right" : "left",
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {note.content}
          </Text>
          <Text
            className="mt-2 text-warm-400 dark:text-neutral-500"
            style={{
              fontFamily: "Manrope_500Medium",
              fontSize: 11,
              textAlign: isRTL ? "right" : "left",
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {updatedLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}

function NoteAction({
  icon: Icon,
  label,
  color,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-8 w-8 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high"
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
    >
      <Icon size={14} color={color} />
    </Pressable>
  );
}

function formatAyahRef(note: PrivateNoteSearchResult, isRTL: boolean): string {
  const surah = isRTL ? toArabicNumber(note.surah) : String(note.surah);
  const start = isRTL ? toArabicNumber(note.ayahStart) : String(note.ayahStart);
  if (note.ayahStart === note.ayahEnd) return `${surah}:${start}`;
  const end = isRTL ? toArabicNumber(note.ayahEnd) : String(note.ayahEnd);
  return `${surah}:${start}-${end}`;
}
