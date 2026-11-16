import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useIsFocused } from "@react-navigation/native";

export type ActiveClock = Readonly<{
  elapsedMs: (at?: number) => number;
  reset: (at?: number) => void;
  pause: (at?: number) => void;
  resume: (at?: number) => void;
}>;

export function createActiveClock(options: { now?: () => number; running?: boolean } = {}): ActiveClock {
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

function isAway(state: AppStateStatus | null | undefined): boolean {
  return state === "background" || state === "inactive";
}

export function useActiveClock(): ActiveClock {
  const focused = useIsFocused();
  const [clock] = useState(() => createActiveClock({ running: false }));
  useEffect(() => {
    if (!focused) return;
    if (!isAway(AppState.currentState)) clock.resume();
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
