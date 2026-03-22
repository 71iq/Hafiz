import { useState, useCallback } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { Copy, BookMarked, Highlighter, PenLine, Trash2 } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { useSelection } from "@/lib/selection/context";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { fetchUthmaniRange, fetchSurahName } from "@/lib/selection/queries";
import { formatForCopy } from "@/lib/selection/format";
import { HIGHLIGHT_COLORS } from "@/lib/selection/types";

export function SelectionActionBar() {
  const db = useDatabase();
  const s = useStrings();
  const { isDark } = useSettings();
  const {
    selection,
    clearSelection,
    addHighlightForSelection,
    removeHighlightForSelection,
    toggleBookmarkForSelection,
    showToast,
    isBookmarked,
    getHighlightColor,
  } = useSelection();
  const [showColors, setShowColors] = useState(false);

  const isOpen = selection !== null;
  const currentHighlight = selection ? getHighlightColor(selection.start.surah, selection.start.ayah) : undefined;
  const currentlyBookmarked = selection ? isBookmarked(selection.start.surah, selection.start.ayah) : false;

  const handleClose = useCallback(() => {
    setShowColors(false);
    clearSelection();
  }, [clearSelection]);

  const getTextAndMeta = useCallback(async () => {
    if (!selection) return null;
    const { start } = selection;
    const [text, surahName] = await Promise.all([
      fetchUthmaniRange(db, start.surah, start.ayah, start.ayah),
      fetchSurahName(db, start.surah),
    ]);
    return { text, surahName, surah: start.surah, ayah: start.ayah };
  }, [db, selection]);

  const handleCopy = useCallback(async () => {
    const meta = await getTextAndMeta();
    if (!meta) return;
    const formatted = formatForCopy(meta.text, meta.surahName, meta.surah, meta.ayah, meta.ayah);
    await Clipboard.setStringAsync(formatted);
    showToast(s.copied);
    handleClose();
  }, [getTextAndMeta, showToast, s.copied, handleClose]);

  const handleReflect = useCallback(() => {
    showToast(s.reflectionComingSoon);
    handleClose();
  }, [showToast, s.reflectionComingSoon, handleClose]);

  const handleHighlightColor = useCallback(
    async (color: string) => {
      await addHighlightForSelection(color);
      showToast(s.highlightAdded);
      setShowColors(false);
      handleClose();
    },
    [addHighlightForSelection, showToast, s.highlightAdded, handleClose]
  );

  const handleRemoveHighlight = useCallback(async () => {
    await removeHighlightForSelection();
    showToast(s.highlightRemoved);
    setShowColors(false);
    handleClose();
  }, [removeHighlightForSelection, showToast, s.highlightRemoved, handleClose]);

  const handleBookmark = useCallback(async () => {
    const result = await toggleBookmarkForSelection();
    if (result === "added") showToast(s.bookmarkAdded);
    else if (result === "removed") showToast(s.bookmarkRemoved);
    handleClose();
  }, [toggleBookmarkForSelection, showToast, s.bookmarkAdded, s.bookmarkRemoved, handleClose]);

  const iconColor = isDark ? "#e5e5e5" : "#2D2D2D";
  const mutedColor = isDark ? "#737373" : "#A39B93";

  return (
    <Sheet open={isOpen} onClose={handleClose}>
      <SheetContent>
        {/* Ayah reference */}
        {selection && (
          <Text
            style={{
              fontFamily: "Manrope_600SemiBold",
              fontSize: 13,
              color: mutedColor,
              textAlign: "center",
              marginBottom: 16,
            }}
          >
            {selection.start.surah}:{selection.start.ayah}
          </Text>
        )}

        {/* Action buttons row */}
        <View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: showColors ? 16 : 0 }}>
          <ActionButton
            icon={<Copy size={20} color={iconColor} />}
            label={s.copy}
            onPress={handleCopy}
            isDark={isDark}
          />
          <ActionButton
            icon={<PenLine size={20} color={iconColor} />}
            label={s.addReflection}
            onPress={handleReflect}
            isDark={isDark}
          />
          <ActionButton
            icon={<Highlighter size={20} color={currentHighlight ?? iconColor} />}
            label={s.highlight}
            onPress={() => setShowColors((v) => !v)}
            isDark={isDark}
            active={showColors}
          />
          <ActionButton
            icon={<BookMarked size={20} color={currentlyBookmarked ? "#FDDC91" : iconColor} />}
            label={currentlyBookmarked ? s.removeBookmark : s.bookmark}
            onPress={handleBookmark}
            isDark={isDark}
          />
        </View>

        {/* Highlight color picker */}
        {showColors && (
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 16, paddingVertical: 8 }}>
            {HIGHLIGHT_COLORS.map((color) => (
              <Pressable
                key={color}
                onPress={() => handleHighlightColor(color)}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: color,
                  transform: [{ scale: pressed ? 0.9 : 1 }],
                  ...(currentHighlight === color && {
                    borderWidth: 3,
                    borderColor: isDark ? "#fff" : "#2D2D2D",
                  }),
                })}
              />
            ))}
            {/* Remove highlight button */}
            {currentHighlight && (
              <Pressable
                onPress={handleRemoveHighlight}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: isDark ? "#262626" : "#F0EAE2",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: [{ scale: pressed ? 0.9 : 1 }],
                })}
              >
                <Trash2 size={16} color={mutedColor} />
              </Pressable>
            )}
          </View>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  isDark,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  isDark: boolean;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 16,
        opacity: pressed ? 0.7 : 1,
        backgroundColor: active
          ? (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)")
          : "transparent",
      })}
    >
      {icon}
      <Text
        style={{
          color: isDark ? "#a3a3a3" : "#8B8178",
          fontFamily: "Manrope_500Medium",
          fontSize: 11,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}
