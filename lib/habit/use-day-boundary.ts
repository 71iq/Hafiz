import { useEffect } from "react";
import { AppState } from "react-native";
import { addDays, atLocalTime, localDateOf } from "@/lib/habit/dates";

/** The next local midnight after `now`, when a new local day starts. */
export function nextLocalMidnight(now: Date): Date {
  return atLocalTime(addDays(localDateOf(now), 1), 0);
}

/**
 * Keeps a screen's day-scoped data current when nothing else would reload it: a screen left open
 * overnight, or the app resumed on another day without a focus change. Calls `reload` when the app
 * returns from the background and when the clock reaches `boundary` (epoch ms, null for none), the
 * next instant the data changes by time alone. Each load sets the next boundary, which re-arms the
 * timer. `reload` decides whether the screen is focused.
 *
 * The timer runs only while the app is in the foreground, so a resume after the boundary reloads once,
 * from the foreground event, rather than once for the event and again for the overdue timer. On the
 * web, AppState follows page visibility.
 */
export function useDayBoundaryRefresh(boundary: number | null, reload: () => void): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disarm = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const arm = () => {
      disarm();
      if (boundary === null) return;
      // A load that finished after its own boundary reloads at once.
      timer = setTimeout(
        () => {
          timer = undefined;
          // A timer can fire a little early; a reload then would compute the same boundary and stop.
          if (Date.now() < boundary) arm();
          else reload();
        },
        Math.max(0, boundary - Date.now()),
      );
    };

    let away = AppState.currentState === "background";
    if (!away) arm();
    // react-native-web returns nothing when the page has no visibility API; the timer still runs.
    const subscription: { remove: () => void } | undefined = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        away = true;
        disarm();
      } else if (state === "active" && away) {
        away = false;
        // A boundary that passed while away is covered by this reload, which sets the next one.
        if (boundary !== null && boundary > Date.now()) arm();
        reload();
      }
    });
    return () => {
      disarm();
      subscription?.remove();
    };
  }, [boundary, reload]);
}
