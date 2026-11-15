import { ensureTafsirSourceImported } from "@/lib/database/init";
import type { TafsirSourceId } from "@/lib/tafsir/sources";

type Database = Parameters<typeof ensureTafsirSourceImported>[0];

const inFlight = new Map<TafsirSourceId, Promise<void>>();
let lastImport: Promise<unknown> = Promise.resolve();

/**
 * One import per source at a time, shared by every picker, and imports of different sources run
 * one after another so their replacement transactions never overlap. The import owner stages the
 * whole source before it replaces the old rows in one transaction, so a failure keeps what was there.
 */
export function importTafsirSource(db: Database, sourceId: TafsirSourceId): Promise<void> {
  const running = inFlight.get(sourceId);
  if (running) return running;
  const idle = inFlight.size === 0;
  const run = () => ensureTafsirSourceImported(db, sourceId);
  let started: Promise<void>;
  if (idle) {
    // Starting at once keeps the first import's work in the same tick as the user's tap.
    try {
      started = Promise.resolve(run());
    } catch (error) {
      started = Promise.reject(error);
    }
  } else {
    started = lastImport.then(run, run);
  }
  lastImport = started.catch(() => undefined);
  const attempt: Promise<void> = started.finally(() => {
    if (inFlight.get(sourceId) === attempt) inFlight.delete(sourceId);
  });
  inFlight.set(sourceId, attempt);
  return attempt;
}

/** Sources whose import is still running, for pickers that open while it continues. */
export function isTafsirSourceImporting(sourceId: TafsirSourceId): boolean {
  return inFlight.has(sourceId);
}
