import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useIsFocused } from "@react-navigation/native";

/**
 * Measures time a review screen is in front of the user. Review time counts toward the daily wird
 * minimum (lib/habit/minimum.ts), so a card left on screen while the app is in the background, or
 * while another screen covers it, must not count. Times are epoch milliseconds; each method takes
 * the instant it applies at, which defaults to now.
 */
export type ActiveClock = Readonly<{
  /**
   * Active milliseconds since the last reset, as of `at`. Pass the instant an action happened, such
   * as a grade's review time, when it was taken a moment before. The clock keeps no history, so `at`
   * must not be earlier than the last pause or resume.
   */
  elapsedMs: (at?: number) => number;
  /** Start again from zero. A paused clock stays paused and counts from its next resume. */
  reset: (at?: number) => void;
  /** Stop counting, keeping the time counted so far. Pausing a paused clock does nothing. */
  pause: (at?: number) => void;
  /** Count again from `at`. Resuming a running clock does nothing. */
  resume: (at?: number) => void;
}>;

export function createActiveClock(options: { now?: () => number; running?: boolean } = {}): ActiveClock {
  // Read through a function so a test that replaces Date.now moves this clock too.
  const now = options.now ?? (() => Date.now());
  let counted = 0;
  let runningSince: number | null = (options.running ?? true) ? now() : null;
  return {
    elapsedMs: (at = now()) => counted + (runningSince === null ? 0 : Math.max(0, at - runningSince)),
    reset: (at = now()) => {
      counted = 0;
      if (runningSince !== null) runningSince = at;
    },
    pause: (at = now()) => {
      if (runningSince === null) return;
      counted += Math.max(0, at - runningSince);
      runningSince = null;
    },
    resume: (at = now()) => {
      if (runningSince === null) runningSince = at;
    },
  };
}

/**
 * Whether a state read at mount means the app is away. React Native reports "unknown" before its
 * first state, and a screen the user just opened is in front, so only a known away state counts.
 */
function isAway(state: AppStateStatus | null | undefined): boolean {
  return state === "background" || state === "inactive";
}

/**
 * An ActiveClock that runs only while the screen is focused and the app is active. It starts paused
 * and runs once both hold, so a screen mounted in the background counts nothing until the app comes
 * back. On the web, AppState follows page visibility. The returned clock keeps its identity for the
 * screen's lifetime; reset it when a new item is shown.
 */
export function useActiveClock(): ActiveClock {
  const focused = useIsFocused();
  const [clock] = useState(() => createActiveClock({ running: false }));
  useEffect(() => {
    // A blurred screen stays paused; regaining focus runs this again.
    if (!focused) return;
    if (!isAway(AppState.currentState)) clock.resume();
    // react-native-web returns nothing when the page has no visibility API; the clock then runs.
    const subscription: { remove: () => void } | undefined = AppState.addEventListener("change", (state) => {
      if (state === "active") clock.resume();
      else clock.pause();
    });
    return () => {
      subscription?.remove();
      clock.pause();
    };
  }, [clock, focused]);
  return clock;
}
