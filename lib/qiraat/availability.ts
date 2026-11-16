import { useEffect, useState } from "react";
import type { DatabaseExecutor } from "@/lib/database/types";

const cache = new WeakMap<object, Promise<Set<string> | null>>();

function loadAvailability(db: DatabaseExecutor): Promise<Set<string> | null> {
  let pending = cache.get(db as object);
  if (!pending) {
    pending = db
      .getAllAsync<{ surah: number; ayah: number }>("SELECT DISTINCT surah, ayah FROM qiraat_encyclopedia")
      .then((rows) => new Set(rows.map((row) => `${row.surah}:${row.ayah}`)))
      .catch(() => {
        cache.delete(db as object);
        return null;
      });
    cache.set(db as object, pending);
  }
  return pending;
}

export function useHasQiraat(db: DatabaseExecutor | null, surah: number, ayah: number): boolean | null {
  const [state, setState] = useState<{ key: string; value: boolean | null } | null>(null);
  const key = `${surah}:${ayah}`;
  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    loadAvailability(db).then((set) => {
      if (!cancelled) setState({ key, value: set ? set.has(key) : null });
    });
    return () => {
      cancelled = true;
    };
  }, [db, key]);
  return state?.key === key ? state.value : null;
}
