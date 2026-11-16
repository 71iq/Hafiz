import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { BookOpen, Edit3, NotebookPen, Search, Trash2, type LucideIcon } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { PrivateNoteSheet } from "@/components/notes/PrivateNoteSheet";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useOpenMushaf } from "@/lib/navigation/open-mushaf";
import { toArabicNumber } from "@/lib/arabic";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import {
  deletePrivateNote,
  searchPrivateNotes,
  type PrivateNoteSearchResult,
} from "@/lib/notes/queries";
import { inputTextStartStyle, textStartStyle } from "@/lib/ui/direction";

const PROFILE_NOTES_PREVIEW_LIMIT = 4;
const NOTE_CLAMP_LINES = 4;
const NOTE_LINE_HEIGHT = 22;
const NOTES_SEARCH_DEBOUNCE_MS = 180;

export type NotesSort = "recent" | "surah";

export function sortNotes(notes: PrivateNoteSearchResult[], sort: NotesSort): PrivateNoteSearchResult[] {
  const byRecent = (a: PrivateNoteSearchResult, b: PrivateNoteSearchResult) => b.updatedAt.localeCompare(a.updatedAt);
  return [...notes].sort((a, b) =>
    sort === "surah" ? a.surah - b.surah || a.ayahStart - b.ayahStart || a.ayahEnd - b.ayahEnd || byRecent(a, b) : byRecent(a, b),
  );
}

type NoteActionOrigin = "preview" | "all";

export function ProfileNotesManager() {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { width, height } = useWindowDimensions();
  const [notes, setNotes] = useState<PrivateNoteSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<PrivateNoteSearchResult | null>(null);
  const [deletingNote, setDeletingNote] = useState<PrivateNoteSearchResult | null>(null);
  const [allNotesOpen, setAllNotesOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<NotesSort>("recent");
  const [results, setResults] = useState<PrivateNoteSearchResult[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const [focusSearch, setFocusSearch] = useState(false);
  const origin = useRef<NoteActionOrigin>("preview");
  const editSaved = useRef(false);
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 720);

  const refreshNotes = useCallback(() => {
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
            setLoadFailed(false);
          }
        })
        .catch((e) => {
          console.warn("[ProfileNotesManager] notes search failed:", e);
          if (!cancelled) setLoadFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [db, reloadToken]);

  const trimmedQuery = query.trim();
  useEffect(() => {
    if (!trimmedQuery) {
      setResults(null);
      setSearchFailed(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchPrivateNotes(db, trimmedQuery)
        .then((rows) => {
          if (cancelled) return;
          setResults(rows);
          setSearchFailed(false);
        })
        .catch((e) => {
          console.warn("[ProfileNotesManager] notes query failed:", e);
          if (!cancelled) setSearchFailed(true);
        });
    }, NOTES_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [db, trimmedQuery, reloadToken]);

  const countLabel = useMemo(
    () => interpolate(s.profileNotesCount, { n: isRTL ? toArabicNumber(notes.length) : notes.length }),
    [isRTL, notes.length, s.profileNotesCount]
  );
  const previewNotes = useMemo(() => notes.slice(0, PROFILE_NOTES_PREVIEW_LIMIT), [notes]);
  const hasMoreNotes = notes.length > previewNotes.length;
  const listedNotes = useMemo(() => sortNotes(trimmedQuery ? results ?? [] : notes, sort), [notes, results, sort, trimmedQuery]);

  const reopenListIfStarted = useCallback(() => {
    if (origin.current === "all") setAllNotesOpen(true);
    origin.current = "preview";
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deletingNote || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deletePrivateNote(db, deletingNote.id);
      setDeletingNote(null);
      refreshNotes();
      reopenListIfStarted();
    } catch (e) {
      console.warn("[ProfileNotesManager] note delete failed:", e);
      setDeleteError(s.notesDeleteFailed);
    } finally {
      setDeleteBusy(false);
    }
  }, [db, deleteBusy, deletingNote, refreshNotes, reopenListIfStarted, s.notesDeleteFailed]);

  const openMushaf = useOpenMushaf();
  const openAyah = useCallback(
    (note: PrivateNoteSearchResult) => {
      setAllNotesOpen(false);
      openMushaf({ surah: note.surah, ayah: note.ayahStart });
    },
    [openMushaf],
  );

  const openEdit = useCallback((note: PrivateNoteSearchResult, from: NoteActionOrigin) => {
    origin.current = from;
    editSaved.current = false;
    setAllNotesOpen(false);
    setEditingNote(note);
  }, []);

  const openDelete = useCallback((note: PrivateNoteSearchResult, from: NoteActionOrigin) => {
    origin.current = from;
    setDeleteError(null);
    setAllNotesOpen(false);
    setDeletingNote(note);
  }, []);

  const openSearch = useCallback(() => {
    setFocusSearch(true);
    setAllNotesOpen(true);
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
              ...textStartStyle(isRTL),
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
              ...textStartStyle(isRTL),
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.notesSearchOpen}
            onPress={openSearch}
            className="h-11 w-11 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
            style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
          >
            <Search size={17} color={mutedColor} />
          </Pressable>
        </View>
      </View>

      {loading && notes.length === 0 ? (
        <View className="items-center justify-center py-8">
          <ActivityIndicator size="small" color={iconColor} />
        </View>
      ) : loadFailed && notes.length === 0 ? (
        <View className="items-center gap-3 py-6">
          <Text
            accessibilityRole="alert"
            className="text-red-600 dark:text-red-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 14, textAlign: "center" }}
          >
            {s.notesLoadFailed}
          </Text>
          <Button variant="outline" onPress={refreshNotes}>
            <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
              {s.notesRetry}
            </Text>
          </Button>
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
              onEdit={() => openEdit(note, "preview")}
              onDelete={() => openDelete(note, "preview")}
              onOpenAyah={() => openAyah(note)}
            />
          ))}
          {hasMoreNotes && (
            <Pressable
              onPress={() => setAllNotesOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={s.profileNotesViewAll}
              className={`min-h-11 items-center justify-center gap-2 rounded-full bg-surface-high px-4 py-3 dark:bg-surface-dark-high ${
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
        onClose={() => {
          setAllNotesOpen(false);
          setFocusSearch(false);
        }}
        maxWidth={720}
        maxHeight={maxOverlayHeight}
        phoneSheetHeight="max"
        initialFocusRef={focusSearch ? searchInputRef : undefined}
      >
        <OverlayHeader
          title={s.profileNotesTitle}
          subtitle={countLabel}
          onClose={() => {
            setAllNotesOpen(false);
            setFocusSearch(false);
          }}
          showHandle={isPhone}
          isRTL={isRTL}
        />
        <View className="gap-3 px-5 pt-3">
          <View
            className="min-h-11 items-center gap-2 rounded-2xl bg-surface-low px-4 dark:bg-surface-dark-low"
            style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
          >
            <Search size={16} color={mutedColor} />
            <TextInput
              ref={searchInputRef}
              value={query}
              onChangeText={setQuery}
              placeholder={s.profileNotesSearchPlaceholder}
              accessibilityLabel={s.notesSearchOpen}
              placeholderTextColor={mutedColor}
              autoCorrect={false}
              returnKeyType="search"
              className="min-h-11 flex-1 py-2 text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 14,
                ...inputTextStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            />
          </View>
          <ToggleGroup<NotesSort>
            accessibilityLabel={s.notesSortLabel}
            value={sort}
            onValueChange={setSort}
            items={[
              { value: "recent", label: s.notesSortRecent },
              { value: "surah", label: s.notesSortSurah },
            ]}
            dir={isRTL ? "rtl" : "ltr"}
          />
        </View>
        <OverlayBody contentContainerClassName="gap-3 px-5 py-4">
          {searchFailed ? (
            <Text
              accessibilityRole="alert"
              className="text-red-600 dark:text-red-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13, ...textStartStyle(isRTL) }}
            >
              {s.notesLoadFailed}
            </Text>
          ) : trimmedQuery && results !== null && listedNotes.length === 0 ? (
            <EmptyState
              icon={Search}
              title={s.profileNotesNoResultsTitle}
              subtitle={s.profileNotesNoResultsSubtitle}
              isDark={isDark}
            />
          ) : null}
          {listedNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              isDark={isDark}
              isRTL={isRTL}
              uiLanguage={uiLanguage}
              onEdit={() => openEdit(note, "all")}
              onDelete={() => openDelete(note, "all")}
              onOpenAyah={() => openAyah(note)}
            />
          ))}
        </OverlayBody>
      </ResponsiveSheet>

      <PrivateNoteSheet
        open={!!editingNote}
        onClose={() => {
          setEditingNote(null);
          if (editSaved.current) reopenListIfStarted();
          else origin.current = "preview";
          editSaved.current = false;
        }}
        surah={editingNote?.surah ?? 1}
        ayahStart={editingNote?.ayahStart ?? 1}
        ayahEnd={editingNote?.ayahEnd ?? 1}
        note={editingNote}
        onSaved={() => {
          editSaved.current = true;
          refreshNotes();
        }}
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
        error={deleteError}
        retryLabel={s.notesRetry}
        onCancel={() => {
          if (deleteBusy) return;
          setDeletingNote(null);
          setDeleteError(null);
          reopenListIfStarted();
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
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const contentStyle = {
    fontFamily: "Manrope_400Regular",
    fontSize: 14,
    lineHeight: NOTE_LINE_HEIGHT,
    ...textStartStyle(isRTL),
    writingDirection: isRTL ? ("rtl" as const) : ("ltr" as const),
  };

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
                    ...textStartStyle(isRTL),
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
                    ...textStartStyle(isRTL),
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
          <View className="mt-1.5">
            <Text
              aria-hidden
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              onLayout={(event) => {
                const next = event.nativeEvent.layout.height > NOTE_LINE_HEIGHT * NOTE_CLAMP_LINES + 2;
                setClamped((current) => (current === next ? current : next));
              }}
              style={{ ...contentStyle, position: "absolute", left: 0, right: 0, opacity: 0 }}
            >
              {note.content}
            </Text>
            <Text
              selectable
              className="text-charcoal dark:text-neutral-100"
              numberOfLines={expanded ? undefined : NOTE_CLAMP_LINES}
              style={contentStyle}
            >
              {note.content}
            </Text>
          </View>
          {clamped || expanded ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded((value) => !value)}
              className="min-h-11 justify-center"
              style={{ alignSelf: isRTL ? "flex-end" : "flex-start" }}
            >
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
              >
                {expanded ? s.sharedShowLess : s.sharedShowMore}
              </Text>
            </Pressable>
          ) : null}
          <Text
            className="mt-2 text-warm-400 dark:text-neutral-500"
            style={{
              fontFamily: "Manrope_500Medium",
              fontSize: 11,
              ...textStartStyle(isRTL),
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
      className="h-11 w-11 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high"
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
