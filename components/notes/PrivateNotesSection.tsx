import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Plus, Trash2 } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import {
  deletePrivateNote,
  listPrivateNotesForAyah,
  type PrivateNote,
} from "@/lib/notes/queries";
import { PrivateNoteSheet } from "./PrivateNoteSheet";

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

  const loadNotes = useCallback(async () => {
    const rows = await listPrivateNotesForAyah(db, surah, ayah);
    setNotes(rows);
  }, [ayah, db, surah]);

  useEffect(() => {
    loadNotes().catch(console.warn);
  }, [loadNotes]);

  const handleDelete = useCallback(
    async (note: PrivateNote) => {
      await deletePrivateNote(db, note.id);
      await loadNotes();
    },
    [db, loadNotes]
  );

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
      <View className={`mb-3 flex-row items-center justify-between ${isRTL ? "flex-row-reverse" : ""}`}>
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
        >
          {s.privateNotes}
        </Text>
        <Pressable
          onPress={openCreate}
          className={`items-center gap-1 rounded-full bg-primary-accent px-3 py-1.5 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
        >
          <Plus size={13} color="#FFFFFF" />
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, color: "#FFFFFF" }}>
            {s.privateNoteAdd}
          </Text>
        </Pressable>
      </View>

      {notes.length === 0 ? (
        <Text
          className="text-warm-400 dark:text-neutral-500"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 20, textAlign: isRTL ? "right" : "left" }}
        >
          {s.privateNotesEmpty}
        </Text>
      ) : (
        <View className="gap-2">
          {notes.map((note) => (
            <Pressable
              key={note.id}
              onPress={() => openEdit(note)}
              className="rounded-2xl bg-surface-low px-3.5 py-3 dark:bg-surface-dark-low"
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
            >
              <View className={`flex-row items-start gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
                <View className="min-w-0 flex-1">
                  <Text
                    className="text-charcoal dark:text-neutral-200"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 13,
                      lineHeight: 20,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                    numberOfLines={4}
                  >
                    {note.content}
                  </Text>
                  <Text
                    className="mt-2 text-warm-400 dark:text-neutral-500"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 10, textAlign: isRTL ? "right" : "left" }}
                  >
                    {new Date(note.updatedAt).toLocaleDateString()}
                  </Text>
                </View>
                <Pressable onPress={() => handleDelete(note)} hitSlop={8} className="h-8 w-8 items-center justify-center rounded-full">
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
        onSaved={loadNotes}
      />
    </View>
  );
}
