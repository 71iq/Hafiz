import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Text, Pressable, Platform, View } from "react-native";
import { useWordInteraction } from "@/lib/word/context";
import { useChrome } from "@/lib/ui/chrome";
import { useSettings } from "@/lib/settings/context";

type Props = {
  glyph: string;
  fontFamily: string;
  fontPalette?: string | null;
  fontSize: number;
  lineHeight: number;
  surah: number;
  ayah: number;
  wordPos: number;
  v2Page: number;
  disabled?: boolean;
  highlightColor?: string;
  hidden?: boolean;
  compactLayout?: boolean;
};

const DOUBLE_TAP_MS = 260;

function WordTokenInner({
  glyph,
  fontFamily,
  fontPalette,
  fontSize,
  lineHeight,
  surah,
  ayah,
  wordPos,
  v2Page,
  disabled = false,
  highlightColor,
  hidden = false,
  compactLayout = false,
}: Props) {
  const { tooltipWord, setTooltipWord, openDetail } = useWordInteraction();
  const { markActivity } = useChrome();
  const { isDark, viewMode, pageScroll } = useSettings();
  const tokenRef = useRef<View>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchInput = useMemo(() => {
    if (Platform.OS !== "web") return true;
    if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) return true;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(pointer: coarse)").matches;
    }
    return false;
  }, []);

  useEffect(() => () => {
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
  }, []);

  const isTooltipSelected =
    tooltipWord !== null &&
    tooltipWord.surah === surah &&
    tooltipWord.ayah === ayah &&
    tooltipWord.wordPos === wordPos;
  const allowNativeTouchSelection =
    Platform.OS === "web" &&
    isTouchInput &&
    viewMode === "page" &&
    pageScroll === "horizontal";

  const wordRef = { surah, ayah, wordPos, v2Page };

  const showTooltip = useCallback(() => {
    tokenRef.current?.measureInWindow((x, y, width, height) => {
      setTooltipWord(wordRef, { x, y, width, height });
    });
  }, [surah, ayah, wordPos, v2Page, setTooltipWord]);

  const handlePress = useCallback(() => {
    if (disabled || hidden) return;
    if (!isTouchInput) {
      // Mouse / desktop: single click → tooltip
      showTooltip();
      return;
    }
    // Touch input: keep reader chrome changes owned by the reader tap layer.
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      showTooltip();
      return;
    }
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      showTooltip();
    }, DOUBLE_TAP_MS);
  }, [disabled, hidden, isTouchInput, showTooltip]);

  const handleLongPress = useCallback(() => {
    if (disabled || hidden) return;
    markActivity();
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
    openDetail(wordRef);
  }, [disabled, hidden, surah, ayah, wordPos, v2Page, markActivity, openDetail]);

  // Web: right-click also opens the detail sheet (matches "long press" intent)
  const webContextMenu =
    Platform.OS === "web" && !disabled && !hidden
      ? {
          onContextMenu: (e: any) => {
            e?.preventDefault?.();
            openDetail(wordRef);
          },
        }
      : {};

  // Highlight background for page view (verse view highlights at container level)
  let bgColor: string | undefined;
  if (highlightColor) {
    bgColor = highlightColor + "20";
  }

  const webSelectionProps =
    Platform.OS === "web"
      ? ({
          dataSet: {
            hafizQuranToken: "word",
            hafizSurah: String(surah),
            hafizAyah: String(ayah),
            hafizWordPos: String(wordPos),
            hafizQuranHidden: hidden ? "true" : "false",
          },
        } as any)
      : {};

  return (
    <Pressable
      ref={tokenRef as any}
      onPress={handlePress}
      onLongPress={allowNativeTouchSelection ? undefined : handleLongPress}
      delayLongPress={400}
      disabled={disabled || hidden}
      style={{
        paddingHorizontal: compactLayout ? 0 : 1,
        overflow: "visible",
        ...(Platform.OS === "web" ? ({ userSelect: hidden ? "none" : "text" } as any) : null),
      }}
      {...webContextMenu}
      {...webSelectionProps}
    >
      <Text
        selectable={Platform.OS === "web" && !hidden}
        className={
          isTooltipSelected
            ? "text-primary-accent dark:text-primary-bright"
            : "text-charcoal dark:text-neutral-100"
        }
        style={{
          fontFamily,
          ...(Platform.OS === "web" && fontPalette ? ({ fontPalette } as any) : null),
          fontSize,
          lineHeight,
          paddingHorizontal: compactLayout ? 0 : 1,
          ...(bgColor && {
            backgroundColor: bgColor,
            borderRadius: 6,
          }),
          ...(isTooltipSelected && !bgColor && {
            backgroundColor: "rgba(13, 148, 136, 0.08)",
            borderRadius: 6,
          }),
          ...(hidden && {
            color: "transparent",
            borderBottomWidth: Math.max(2, fontSize * 0.08),
            borderBottomColor: isDark ? "#474747" : "#e8dac5",
            paddingBottom: Math.max(1, fontSize * 0.04),
          }),
          ...(Platform.OS === "web" ? ({ userSelect: hidden ? "none" : "text" } as any) : null),
        }}
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

export const WordToken = memo(WordTokenInner);
