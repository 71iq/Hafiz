import { useEffect, useReducer } from "react";
import { isQuranPageFontLoaded, loadQuranPageFont, type QuranPageFontStyle } from "./loader";

/**
 * Loads a Quran page font and reports when glyphs may be mounted.
 *
 * Page-font glyph codes are ordinary Arabic presentation-form characters, so text drawn before its
 * page font is registered shows wrong Arabic from the system font. Android also caches the text
 * measurement made with that fallback font, so a later remount keeps the wrong line breaks and
 * clips the ayah. Callers must not mount glyph text until this returns true.
 */
export function useQuranPageFontReady(style: QuranPageFontStyle, page: number | null | undefined): boolean {
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  const ready = page ? isQuranPageFontLoaded(style, page) : false;

  useEffect(() => {
    if (!page || ready) return;
    let cancelled = false;
    loadQuranPageFont(style, page)
      .then(() => {
        if (!cancelled) refresh();
      })
      .catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [style, page, ready]);

  return ready;
}
