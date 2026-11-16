import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Plus, Trash2 } from "lucide-react-native";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useOperationNotice } from "@/components/ui/OperationNoticeProvider";
import { formatAyahRef } from "@/lib/arabic";
import { useDatabase } from "@/lib/database/provider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import {
  deletePrivateNote,
  listPrivateNotesForAyah,
  type PrivateNote,
} from "@/lib/notes/queries";
import { PrivateNoteSheet } from "./PrivateNoteSheet";
import { textStartStyle } from "@/lib/ui/direction";

type Props = {
  surah: number;
  ayah: number;
};

export function PrivateNotesSection({ surah, ayah }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const [notes, setNotes] = useState<PrivateNote[]>([]);
  const [editingNote, setEditingNote] = useState<PrivateNote | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PrivateNote | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const showNotice = useOperationNotice();

  const loadNotes = useCallback(async () => {
    try {
      setLoadFailed(false);
      const rows = await listPrivateNotesForAyah(db, surah, ayah);
      setNotes(rows);
    } catch (e) {
      console.warn("[PrivateNotesSection] Failed to load notes:", e);
      setLoadFailed(true);
    }
  }, [ayah, db, surah]);

  useEffect(() => {
    loadNotes().catch(console.warn);
  }, [loadNotes]);

  const confirmDelete = useCallback(async () => {
    const note = pendingDelete;
    if (!note || deletingNoteId) return;
    setDeletingNoteId(note.id);
    setDeleteError(null);
    try {
      await deletePrivateNote(db, note.id);
      setPendingDelete(null);
      await loadNotes();
    } catch (e) {
      console.warn("[PrivateNotesSection] Failed to delete note:", e);
      setDeleteError(s.privateNoteDeleteFailed);
    } finally {
      setDeletingNoteId(null);
    }
  }, [db, deletingNoteId, loadNotes, pendingDelete, s.privateNoteDeleteFailed]);

  const handleSaved = useCallback(() => {
    showNotice(s.privateNoteSaved);
    loadNotes().catch(console.warn);
  }, [loadNotes, s.privateNoteSaved, showNotice]);

  const openCreate = useCallback(() => {
    setEditingNote(null);
    setSheetOpen(true);
  }, []);

  const openEdit = useCallback((note: PrivateNote) => {
    setEditingNote(note);
    setSheetOpen(true);
  }, []);

  const mutedColor = isDark ? "#737373" : "#A39B93";

  return (
    <View>
      <View
        className="mb-3 items-center justify-between"
        style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
      >
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 15, ...textStartStyle(isRTL)}}
        >
          {s.privateNotes}
        </Text>
        <Pressable
          onPress={openCreate}
          accessibilityRole="button"
          className="items-center gap-1 rounded-full bg-primary-accent px-3 py-1.5"
          style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row", minHeight: 44 }}
        >
          <Plus size={13} color="#FFFFFF" />
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, color: "#FFFFFF" }}>
            {s.privateNoteAdd}
          </Text>
        </Pressable>
      </View>

      {loadFailed ? (
        <View className="gap-2">
          <Text
            className="text-red-600 dark:text-red-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 13, ...textStartStyle(isRTL)}}
          >
            {s.privateNotesLoadFailed}
          </Text>
          <Pressable
            onPress={() => loadNotes().catch(console.warn)}
            accessibilityRole="button"
            className={`min-h-[44px] justify-center rounded-full bg-surface px-4 dark:bg-surface-dark ${isRTL ? "self-end" : "self-start"}`}
          >
            <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
              {s.detailRetry}
            </Text>
          </Pressable>
        </View>
      ) : notes.length === 0 ? (
        <View>
          <Text
            className="text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 20, ...textStartStyle(isRTL)}}
          >
            {s.privateNotesEmpty}
          </Text>
          <Text
            className="mt-1 text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL)}}
          >
            {isSupabaseConfigured() ? s.privateNotesSyncHint : s.privateNotesLocalOnly}
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          {notes.map((note) => (
            <Pressable
              key={note.id}
              onPress={() => openEdit(note)}
              className="rounded-2xl bg-surface-low px-3.5 py-3 dark:bg-surface-dark-low"
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
            >
              <View
                className="items-start gap-3"
                style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className="text-charcoal dark:text-neutral-200"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 13,
                      lineHeight: 20,
                      ...textStartStyle(isRTL),
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                    numberOfLines={4}
                  >
                    {note.content}
                  </Text>
                  {note.ayahStart !== note.ayahEnd ? (
                    <Text
                      className="mt-1 text-primary-muted dark:text-primary-bright"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, ...textStartStyle(isRTL)}}
                    >
                      {interpolate(s.privateNoteRange, {
                        range: `${formatAyahRef(isRTL, note.surah, note.ayahStart)}-${formatAyahRef(isRTL, note.surah, note.ayahEnd)}`,
                      })}
                    </Text>
                  ) : null}
                  <Text
                    className="mt-2 text-warm-400 dark:text-neutral-500"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 10, ...textStartStyle(isRTL)}}
                  >
                    {new Date(note.updatedAt).toLocaleDateString()}
                  </Text>
                </View>
                <Pressable
                  onPress={(event) => {
                    event.stopPropagation?.();
                    setDeleteError(null);
                    setPendingDelete(note);
                  }}
                  disabled={deletingNoteId === note.id}
                  accessibilityRole="button"
                  accessibilityLabel={s.privateNoteDeleteConfirm}
                  className="h-11 w-11 items-center justify-center rounded-full"
                  style={{ opacity: deletingNoteId === note.id ? 0.45 : 1 }}
                >
                  <Trash2 size={14} color={mutedColor} />
                </Pressable>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <PrivateNoteSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        surah={surah}
        ayahStart={ayah}
        ayahEnd={ayah}
        note={editingNote}
        onSaved={handleSaved}
      />
      <ConfirmDialog
        visible={pendingDelete !== null}
        title={s.privateNoteDeleteTitle}
        message={s.privateNoteDeleteMessage}
        cancelLabel={s.privateNoteDeleteCancel}
        confirmLabel={deletingNoteId ? s.privateNoteDeleting : s.privateNoteDeleteConfirm}
        destructive
        confirmLoading={deletingNoteId !== null}
        error={deleteError}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          confirmDelete().catch(console.warn);
        }}
      />
    </View>
  );
}
