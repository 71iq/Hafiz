import { useEffect, useState } from "react";
import type { DatabaseExecutor } from "@/lib/database/types";
import { fetchWordMeaningAr, type WordMeaningArRow } from "@/lib/word/queries";

type Word = { surah: number; ayah: number; wordPos: number };

export function useArabicWordMeaning(db: DatabaseExecutor, word: Word | null) {
  const key = word ? `${word.surah}:${word.ayah}:${word.wordPos}` : null;
  const [entry, setEntry] = useState<{ db: DatabaseExecutor; key: string; row: WordMeaningArRow | null | undefined } | null>(null);
  const surah = word?.surah;
  const ayah = word?.ayah;
  const wordPos = word?.wordPos;
  useEffect(() => {
    if (key === null || surah === undefined || ayah === undefined || wordPos === undefined) {
      setEntry(null);
      return;
    }
    let active = true;
    setEntry({ db, key, row: undefined });
    fetchWordMeaningAr(db, surah, ayah, wordPos)
      .catch((error) => {
        console.warn("[WordDetailSheet] Could not read the Arabic word meaning:", error);
        return null;
      })
      .then((row) => {
        // A write that finished while reopening this word takes precedence over its initial read.
        if (active) setEntry((current) => current?.row === undefined ? { db, key, row } : current);
      });
    return () => {
      active = false;
    };
  }, [db, key, surah, ayah, wordPos]);

  function updateMeaning(row: WordMeaningArRow) {
    const changedKey = `${row.surah}:${row.ayah}:${row.word_pos}`;
    setEntry((current) => current?.db === db && current.key === changedKey ? { ...current, row } : current);
  }

  return { meaning: entry?.db === db && entry.key === key ? entry.row : undefined, updateMeaning };
}
