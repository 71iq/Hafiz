import { useCallback, useEffect, useRef, useState } from "react";
import { useInlineOperationNotice, type InlineNoticeAttempt } from "@/components/ui/OperationNoticeProvider";
import { importTafsirSource } from "@/lib/tafsir/import";
import type { TafsirSourceId } from "@/lib/tafsir/sources";

type Options = {
  db: Parameters<typeof importTafsirSource>[0];
  onSelected: (sourceId: TafsirSourceId) => void;
  recoveryMessage: string;
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
export function useTafsirSourceSelection({ db, onSelected, onError, recoveryMessage }: Options) {
  const createAttempt = useInlineOperationNotice();
  const current = useRef<InlineNoticeAttempt | null>(null);
  const [importingSource, setImportingSource] = useState<TafsirSourceId | null>(null);
  const [failedSource, setFailedSource] = useState<TafsirSourceId | null>(null);

  // Recovery removes the picker and its inline Retry. The notice owner can still report that failure.
  useEffect(() => () => current.current?.retire(), []);

  const cancel = useCallback(() => {
    current.current?.retire("normal");
    setImportingSource(null);
    setFailedSource(null);
  }, []);

  const select = useCallback(
    async (sourceId: TafsirSourceId, needsDownload: boolean): Promise<TafsirSelectionOutcome> => {
      current.current?.retire("normal");
      const attempt = createAttempt();
      current.current = attempt;
      setFailedSource(null);
      setImportingSource(needsDownload ? sourceId : null);
      try {
        if (needsDownload) await importTafsirSource(db, sourceId);
        if (!attempt.isCurrent()) return "superseded";
        onSelected(sourceId);
        attempt.finish();
        setImportingSource(null);
        return "selected";
      } catch (error) {
        onError?.(error);
        if (attempt.report(recoveryMessage) !== "inline") return "superseded";
        setImportingSource(null);
        setFailedSource(sourceId);
        return "failed";
      }
    },
    [createAttempt, db, onError, onSelected, recoveryMessage],
  );

  return { importingSource, failedSource, select, cancel };
}
