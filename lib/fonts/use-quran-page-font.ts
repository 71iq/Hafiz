import { useEffect, useState } from "react";
import { isQuranPageFontLoaded, loadQuranPageFont, type QuranPageFontStyle } from "./loader";

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
