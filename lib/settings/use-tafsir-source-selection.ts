import { useCallback, useEffect, useRef, useState } from "react";
import { importTafsirSource } from "@/lib/tafsir/import";
import type { TafsirSourceId } from "@/lib/tafsir/sources";

type Options = {
  db: Parameters<typeof importTafsirSource>[0];
  onSelected: (sourceId: TafsirSourceId) => void;
  onError?: (error: unknown) => void;
};

export type TafsirSelectionOutcome = "selected" | "failed" | "superseded";

export function useTafsirSourceSelection({ db, onSelected, onError }: Options) {
  const generation = useRef(0);
  const [importingSource, setImportingSource] = useState<TafsirSourceId | null>(null);
  const [failedSource, setFailedSource] = useState<TafsirSourceId | null>(null);

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
