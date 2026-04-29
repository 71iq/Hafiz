import { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, Modal, ScrollView, useWindowDimensions } from "react-native";
import { X, Trash2, BookmarkX } from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { useSelection } from "@/lib/selection/context";
import { removeBookmark } from "@/lib/selection/queries";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  visible: boolean;
  onClose: () => void;
  onNavigate: (surah: number, ayah: number) => void;
};

type BookmarkWithName = {
  surah: number;
  ayah: number;
  createdAt: string;
  surahNameArabic: string;
  surahNameEnglish: string;
};

export function BookmarksSheet({ visible, onClose, onNavigate }: Props) {
  const db = useDatabase();
  const { isDark } = useSettings();
  const { width, height } = useWindowDimensions();
  const s = useStrings();
  const { bookmarksList, showToast, refreshBookmarks } = useSelection();
  const [enriched, setEnriched] = useState<BookmarkWithName[]>([]);
  const modalWidth = Math.min(width - 32, 560);
  const modalHeight = Math.min(height - 48, 640);

  useEffect(() => {
    if (!visible || bookmarksList.length === 0) {
      setEnriched([]);
      return;
    }
    async function enrich() {
      const rows = await db.getAllAsync<{ number: number; name_arabic: string; name_english: string }>(
        "SELECT number, name_arabic, name_english FROM surahs"
      );
      const surahMap = new Map<number, { name_arabic: string; name_english: string }>();
      for (const r of rows) surahMap.set(r.number, r);

      setEnriched(
        bookmarksList.map((b) => ({
          ...b,
          surahNameArabic: surahMap.get(b.surah)?.name_arabic ?? "",
          surahNameEnglish: surahMap.get(b.surah)?.name_english ?? "",
        }))
      );
    }
    enrich();
  }, [visible, bookmarksList, db]);

  const handleRemove = useCallback(
    async (surah: number, ayah: number) => {
      await removeBookmark(db, surah, ayah);
      await refreshBookmarks();
      showToast(s.bookmarkRemoved);
    },
    [db, refreshBookmarks, showToast, s.bookmarkRemoved]
  );

  const handleTap = useCallback(
    (surah: number, ayah: number) => {
      onNavigate(surah, ayah);
      onClose();
    },
    [onNavigate, onClose]
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 16,
          backgroundColor: "rgba(0,0,0,0.45)",
        }}
      >
        <Pressable
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          onPress={onClose}
        />
        <View
          style={{
            width: modalWidth,
            height: modalHeight,
            backgroundColor: isDark ? "#1a1a1a" : "#FFF8F1",
            borderRadius: 24,
            paddingTop: 18,
            paddingBottom: 20,
            overflow: "hidden",
          }}
          onStartShouldSetResponder={() => true}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingBottom: 16,
            }}
          >
            <Text
              style={{
                fontFamily: "Manrope_700Bold",
                fontSize: 18,
                color: isDark ? "#e5e5e5" : "#2D2D2D",
              }}
            >
              {s.bookmarksTitle}
            </Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => ({
                padding: 8,
                borderRadius: 20,
                backgroundColor: isDark ? "#262626" : "#F0EAE2",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <X size={18} color={isDark ? "#a3a3a3" : "#8B8178"} />
            </Pressable>
          </View>

          {/* Bookmark list */}
          <ScrollView style={{ paddingHorizontal: 20 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {enriched.length === 0 ? (
              <EmptyState
                icon={BookmarkX}
                title={s.noBookmarks}
                subtitle={s.emptyBookmarksSubtitle}
                isDark={isDark}
              />
            ) : (
              enriched.map((b) => (
                <Pressable
                  key={`${b.surah}-${b.ayah}`}
                  onPress={() => handleTap(b.surah, b.ayah)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 14,
                    paddingHorizontal: 4,
                    borderRadius: 12,
                    backgroundColor: pressed
                      ? (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)")
                      : "transparent",
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                    {/* Gold bookmark dot */}
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: isDark ? "rgba(253,220,145,0.12)" : "rgba(253,220,145,0.2)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: "Manrope_600SemiBold",
                          fontSize: 11,
                          color: "#FDDC91",
                        }}
                      >
                        {b.surah}:{b.ayah}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontFamily: "Manrope_600SemiBold",
                          fontSize: 14,
                          color: isDark ? "#e5e5e5" : "#2D2D2D",
                        }}
                      >
                        {b.surahNameArabic}
                      </Text>
                      <Text
                        style={{
                          fontFamily: "Manrope_400Regular",
                          fontSize: 12,
                          color: isDark ? "#737373" : "#A39B93",
                        }}
                      >
                        {b.surahNameEnglish}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => handleRemove(b.surah, b.ayah)}
                    style={({ pressed }) => ({
                      padding: 8,
                      opacity: pressed ? 0.5 : 1,
                    })}
                    hitSlop={8}
                  >
                    <Trash2 size={16} color={isDark ? "#525252" : "#DFD9D1"} />
                  </Pressable>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
