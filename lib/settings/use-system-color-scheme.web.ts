import { useSyncExternalStore } from "react";

const darkPreference = typeof window === "undefined" ? undefined : window.matchMedia?.("(prefers-color-scheme: dark)");

function subscribe(onChange: () => void) {
  darkPreference?.addEventListener("change", onChange);
  return () => darkPreference?.removeEventListener("change", onChange);
}

function getSnapshot() {
  return darkPreference?.matches ? "dark" : "light";
}

export function useSystemColorScheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
