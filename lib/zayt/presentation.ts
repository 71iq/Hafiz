import { useEffect, useState } from "react";
import type { AppDatabase } from "@/lib/database/types";
import { readHabitSettings } from "@/lib/habit/settings";
import { subscribeHabitChanged } from "@/lib/habit/use-habit-overview";

/**
 * 10.3: which Zayt events have already played. An event plays once, when it is new: a session result,
 * a return episode, a juz completed on this device or a just-finished Journey. The record lives here,
 * outside the image component, so a remount, a revisit, a sync or a restore shows the poster instead
 * of a replay. Only the return episode is kept across launches (by its caller); the other events
 * cannot reappear after a restart.
 */
const presented = new Set<string>();
/** Events created on this device in this run, such as a juz unlocked by a review just now. */
const live = new Set<string>();
const resultIds = new WeakMap<object, string>();
let nextResultId = 0;

export function isZaytPresented(id: string): boolean {
  return presented.has(id);
}

export function markZaytPresented(id: string): void {
  presented.add(id);
}

/** A session result's event ID, stable for as long as the flow keeps that result object. */
export function zaytResultEventId(result: object): string {
  let id = resultIds.get(result);
  if (!id) {
    nextResultId += 1;
    id = `result:${nextResultId}`;
    resultIds.set(result, id);
  }
  return id;
}

export function markZaytLiveEvent(id: string): void {
  live.add(id);
}

export function isZaytLiveEvent(id: string): boolean {
  return live.has(id);
}

export function resetZaytPresentationsForTests(): void {
  presented.clear();
  live.clear();
}

/**
 * The Show Zayt setting (ZAY-02) for screens without the habit overview. Unknown while it loads,
 * and a failed read hides Zayt.
 */
export function useShowZayt(db: AppDatabase): boolean | undefined {
  const [show, setShow] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let current = true;
    const read = () =>
      readHabitSettings(db)
        .then((settings) => {
          if (current) setShow(settings.showZayt);
        })
        .catch(() => {
          if (current) setShow(false);
        });
    void read();
    const unsubscribe = subscribeHabitChanged(() => void read());
    return () => {
      current = false;
      unsubscribe();
    };
  }, [db]);
  return show;
}
