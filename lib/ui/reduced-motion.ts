import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

let reduceMotion = true;
const listeners = new Set<() => void>();
let stopObserving: (() => void) | undefined;

function publish(value: boolean) {
  if (value === reduceMotion) return;
  reduceMotion = value;
  for (const listener of listeners) listener();
}

function observePreference() {
  let active = true;
  let receivedEvent = false;
  let subscription: ReturnType<typeof AccessibilityInfo.addEventListener> | undefined;

  try {
    subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      if (!active) return;
      receivedEvent = true;
      publish(value);
    });
  } catch {
  }

  try {
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (active && !receivedEvent) publish(value);
      },
      () => {
      },
    );
  } catch {
  }

  return () => {
    active = false;
    subscription?.remove();
    reduceMotion = true;
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) stopObserving = observePreference();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopObserving?.();
      stopObserving = undefined;
    }
  };
}

export function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => reduceMotion,
    () => true,
  );
}
