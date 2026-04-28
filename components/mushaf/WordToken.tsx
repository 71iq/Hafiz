import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Text, Pressable, Platform, View } from "react-native";
import { useWordInteraction } from "@/lib/word/context";
import { useChrome } from "@/lib/ui/chrome";

type Props = {
  glyph: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  surah: number;
  ayah: number;
  wordPos: number;
  v2Page: number;
  disabled?: boolean;
  highlightColor?: string;
};

const DOUBLE_TAP_MS = 260;

function WordTokenInner({
  glyph,
  fontFamily,
  fontSize,
  lineHeight,
  surah,
  ayah,
  wordPos,
  v2Page,
  disabled = false,
  highlightColor,
}: Props) {
  const { tooltipWord, setTooltipWord, openDetail } = useWordInteraction();
  const { visible: chromeVisible, setVisible: setChromeVisible } = useChrome();
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

  const wordRef = { surah, ayah, wordPos, v2Page };

  const showTooltip = useCallback(() => {
    tokenRef.current?.measureInWindow((x, y, width, height) => {
      setTooltipWord(wordRef, { x, y, width, height });
    });
  }, [surah, ayah, wordPos, v2Page, setTooltipWord]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    if (!isTouchInput) {
      // Mouse / desktop: single click → tooltip
      showTooltip();
      return;
    }
    // Touch input: tap toggles chrome; double-tap shows tooltip
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      // Second tap arrived in time → revert the pending chrome toggle (it
      // hadn't fired yet, since we cleared the timer) and show tooltip.
      showTooltip();
      return;
    }
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      setChromeVisible(!chromeVisible);
    }, DOUBLE_TAP_MS);
  }, [disabled, isTouchInput, chromeVisible, setChromeVisible, showTooltip]);

  const handleLongPress = useCallback(() => {
    if (disabled) return;
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
    openDetail(wordRef);
  }, [disabled, surah, ayah, wordPos, v2Page, openDetail]);

  // Web: right-click also opens the detail sheet (matches "long press" intent)
  const webContextMenu =
    Platform.OS === "web" && !disabled
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

  return (
    <Pressable
      ref={tokenRef as any}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={400}
      {...webContextMenu}
    >
      <Text
        className={
          isTooltipSelected
            ? "text-primary-accent dark:text-primary-bright"
            : "text-charcoal dark:text-neutral-100"
        }
        style={{
          fontFamily,
          fontSize,
          lineHeight,
          ...(bgColor && {
            backgroundColor: bgColor,
            borderRadius: 6,
          }),
          ...(isTooltipSelected && !bgColor && {
            backgroundColor: "rgba(13, 148, 136, 0.08)",
            borderRadius: 6,
          }),
        }}
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

export const WordToken = memo(WordTokenInner);
