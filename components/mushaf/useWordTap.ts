import { useCallback, useMemo } from "react";
import { Platform } from "react-native";
import { useWordInteraction, type TooltipPosition } from "@/lib/word/context";
import { useChromeActions } from "@/lib/ui/chrome";

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

function hasActiveTextSelection(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const selection = window.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && selection.rangeCount > 0);
}

/**
 * Shared word tap behavior. On web a completed tap or click shows the word gloss at once, in page
 * and verse views alike; a drag, long press or text selection cancels it, and there is no word
 * double-tap action. A long press (or right click) opens the word detail sheet. On native a tap
 * reaches the reader's tap layer and toggles the controls.
 */
export function useWordTap({ surah, ayah, wordPos, v2Page, disabled = false, hidden = false }: WordTapInput) {
  const { tooltipWord, setTooltipWord, openDetail, detailWord } = useWordInteraction();
  const { markActivity } = useChromeActions();
  const isTouchInput = useMemo(() => {
    if (Platform.OS !== "web") return true;
    if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) return true;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(pointer: coarse)").matches;
    }
    return false;
  }, []);

  const wordRef = useMemo(() => ({ surah, ayah, wordPos, v2Page }), [surah, ayah, wordPos, v2Page]);
  const isWord = (word: { surah: number; ayah: number; wordPos: number } | null) =>
    word != null && word.surah === surah && word.ayah === ayah && word.wordPos === wordPos;
  // The word stays marked while its gloss or its detail sheet is open.
  const isTooltipSelected = isWord(tooltipWord) || isWord(detailWord);

  const press = useCallback(
    (locate: LocateWord) => {
      // Native has no floating tooltip (long press opens word detail), so a tap must not select the
      // word: nothing showed or cleared that selection and the word stayed highlighted. The tap
      // reaches the reader's tap layer, which toggles the controls.
      if (disabled || hidden || Platform.OS !== "web") return;
      // A press that ends a text selection belongs to the selection menu, not the gloss.
      if (hasActiveTextSelection()) return;
      locate((position) => setTooltipWord(wordRef, position));
    },
    [disabled, hidden, setTooltipWord, wordRef],
  );

  const longPress = useCallback(() => {
    if (disabled || hidden) return;
    markActivity();
    openDetail(wordRef);
  }, [disabled, hidden, markActivity, openDetail, wordRef]);

  return { wordRef, isTooltipSelected, isTouchInput, press, longPress, openDetail };
}
