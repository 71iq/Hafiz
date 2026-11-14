import { useEffect, useMemo, useState } from "react";
import type { DatabaseExecutor } from "@/lib/database/types";
import { loadVerseMeanings, meaningKey, type MeaningLanguage } from "@/lib/hifz/meanings";

const NONE: ReadonlyMap<string, string> = new Map();

type Loaded = Readonly<{ language: MeaningLanguage; meanings: ReadonlyMap<string, string> }>;

/**
 * MUT-05: the meanings of `verses` (see loadVerseMeanings), read when the set of verses or the language
 * changes rather than on each render. Until a read finishes, the last one for the same language stays,
 * since a growing set only adds verses. Empty before the first read and after a failed one.
 */
export function useVerseMeanings(
  db: DatabaseExecutor,
  verses: readonly { surah: number; ayah: number }[],
  language: MeaningLanguage,
): ReadonlyMap<string, string> {
  const key = useMemo(() => [...new Set(verses.map(meaningKey))].sort().join(","), [verses]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (key === "") return;
    let current = true;
    const wanted = key.split(",").map((ref) => {
      const [surah, ayah] = ref.split(":").map(Number);
      return { surah, ayah };
    });
    loadVerseMeanings(db, wanted, language)
      .then((meanings) => {
        if (current) setLoaded({ language, meanings });
      })
      .catch((error: unknown) => console.warn("[SimilarVerses] Meanings failed to load:", error));
    return () => {
      current = false;
    };
  }, [db, key, language]);
  return loaded?.language === language ? loaded.meanings : NONE;
}
