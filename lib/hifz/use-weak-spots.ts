import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { readHabitSettings } from "@/lib/habit/settings";
import { subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import { readWeakSpots } from "@/lib/hifz/errors";
import { subscribeSyncCompleted } from "@/lib/sync/events";

type Store = Readonly<{ keys: ReadonlySet<string>; enabled: boolean }>;
let store: Store = { keys: new Set(), enabled: true };
const listeners = new Set<() => void>();
let latest = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function refreshWeakSpots(db: DatabaseExecutor): Promise<void> {
  const load = ++latest;
  const [spots, settings] = await Promise.all([readWeakSpots(db), readHabitSettings(db)]);
  if (load !== latest) return;
  store = {
    keys: new Set(spots.map((spot) => `${spot.surah}:${spot.ayah}:${spot.word ?? 1}`)),
    enabled: settings.showWeakSpots,
  };
  for (const listener of listeners) listener();
}

export function useWeakSpotsLoader(db: AppDatabase | null): void {
  useEffect(() => {
    if (!db) return;
    const run = () => {
      refreshWeakSpots(db).catch((error) => console.warn("[Hifz] Weak spots failed to load:", error));
    };
    run();
    const unsubscribeReview = subscribeReviewActivity(run);
    const unsubscribeHabit = subscribeHabitChanged(run);
    const unsubscribeSync = subscribeSyncCompleted(({ pulled }) => {
      if (pulled > 0) run();
    });
    return () => {
      unsubscribeReview();
      unsubscribeHabit();
      unsubscribeSync();
    };
  }, [db]);
}

export function useWeakSpotMarker(): (surah: number, ayah: number, wordPos: number) => boolean {
  const snapshot = useSyncExternalStore(subscribe, () => store, () => store);
  return useCallback(
    (surah: number, ayah: number, wordPos: number) => snapshot.enabled && snapshot.keys.has(`${surah}:${ayah}:${wordPos}`),
    [snapshot],
  );
}
