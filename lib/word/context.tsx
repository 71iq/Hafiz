import React, { createContext, useContext, useState, useCallback, useRef } from "react";

export type WordRef = {
  surah: number;
  ayah: number;
  wordPos: number;
  v2Page: number;
};

export type TooltipPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type WordInteractionContextType = {
  tooltipWord: WordRef | null;
  tooltipPosition: TooltipPosition | null;
  detailWord: WordRef | null;
  setTooltipWord: (word: WordRef | null, position?: TooltipPosition) => void;
  openDetail: (word: WordRef) => void;
  closeDetail: () => void;
  clearTooltip: () => void;
  clearTooltipDelayed: () => void;
  cancelTooltipClear: () => void;
  navigateToAyah: (surah: number, ayah: number) => void;
  setNavigateToAyah: (fn: (surah: number, ayah: number) => void) => void;
};

const WordInteractionContext = createContext<WordInteractionContextType>({
  tooltipWord: null,
  tooltipPosition: null,
  detailWord: null,
  setTooltipWord: () => {},
  openDetail: () => {},
  closeDetail: () => {},
  clearTooltip: () => {},
  clearTooltipDelayed: () => {},
  cancelTooltipClear: () => {},
  navigateToAyah: () => {},
  setNavigateToAyah: () => {},
});

export function useWordInteraction() {
  return useContext(WordInteractionContext);
}

export function WordInteractionProvider({ children }: { children: React.ReactNode }) {
  const [tooltipWord, setTooltipWordState] = useState<WordRef | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const [detailWord, setDetailWord] = useState<WordRef | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTooltipWord = useCallback((word: WordRef | null, position?: TooltipPosition) => {
    // Cancel any pending delayed clear when showing a new tooltip
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setTooltipWordState((prev) => {
      // Toggle off if same word tapped again
      if (
        prev &&
        word &&
        prev.surah === word.surah &&
        prev.ayah === word.ayah &&
        prev.wordPos === word.wordPos
      ) {
        setTooltipPosition(null);
        return null;
      }
      setTooltipPosition(position ?? null);
      return word;
    });
  }, []);

  const clearTooltip = useCallback(() => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setTooltipWordState(null);
  }, []);

  const clearTooltipDelayed = useCallback(() => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      setTooltipWordState(null);
      clearTimerRef.current = null;
    }, 1000);
  }, []);

  const cancelTooltipClear = useCallback(() => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);

  const openDetail = useCallback((word: WordRef) => {
    setDetailWord(word);
    setTooltipWordState(null);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailWord(null);
  }, []);

  const navigateRef = useRef<(surah: number, ayah: number) => void>(() => {});

  const navigateToAyah = useCallback((surah: number, ayah: number) => {
    navigateRef.current(surah, ayah);
  }, []);

  const setNavigateToAyah = useCallback((fn: (surah: number, ayah: number) => void) => {
    navigateRef.current = fn;
  }, []);

  return (
    <WordInteractionContext.Provider
      value={{
        tooltipWord,
        tooltipPosition,
        detailWord,
        setTooltipWord,
        openDetail,
        closeDetail,
        clearTooltip,
        clearTooltipDelayed,
        cancelTooltipClear,
        navigateToAyah,
        setNavigateToAyah,
      }}
    >
      {children}
    </WordInteractionContext.Provider>
  );
}
