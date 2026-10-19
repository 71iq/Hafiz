import { useEffect, useState } from "react";
import { isSurahNameFontLoaded, loadSurahNameFont } from "@/lib/fonts/loader";

export function useSurahNameFont(needed: boolean): boolean {
  const [ready, setReady] = useState(() => isSurahNameFontLoaded());

  useEffect(() => {
    if (!needed) return;
    if (isSurahNameFontLoaded()) {
      setReady(true);
      return;
    }
    setReady(false);
    let cancelled = false;
    loadSurahNameFont()
      .then(() => {
        if (!cancelled) requestAnimationFrame(() => setReady(true));
      })
      .catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [needed]);

  return ready;
}
