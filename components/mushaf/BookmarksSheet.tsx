import { useEffect, useMemo, useState, useCallback } from "react";
import { View, Text, Pressable, TextInput, Platform, useWindowDimensions } from "react-native";
import { Trash2, BookmarkX, Search, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useSelection } from "@/lib/selection/context";
import { fetchAyahOpenings, removeBookmark } from "@/lib/selection/queries";
import type { BookmarkEntry } from "@/lib/selection/types";
import { useDatabase } from "@/lib/database/provider";
import { loadMushafIndex, type MushafIndex } from "@/lib/mushaf/position";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { formatAyahRef } from "@/lib/arabic";
import { matchesSurahQuery } from "@/lib/search/surah-match";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { inputTextStartStyle, textStartStyle } from "@/lib/ui/direction";

type Props = {
  visible: boolean;
  onClose: () => void;
  onNavigate: (surah: number, ayah: number) => void;
};

type SurahNames = { db: unknown; byNumber: MushafIndex["surahByNumber"] };
type BookmarksOrder = "recent" | "quran";

/** The search field appears for more than this many bookmarks, whatever the viewport. */
export const BOOKMARK_SEARCH_THRESHOLD = 10;

export function shouldShowBookmarkSearch(count: number): boolean {
  return count > BOOKMARK_SEARCH_THRESHOLD;
}

/** Recent keeps the stored newest-first order; Quran order sorts by surah, then ayah. */
export function orderBookmarks<T extends Pick<BookmarkEntry, "surah" | "ayah">>(rows: readonly T[], order: BookmarksOrder): T[] {
  if (order === "recent") return rows.slice();
  return rows.slice().sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);
}

export function BookmarksSheet({ visible, onClose, onNavigate }: Props) {
  const db = useDatabase();
  const { isDark, isRTL, bookmarksOrder = "recent", setBookmarksOrder } = useSettings();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const s = useStrings();
  const { bookmarksList, showToast, refreshBookmarks } = useSelection();
  const [surahNames, setSurahNames] = useState<SurahNames | null>(null);
  const [namesFailed, setNamesFailed] = useState(false);
  const [namesAttempt, setNamesAttempt] = useState(0);
  const [openings, setOpenings] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<{ surah: number; ayah: number } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 640);
  const showSearch = shouldShowBookmarkSearch(bookmarksList.length);

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

  // Opening words are a convenience: rows render without them and fill in when they arrive.
  const bookmarkKeys = bookmarksList.map((b) => `${b.surah}:${b.ayah}`).join(",");
  useEffect(() => {
    if (!visible || bookmarksList.length === 0) return;
    let cancelled = false;
    fetchAyahOpenings(db, bookmarksList)
      .then((next) => {
        if (!cancelled) setOpenings(next);
      })
      .catch((error) => console.warn("[BookmarksSheet] Failed to load opening words:", error));
    return () => {
      cancelled = true;
    };
    // The key list stands for the bookmarks themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, visible, bookmarkKeys]);

  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);

  const surahName = useCallback(
    (surah: number) => {
      const meta = namesByNumber?.get(surah);
      return meta ? (isRTL ? meta.name_arabic : meta.name_english) : "";
    },
    [isRTL, namesByNumber],
  );

  const rows = useMemo(() => {
    const ordered = orderBookmarks(bookmarksList, bookmarksOrder);
    const trimmed = showSearch ? query.trim() : "";
    if (!trimmed) return ordered;
    return ordered.filter((b) =>
      matchesSurahQuery(
        {
          number: b.surah,
          name_arabic: namesByNumber?.get(b.surah)?.name_arabic ?? "",
          name_english: namesByNumber?.get(b.surah)?.name_english ?? "",
        },
        trimmed,
      ),
    );
  }, [bookmarksList, bookmarksOrder, namesByNumber, query, showSearch]);

  const itemLabel = useCallback(
    (surah: number, ayah: number) => {
      const name = surahName(surah);
      const ref = formatAyahRef(isRTL, surah, ayah);
      return name ? `${name} ${ref}` : ref;
    },
    [isRTL, surahName],
  );

  const confirmRemove = useCallback(async () => {
    if (!pendingRemoval || removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeBookmark(db, pendingRemoval.surah, pendingRemoval.ayah);
      await refreshBookmarks();
      setPendingRemoval(null);
      showToast(s.bookmarkRemoved);
    } catch (e) {
      // The row and the dialog stay, with the error beside the action.
      console.warn("[BookmarksSheet] Failed to remove bookmark:", e);
      setRemoveError(s.bookmarkActionFailed);
    } finally {
      setRemoving(false);
    }
  }, [db, pendingRemoval, refreshBookmarks, removing, showToast, s.bookmarkRemoved, s.bookmarkActionFailed]);

  const handleTap = useCallback(
    (surah: number, ayah: number) => {
      // The reader captures the target (and the return position) before the list closes.
      onNavigate(surah, ayah);
      onClose();
    },
    [onNavigate, onClose]
  );

  const mutedColor = isDark ? "#a3a3a3" : "#7A634D";

  return (
    <>
    <ResponsiveSheet
      open={visible}
      onClose={onClose}
      maxWidth={560}
      maxHeight={maxOverlayHeight}
    >
      <OverlayHeader title={s.bookmarksTitle} onClose={onClose} showHandle={isPhone} isRTL={isRTL} />
      {bookmarksList.length > 1 ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10, gap: 10 }}>
          {showSearch ? (
            <View
              className="items-center gap-2.5 bg-surface-low dark:bg-surface-dark-mid rounded-2xl px-4"
              style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row", minHeight: 44 }}
            >
              <Search size={16} color={mutedColor} />
              <TextInput
                accessibilityLabel={s.searchBookmarks}
                className="flex-1 text-charcoal dark:text-neutral-100"
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 15,
                  minHeight: 44,
                  ...inputTextStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                  ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
                }}
                placeholder={s.searchBookmarks}
                placeholderTextColor={isDark ? "#737373" : "#8B7563"}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                returnKeyType="search"
              />
              {query.length > 0 ? (
                <Pressable
                  onPress={() => setQuery("")}
                  accessibilityRole="button"
                  accessibilityLabel={s.readerClearSearch}
                  className="h-11 w-11 items-center justify-center"
                >
                  <X size={14} color={mutedColor} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <ToggleGroup<BookmarksOrder>
            value={bookmarksOrder}
            onValueChange={(order) => setBookmarksOrder?.(order)}
            items={[
              { value: "recent", label: s.bookmarksOrderRecent },
              { value: "quran", label: s.bookmarksOrderQuran },
            ]}
            accessibilityLabel={s.bookmarksOrderLabel}
          />
        </View>
      ) : null}
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
        ) : (
          <>
            {!namesByNumber && namesFailed ? (
              <EmptyState
                icon={BookmarkX}
                title={s.bookmarksLoadFailed}
                actionLabel={s.errorTryAgain}
                onAction={() => setNamesAttempt((attempt) => attempt + 1)}
                isDark={isDark}
              />
            ) : null}
            {rows.length === 0 ? (
              <Text
                className="py-8 text-center text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}
              >
                {s.bookmarksNoMatches}
              </Text>
            ) : null}
            {rows.map((b) => {
              const name = surahName(b.surah);
              const opening = openings.get(`${b.surah}:${b.ayah}`);
              const label = itemLabel(b.surah, b.ayah);
              return (
                <Pressable
                  key={`${b.surah}-${b.ayah}`}
                  onPress={() => handleTap(b.surah, b.ayah)}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  style={({ pressed }) => ({
                    direction: "ltr",
                    flexDirection: isRTL ? "row-reverse" : "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    paddingVertical: 12,
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
                      minWidth: 0,
                    }}
                  >
                    <View
                      style={{
                        minWidth: 44,
                        height: 36,
                        paddingHorizontal: 8,
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
                          color: isDark ? "#FDDC91" : "#7A4E00",
                        }}
                      >
                        {formatAyahRef(isRTL, b.surah, b.ayah)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      {name ? (
                        <Text
                          style={{
                            fontFamily: "Manrope_600SemiBold",
                            fontSize: 14,
                            color: isDark ? "#e5e5e5" : "#2D2D2D",
                            ...textStartStyle(isRTL),
                          }}
                        >
                          {name}
                        </Text>
                      ) : null}
                      {opening ? (
                        <Text
                          numberOfLines={1}
                          style={{
                            fontSize: 15,
                            lineHeight: 26,
                            color: mutedColor,
                            textAlign: "right",
                            writingDirection: "rtl",
                          }}
                        >
                          {opening}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <Pressable
                    onPress={(event) => {
                      event?.stopPropagation?.();
                      setRemoveError(null);
                      setPendingRemoval({ surah: b.surah, ayah: b.ayah });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={interpolate(s.removeBookmarkFor, { item: label })}
                    className="h-11 w-11 items-center justify-center rounded-full"
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                  >
                    <Trash2 size={16} color={mutedColor} />
                  </Pressable>
                </Pressable>
              );
            })}
          </>
        )}
      </OverlayBody>
    </ResponsiveSheet>
    <ConfirmDialog
      visible={pendingRemoval !== null}
      title={s.removeBookmarkConfirmTitle}
      message={
        pendingRemoval
          ? interpolate(s.removeBookmarkConfirmBody, { item: itemLabel(pendingRemoval.surah, pendingRemoval.ayah) })
          : ""
      }
      cancelLabel={s.readerCancel}
      confirmLabel={s.removeBookmark}
      destructive
      confirmLoading={removing}
      error={removeError}
      isDark={isDark}
      isRTL={isRTL}
      onCancel={() => {
        if (removing) return;
        setPendingRemoval(null);
        setRemoveError(null);
      }}
      onConfirm={confirmRemove}
    />
    </>
  );
}
