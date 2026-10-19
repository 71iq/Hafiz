import { useCallback, useRef, useState } from "react";
import { ensureTafsirSourceImported } from "@/lib/database/init";
import type { TafsirSourceId } from "@/lib/tafsir/sources";

type Options = {
  db: Parameters<typeof ensureTafsirSourceImported>[0];
  onSelected: (sourceId: TafsirSourceId) => void;
  onError: (error: unknown) => void;
};

export function useTafsirSourceSelection({ db, onSelected, onError }: Options) {
  const [importingSource, setImportingSource] = useState<TafsirSourceId | null>(null);
  const activeSourceRef = useRef<TafsirSourceId | null>(null);

  const selectSource = useCallback(
    async (sourceId: TafsirSourceId): Promise<boolean> => {
      if (activeSourceRef.current !== null) return false;
      activeSourceRef.current = sourceId;
      setImportingSource(sourceId);
      try {
        await ensureTafsirSourceImported(db, sourceId);
        onSelected(sourceId);
        return true;
      } catch (error) {
        onError(error);
        return false;
      } finally {
        activeSourceRef.current = null;
        setImportingSource(null);
      }
    },
    [db, onError, onSelected],
  );

  return { importingSource, selectSource };
}
