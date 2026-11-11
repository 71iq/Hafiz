import { useCallback, useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";
import { useWordInteraction, type TooltipPosition } from "@/lib/word/context";
import { useChrome } from "@/lib/ui/chrome";

const DOUBLE_TAP_MS = 260;

type WordTapInput = {
  surah: number;
  ayah: number;
  wordPos: number;
  v2Page: number;
  disabled?: boolean;
  hidden?: boolean;
};

/** Reports where the tapped word is, so the tooltip can anchor to it. */
export type LocateWord = (done: (position: TooltipPosition) => void) => void;

/**
 * Shared word tap behavior: a single tap (after the double-tap window on touch input) shows the
 * word tooltip, and a long press opens the word detail sheet.
 */
export function useWordTap({ surah, ayah, wordPos, v2Page, disabled = false, hidden = false }: WordTapInput) {
  const { tooltipWord, setTooltipWord, openDetail } = useWordInteraction();
  const { markActivity } = useChrome();
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchInput = useMemo(() => {
    if (Platform.OS !== "web") return true;
    if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) return true;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(pointer: coarse)").matches;
    }
    return false;
  }, []);

  useEffect(
    () => () => {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    },
    [],
  );

  const wordRef = useMemo(() => ({ surah, ayah, wordPos, v2Page }), [surah, ayah, wordPos, v2Page]);
  const isTooltipSelected =
    tooltipWord !== null && tooltipWord.surah === surah && tooltipWord.ayah === ayah && tooltipWord.wordPos === wordPos;

  const press = useCallback(
    (locate: LocateWord) => {
      // Native has no floating tooltip (long press opens word detail), so a tap must not select the
      // word: nothing showed or cleared that selection and the word stayed highlighted. The tap
      // reaches the reader's tap layer, which toggles the controls.
      if (disabled || hidden || Platform.OS !== "web") return;
      const showTooltip = () => locate((position) => setTooltipWord(wordRef, position));
      if (!isTouchInput) {
        // Mouse / desktop: single click shows the tooltip.
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
    },
    [disabled, hidden, isTouchInput, setTooltipWord, wordRef],
  );

  const longPress = useCallback(() => {
    if (disabled || hidden) return;
    markActivity();
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
    openDetail(wordRef);
  }, [disabled, hidden, markActivity, openDetail, wordRef]);

  return { wordRef, isTooltipSelected, isTouchInput, press, longPress, openDetail };
}
