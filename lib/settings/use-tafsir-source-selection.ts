import { useCallback, useEffect, useRef, useState } from "react";
import { importTafsirSource } from "@/lib/tafsir/import";
import type { TafsirSourceId } from "@/lib/tafsir/sources";

type Options = {
  db: Parameters<typeof importTafsirSource>[0];
  onSelected: (sourceId: TafsirSourceId) => void;
  /** Logs a failure; the picker shows it inline with Retry. */
  onError?: (error: unknown) => void;
};

export type TafsirSelectionOutcome = "selected" | "failed" | "superseded";

/**
 * Selection intent for one tafsir picker. Each choice starts a new generation, and closing the
 * picker (cancel) ends the current one. An installed source is selected at once. A source that
 * needs a download is selected only when its import completes while its generation is still
 * current, so a late import never replaces a newer choice or selects itself after close. The
 * import itself keeps running and stays installed.
 */
export function useTafsirSourceSelection({ db, onSelected, onError }: Options) {
  const generation = useRef(0);
  const [importingSource, setImportingSource] = useState<TafsirSourceId | null>(null);
  const [failedSource, setFailedSource] = useState<TafsirSourceId | null>(null);

  // An owner that unmounts (a screen left mid-download) no longer wants its choice applied.
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const cancel = useCallback(() => {
    generation.current += 1;
    setImportingSource(null);
    setFailedSource(null);
  }, []);

  const select = useCallback(
    async (sourceId: TafsirSourceId, needsDownload: boolean): Promise<TafsirSelectionOutcome> => {
      const current = ++generation.current;
      const isCurrent = () => generation.current === current;
      setFailedSource(null);
      setImportingSource(needsDownload ? sourceId : null);
      try {
        if (needsDownload) await importTafsirSource(db, sourceId);
        if (!isCurrent()) return "superseded";
        onSelected(sourceId);
        setImportingSource(null);
        return "selected";
      } catch (error) {
        onError?.(error);
        if (!isCurrent()) return "superseded";
        setImportingSource(null);
        setFailedSource(sourceId);
        return "failed";
      }
    },
    [db, onError, onSelected],
  );

  return { importingSource, failedSource, select, cancel };
}
