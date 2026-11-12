import { useEffect, useMemo, useState, useCallback } from "react";
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { Trash2, BookmarkX } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BusyIndicator } from "@/components/ui/BusyIndicator";
import { EmptyState } from "@/components/ui/EmptyState";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useSelection } from "@/lib/selection/context";
import { removeBookmark } from "@/lib/selection/queries";
import { useDatabase } from "@/lib/database/provider";
import { loadMushafIndex, type MushafIndex } from "@/lib/mushaf/position";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { textStartStyle } from "@/lib/ui/direction";

type Props = {
  visible: boolean;
  onClose: () => void;
  onNavigate: (surah: number, ayah: number) => void;
};

type SurahNames = { db: unknown; byNumber: MushafIndex["surahByNumber"] };

export function BookmarksSheet({ visible, onClose, onNavigate }: Props) {
  const db = useDatabase();
  const { isDark, isRTL } = useSettings();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const s = useStrings();
  const { bookmarksList, showToast, refreshBookmarks } = useSelection();
  const [surahNames, setSurahNames] = useState<SurahNames | null>(null);
  const [namesFailed, setNamesFailed] = useState(false);
  const [namesAttempt, setNamesAttempt] = useState(0);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 640);

  // Rows come straight from the bookmarks list; only the surah names load, once per database.
  const namesByNumber = surahNames?.db === db ? surahNames.byNumber : null;
  const needsNames = visible && bookmarksList.length > 0 && !namesByNumber;
  useEffect(() => {
    if (!needsNames) return;
    let cancelled = false;
    setNamesFailed(false);
    loadMushafIndex(db).then(
      (index) => {
        if (!cancelled) setSurahNames({ db, byNumber: index.surahByNumber });
      },
      (error) => {
        console.warn("[BookmarksSheet] Failed to load surah names:", error);
        if (!cancelled) setNamesFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, needsNames, namesAttempt]);

  const rows = useMemo(
    () =>
      namesByNumber
        ? bookmarksList.map((b) => ({
            ...b,
            surahNameArabic: namesByNumber.get(b.surah)?.name_arabic ?? "",
            surahNameEnglish: namesByNumber.get(b.surah)?.name_english ?? "",
          }))
        : [],
    [bookmarksList, namesByNumber],
  );

  const handleRemove = useCallback(
    async (surah: number, ayah: number) => {
      const key = `${surah}:${ayah}`;
      if (removingKey) return;
      setRemovingKey(key);
      try {
        await removeBookmark(db, surah, ayah);
        await refreshBookmarks();
        showToast(s.bookmarkRemoved);
      } catch (e) {
        console.warn("[BookmarksSheet] Failed to remove bookmark:", e);
        showToast(s.bookmarkActionFailed);
      } finally {
        setRemovingKey(null);
      }
    },
    [db, refreshBookmarks, removingKey, showToast, s.bookmarkRemoved, s.bookmarkActionFailed]
  );

  const handleTap = useCallback(
    (surah: number, ayah: number) => {
      onNavigate(surah, ayah);
      onClose();
    },
    [onNavigate, onClose]
  );

  return (
    <ResponsiveSheet
      open={visible}
      onClose={onClose}
      maxWidth={560}
      maxHeight={maxOverlayHeight}
    >
      <OverlayHeader title={s.bookmarksTitle} onClose={onClose} showHandle={isPhone} isRTL={isRTL} />
      <OverlayBody
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 10,
          paddingBottom: Math.max(insets.bottom, 12),
        }}
      >
        {bookmarksList.length === 0 ? (
          <EmptyState
            icon={BookmarkX}
            title={s.noBookmarks}
            subtitle={s.emptyBookmarksSubtitle}
            isDark={isDark}
          />
        ) : !namesByNumber && namesFailed ? (
          <EmptyState
            icon={BookmarkX}
            title={s.bookmarksLoadFailed}
            actionLabel={s.errorTryAgain}
            onAction={() => setNamesAttempt((attempt) => attempt + 1)}
            isDark={isDark}
          />
        ) : !namesByNumber ? (
          <View className="items-center py-10">
            <BusyIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
          </View>
        ) : (
          rows.map((b) => (
            <Pressable
              key={`${b.surah}-${b.ayah}`}
              onPress={() => handleTap(b.surah, b.ayah)}
              style={({ pressed }) => ({
                direction: "ltr",
                flexDirection: isRTL ? "row-reverse" : "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                paddingVertical: 14,
                paddingHorizontal: 4,
                borderRadius: 12,
                backgroundColor: pressed
                  ? (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)")
                  : "transparent",
              })}
            >
              <View
                style={{
                  direction: "ltr",
                  flexDirection: isRTL ? "row-reverse" : "row",
                  alignItems: "center",
                  gap: 12,
                  flex: 1,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: isDark ? "rgba(253,220,145,0.14)" : "#FFF0C2",
                    borderColor: isDark ? "rgba(253,220,145,0.22)" : "rgba(154, 98, 0, 0.18)",
                    borderWidth: 1,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Manrope_700Bold",
                      fontSize: 11,
                      color: isDark ? "#FDDC91" : "#9A6200",
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
                      ...textStartStyle(isRTL),
                    }}
                  >
                    {b.surahNameArabic}
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 12,
                      color: isDark ? "#737373" : "#A39B93",
                      ...textStartStyle(isRTL),
                    }}
                  >
                    {b.surahNameEnglish}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={(event) => {
                  event.stopPropagation?.();
                  handleRemove(b.surah, b.ayah);
                }}
                disabled={removingKey === `${b.surah}:${b.ayah}`}
                style={({ pressed }) => ({
                  padding: 8,
                  opacity: removingKey === `${b.surah}:${b.ayah}` ? 0.45 : pressed ? 0.5 : 1,
                })}
                hitSlop={8}
              >
                <Trash2 size={16} color={isDark ? "#525252" : "#DFD9D1"} />
              </Pressable>
            </Pressable>
          ))
        )}
      </OverlayBody>
    </ResponsiveSheet>
  );
}
