import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { BookOpen, Edit3, NotebookPen, Search, Trash2, type LucideIcon } from "lucide-react-native";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { PrivateNoteSheet } from "@/components/notes/PrivateNoteSheet";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { setPendingDeepLink } from "@/lib/deep-link";
import { toArabicNumber } from "@/lib/arabic";
import {
  deletePrivateNote,
  searchPrivateNotes,
  type PrivateNoteSearchResult,
} from "@/lib/notes/queries";

export function ProfileNotesManager() {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<PrivateNoteSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [editingNote, setEditingNote] = useState<PrivateNoteSearchResult | null>(null);
  const [deletingNote, setDeletingNote] = useState<PrivateNoteSearchResult | null>(null);

  const refreshNotes = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      searchPrivateNotes(db, query)
        .then((rows) => {
          if (!cancelled) setNotes(rows);
        })
        .catch((e) => {
          console.warn("[ProfileNotesManager] notes search failed:", e);
          if (!cancelled) setNotes([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [db, query, reloadToken]);

  const countLabel = useMemo(
    () => interpolate(s.profileNotesCount, { n: isRTL ? toArabicNumber(notes.length) : notes.length }),
    [isRTL, notes.length, s.profileNotesCount]
  );

  const confirmDelete = useCallback(async () => {
    if (!deletingNote) return;
    await deletePrivateNote(db, deletingNote.id);
    setDeletingNote(null);
    refreshNotes();
  }, [db, deletingNote, refreshNotes]);

  const openAyah = useCallback((note: PrivateNoteSearchResult) => {
    setPendingDeepLink({ surah: note.surah, ayah: note.ayahStart });
    router.push("/(tabs)/mushaf" as any);
  }, []);

  const title = query.trim().length > 0 ? s.profileNotesNoResultsTitle : s.profileNotesEmptyTitle;
  const subtitle = query.trim().length > 0 ? s.profileNotesNoResultsSubtitle : s.profileNotesEmptySubtitle;
  const mutedColor = isDark ? "#737373" : "#A39B93";
  const iconColor = isDark ? "#2dd4bf" : "#0d9488";

  return (
    <View className="gap-4">
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
        <View className="rounded-full bg-primary-accent/10 px-3 py-1.5 dark:bg-primary-bright/10">
          <Text
            className="text-primary-accent dark:text-primary-bright"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
          >
            {countLabel}
          </Text>
        </View>
      </View>

      <View
        className="items-center gap-2 rounded-2xl bg-surface-low px-3.5 py-2.5 dark:bg-surface-dark-low"
        style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
      >
        <Search size={17} color={mutedColor} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={s.profileNotesSearchPlaceholder}
          placeholderTextColor={mutedColor}
          className="min-h-9 flex-1 text-charcoal dark:text-neutral-100"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 14,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <View className="items-center justify-center py-10">
          <ActivityIndicator size="small" color={iconColor} />
        </View>
      ) : notes.length === 0 ? (
        <EmptyState icon={NotebookPen} title={title} subtitle={subtitle} isDark={isDark} />
      ) : (
        <View className="gap-3">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              isDark={isDark}
              isRTL={isRTL}
              uiLanguage={uiLanguage}
              onEdit={() => setEditingNote(note)}
              onDelete={() => setDeletingNote(note)}
              onOpenAyah={() => openAyah(note)}
            />
          ))}
        </View>
      )}

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
        onCancel={() => setDeletingNote(null)}
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
    <View className="rounded-3xl bg-surface-low p-4 dark:bg-surface-dark-low">
      <View className={`items-start gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
        <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
          <NotebookPen size={18} color={iconColor} />
        </View>
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
          <Text
            selectable
            className="mt-2 text-charcoal dark:text-neutral-100"
            numberOfLines={5}
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
            className="mt-3 text-warm-400 dark:text-neutral-500"
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

      <View className={`mt-4 gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
        <NoteAction icon={BookOpen} label={s.profileNotesOpenAyah} color={iconColor} isRTL={isRTL} onPress={onOpenAyah} />
        <NoteAction icon={Edit3} label={s.profileNotesEdit} color={mutedColor} isRTL={isRTL} onPress={onEdit} />
        <NoteAction icon={Trash2} label={s.profileNotesDelete} color={isDark ? "#ef4444" : "#dc2626"} isRTL={isRTL} onPress={onDelete} />
      </View>
    </View>
  );
}

function NoteAction({
  icon: Icon,
  label,
  color,
  isRTL,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  isRTL: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-surface-high px-3 py-2 dark:bg-surface-dark-high"
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1, flexDirection: isRTL ? "row-reverse" : "row" })}
    >
      <Icon size={14} color={color} />
      <Text
        className="text-charcoal dark:text-neutral-200"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
      >
        {label}
      </Text>
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
