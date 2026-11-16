import { ensureTafsirSourceImported } from "@/lib/database/init";
import type { TafsirSourceId } from "@/lib/tafsir/sources";

type Database = Parameters<typeof ensureTafsirSourceImported>[0];

const inFlight = new Map<TafsirSourceId, Promise<void>>();
let lastImport: Promise<unknown> = Promise.resolve();

export function importTafsirSource(db: Database, sourceId: TafsirSourceId): Promise<void> {
  const running = inFlight.get(sourceId);
  if (running) return running;
  const idle = inFlight.size === 0;
  const run = () => ensureTafsirSourceImported(db, sourceId);
  let started: Promise<void>;
  if (idle) {
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

export function isTafsirSourceImporting(sourceId: TafsirSourceId): boolean {
  return inFlight.has(sourceId);
}
