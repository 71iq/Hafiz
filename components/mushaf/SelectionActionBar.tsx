import { useState, useCallback, useEffect } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { formatAyahRef, toArabicNumber } from "@/lib/arabic";
import { Copy, BookMarked, Highlighter, PenLine, StickyNote, Trash2, Check } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { systemConfirmsCopy } from "@/lib/clipboard-feedback";
import { OverlayBody, OverlayHeader, ResponsiveOverlay } from "@/components/ui/ResponsiveOverlay";
import { useSelection } from "@/lib/selection/context";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { buildAyahCopyText } from "@/lib/selection/queries";
import { HIGHLIGHT_COLORS, highlightColorNameKey } from "@/lib/selection/types";
import { loadMushafIndex, type MushafIndex } from "@/lib/mushaf/position";
import { WriteReflectionSheet } from "@/components/reflections/WriteReflectionSheet";
import { PrivateNoteSheet } from "@/components/notes/PrivateNoteSheet";

type BusyAction = "copy" | "highlight" | "remove-highlight" | "bookmark";

/** "Al-Baqarah 2:255" / "البقرة ٢:٢٥٥", or a range "2:255-257" in the same surah. */
export function selectionTitle(
  index: MushafIndex | null,
  isRTL: boolean,
  surah: number,
  ayahStart: number,
  ayahEnd: number,
): string {
  const meta = index?.surahByNumber.get(surah);
  const name = meta ? (isRTL ? meta.name_arabic : meta.name_english) : "";
  const start = formatAyahRef(isRTL, surah, ayahStart);
  const ref = ayahEnd !== ayahStart ? `${start}-${isRTL ? toArabicNumber(ayahEnd) : ayahEnd}` : start;
  return name ? `${name} ${ref}` : ref;
}

export function SelectionActionBar() {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, themeColors, uiLanguage } = useSettings();
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
  const [showWriteReflection, setShowWriteReflection] = useState(false);
  const [showPrivateNote, setShowPrivateNote] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [index, setIndex] = useState<MushafIndex | null>(null);

  const isOpen = selection !== null;
  const currentHighlight = selection ? getHighlightColor(selection.start.surah, selection.start.ayah) : undefined;
  const currentlyBookmarked = selection ? isBookmarked(selection.start.surah, selection.start.ayah) : false;
  const actionBusy = busyAction !== null;

  useEffect(() => {
    if (!selection || index) return;
    let active = true;
    loadMushafIndex(db)
      .then((loaded) => {
        if (active) setIndex(loaded);
      })
      .catch((e) => console.warn("[SelectionActionBar] Failed to load surah names:", e));
    return () => {
      active = false;
    };
  }, [db, index, selection]);

  const handleClose = useCallback(() => {
    setShowColors(false);
    clearSelection();
  }, [clearSelection]);

  const handleCopy = useCallback(async () => {
    if (actionBusy || !selection) return;
    setBusyAction("copy");
    try {
      const { start } = selection;
      const text = await buildAyahCopyText(db, start.surah, start.ayah, start.ayah, uiLanguage);
      if (!text) throw new Error("Ayah text is unavailable");
      await Clipboard.setStringAsync(text);
      if (!systemConfirmsCopy()) showToast(s.copied);
      handleClose();
    } catch (e) {
      console.warn("[SelectionActionBar] Failed to copy selection:", e);
      showToast(s.copyFailed);
    } finally {
      setBusyAction(null);
    }
  }, [actionBusy, db, selection, uiLanguage, showToast, s.copied, s.copyFailed, handleClose]);

  const handleHighlightColor = useCallback(
    async (color: string) => {
      if (actionBusy) return;
      setBusyAction("highlight");
      try {
        await addHighlightForSelection(color);
        showToast(s.highlightAdded);
        setShowColors(false);
        handleClose();
      } catch (e) {
        console.warn("[SelectionActionBar] Failed to highlight selection:", e);
        showToast(s.highlightActionFailed);
      } finally {
        setBusyAction(null);
      }
    },
    [actionBusy, addHighlightForSelection, showToast, s.highlightAdded, s.highlightActionFailed, handleClose]
  );

  const handleRemoveHighlight = useCallback(async () => {
    if (actionBusy) return;
    setBusyAction("remove-highlight");
    try {
      await removeHighlightForSelection();
      showToast(s.highlightRemoved);
      setShowColors(false);
      handleClose();
    } catch (e) {
      console.warn("[SelectionActionBar] Failed to remove highlight:", e);
      showToast(s.highlightActionFailed);
    } finally {
      setBusyAction(null);
    }
  }, [actionBusy, removeHighlightForSelection, showToast, s.highlightRemoved, s.highlightActionFailed, handleClose]);

  const handleBookmark = useCallback(async () => {
    if (actionBusy) return;
    setBusyAction("bookmark");
    try {
      const result = await toggleBookmarkForSelection();
      if (result === "added") showToast(s.bookmarkAdded);
      else if (result === "removed") showToast(s.bookmarkRemoved);
      handleClose();
    } catch (e) {
      console.warn("[SelectionActionBar] Failed to toggle bookmark:", e);
      showToast(s.bookmarkActionFailed);
    } finally {
      setBusyAction(null);
    }
  }, [actionBusy, toggleBookmarkForSelection, showToast, s.bookmarkAdded, s.bookmarkRemoved, s.bookmarkActionFailed, handleClose]);

  const iconColor = isDark ? "#e5e5e5" : "#2D2D2D";
  const mutedColor = isDark ? "#a3a3a3" : "#7A634D";
  const title = selection
    ? selectionTitle(index, isRTL, selection.start.surah, selection.start.ayah, selection.end.ayah)
    : "";
  const ayahPreview = selection
    ? `${formatAyahRef(isRTL, selection.start.surah, selection.start.ayah)}${selection.start.ayah !== selection.end.ayah ? `-${formatAyahRef(isRTL, selection.end.ayah)}` : ""}`
    : "";

  return (
    <>
    <ResponsiveOverlay
      open={isOpen}
      onClose={handleClose}
      phonePresentation="sheet"
      desktopPresentation="dialog"
      maxWidth={480}
    >
      <OverlayHeader title={title} onClose={handleClose} isRTL={isRTL} />
      <OverlayBody contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}>
        {/* Five equal columns with two-line labels fit 320px phones. The row mirrors by hand, so it
            pins LTR coordinates; an inherited "rtl" would flip it back. */}
        <View
          style={{
            direction: "ltr",
            flexDirection: isRTL ? "row-reverse" : "row",
            alignItems: "flex-start",
            gap: 4,
            marginBottom: showColors ? 12 : 0,
          }}
        >
          <ActionButton
            icon={<Copy size={20} color={iconColor} />}
            label={s.copy}
            onPress={handleCopy}
            isDark={isDark}
            busy={busyAction === "copy"}
            dimmed={actionBusy && busyAction !== "copy"}
            isRTL={isRTL}
          />
          <ActionButton
            icon={<PenLine size={20} color={iconColor} />}
            label={s.shareReflectionAction}
            onPress={() => setShowWriteReflection(true)}
            isDark={isDark}
            dimmed={actionBusy}
            isRTL={isRTL}
          />
          <ActionButton
            icon={<StickyNote size={20} color={iconColor} />}
            label={s.privateNoteAction}
            onPress={() => setShowPrivateNote(true)}
            isDark={isDark}
            dimmed={actionBusy}
            isRTL={isRTL}
          />
          <ActionButton
            icon={<Highlighter size={20} color={currentHighlight ?? iconColor} />}
            label={s.highlight}
            onPress={() => setShowColors((v) => !v)}
            isDark={isDark}
            active={showColors}
            busy={busyAction === "highlight" || busyAction === "remove-highlight"}
            dimmed={actionBusy && busyAction !== "highlight" && busyAction !== "remove-highlight"}
            isRTL={isRTL}
            expanded={showColors}
          />
          <ActionButton
            icon={<BookMarked size={20} color={currentlyBookmarked ? "#B7791F" : iconColor} />}
            label={currentlyBookmarked ? s.removeBookmark : s.bookmark}
            onPress={handleBookmark}
            isDark={isDark}
            busy={busyAction === "bookmark"}
            dimmed={actionBusy && busyAction !== "bookmark"}
            isRTL={isRTL}
          />
        </View>

        {showColors && (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={s.highlight}
            style={{
              direction: isRTL ? "rtl" : "ltr",
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 4,
              paddingTop: 4,
            }}
          >
            {HIGHLIGHT_COLORS.map((color) => {
              const selected = currentHighlight === color;
              const name = s[highlightColorNameKey(color)];
              return (
                <Pressable
                  key={color}
                  onPress={() => handleHighlightColor(color)}
                  disabled={actionBusy}
                  accessibilityRole="radio"
                  accessibilityLabel={name}
                  accessibilityState={{ checked: selected, disabled: actionBusy }}
                  style={({ pressed }) => ({
                    width: 60,
                    minHeight: 64,
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 4,
                    paddingTop: 4,
                    opacity: actionBusy ? 0.45 : pressed ? 0.75 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: color,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: selected ? 3 : 0,
                      borderColor: isDark ? "#fff" : "#2D2D2D",
                    }}
                  >
                    {selected ? <Check size={16} color="#2D2D2D" /> : null}
                  </View>
                  <Text
                    numberOfLines={2}
                    style={{ color: mutedColor, fontFamily: "Manrope_500Medium", fontSize: 11, lineHeight: 14, textAlign: "center" }}
                  >
                    {name}
                  </Text>
                </Pressable>
              );
            })}
            {currentHighlight && (
              <Pressable
                onPress={handleRemoveHighlight}
                disabled={actionBusy}
                accessibilityRole="button"
                accessibilityLabel={s.readerRemoveHighlight}
                style={({ pressed }) => ({
                  width: 60,
                  minHeight: 64,
                  alignItems: "center",
                  gap: 4,
                  paddingTop: 4,
                  opacity: actionBusy && busyAction !== "remove-highlight" ? 0.45 : pressed ? 0.75 : 1,
                })}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: themeColors.surfaceMid,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {busyAction === "remove-highlight" ? (
                    <ActivityIndicator size="small" color={mutedColor} />
                  ) : (
                    <Trash2 size={16} color={mutedColor} />
                  )}
                </View>
                <Text
                  numberOfLines={2}
                  style={{ color: mutedColor, fontFamily: "Manrope_500Medium", fontSize: 11, lineHeight: 14, textAlign: "center" }}
                >
                  {s.readerRemoveHighlight}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </OverlayBody>
    </ResponsiveOverlay>

    {selection && (
      <WriteReflectionSheet
        open={showWriteReflection}
        onClose={() => {
          setShowWriteReflection(false);
          handleClose();
        }}
        surah={selection.start.surah}
        ayahStart={selection.start.ayah}
        ayahEnd={selection.end.ayah}
        ayahPreview={ayahPreview}
      />
    )}
    {selection && (
      <PrivateNoteSheet
        open={showPrivateNote}
        onClose={() => {
          setShowPrivateNote(false);
          handleClose();
        }}
        surah={selection.start.surah}
        ayahStart={selection.start.ayah}
        ayahEnd={selection.end.ayah}
        ayahPreview={ayahPreview}
      />
    )}
    </>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  isDark,
  isRTL,
  active,
  busy = false,
  dimmed = false,
  expanded,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  isDark: boolean;
  isRTL: boolean;
  active?: boolean;
  /** This action's write is pending: a spinner replaces its icon. */
  busy?: boolean;
  /** Another action's write is pending: this one is disabled and dimmed. */
  dimmed?: boolean;
  expanded?: boolean;
}) {
  const disabled = busy || dimmed;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy, ...(expanded !== undefined ? { expanded } : null) }}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        minHeight: 64,
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 2,
        paddingVertical: 8,
        borderRadius: 16,
        opacity: dimmed ? 0.45 : pressed ? 0.7 : 1,
        backgroundColor: active
          ? (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)")
          : "transparent",
      })}
    >
      <View style={{ height: 20, justifyContent: "center" }}>
        {busy ? <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} /> : icon}
      </View>
      <Text
        style={{
          color: isDark ? "#a3a3a3" : "#7A634D",
          fontFamily: "Manrope_500Medium",
          fontSize: 11,
          lineHeight: 15,
          textAlign: "center",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}
