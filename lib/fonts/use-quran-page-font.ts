import { useEffect, useState } from "react";
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
  const [ready, setReady] = useState(() => (page ? isQuranPageFontLoaded(style, page) : false));

  useEffect(() => {
    if (!page) {
      setReady(false);
      return;
    }
    if (isQuranPageFontLoaded(style, page)) {
      setReady(true);
      return;
    }
    setReady(false);
    let cancelled = false;
    loadQuranPageFont(style, page)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [style, page]);

  return ready;
}
