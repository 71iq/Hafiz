import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

/**
 * Native startup mirror of the explicit UI language and theme. SQLite stays authoritative: this
 * small copy only lets the loading screen and first frames use the saved language and theme before
 * the database is ready. Web keeps its existing synchronous localStorage keys instead.
 */
export const UI_BOOTSTRAP_KEY = "hafiz_ui_bootstrap_v1";

export type BootstrapLanguage = "en" | "ar";
export type BootstrapTheme = "system" | "beige" | "white" | "dark" | "amoled";
export type UiBootstrap = { version: 1; language: BootstrapLanguage; theme: BootstrapTheme };

const THEMES: readonly BootstrapTheme[] = ["system", "beige", "white", "dark", "amoled"];

export function parseUiBootstrap(raw: string | null | undefined): UiBootstrap | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (record.language !== "en" && record.language !== "ar") return null;
  if (typeof record.theme !== "string" || !THEMES.includes(record.theme as BootstrapTheme)) return null;
  return { version: 1, language: record.language, theme: record.theme as BootstrapTheme };
}

type BootstrapState = { resolved: false } | { resolved: true; value: UiBootstrap | null };

let state: BootstrapState = Platform.OS === "web" ? { resolved: true, value: null } : { resolved: false };
let loading: Promise<UiBootstrap | null> | null = null;
const listeners = new Set<() => void>();

function publish(next: BootstrapState) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Reads the native mirror once per process. A failed or malformed read resolves to null. */
export function loadUiBootstrap(): Promise<UiBootstrap | null> {
  if (state.resolved) return Promise.resolve(state.value);
  if (!loading) {
    loading = AsyncStorage.getItem(UI_BOOTSTRAP_KEY)
      .then((raw) => parseUiBootstrap(raw))
      .catch(() => null)
      .then((value) => {
        if (!state.resolved) publish({ resolved: true, value });
        return state.resolved ? state.value : value;
      });
  }
  return loading;
}

/** undefined while the native read is pending; null when there is no valid mirror. */
export function getResolvedUiBootstrap(): UiBootstrap | null | undefined {
  return state.resolved ? state.value : undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

export function useUiBootstrap(): BootstrapState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Mirrors a committed language and theme. Native only; failures are ignored. */
export async function writeUiBootstrap(language: BootstrapLanguage, theme: BootstrapTheme): Promise<void> {
  if (Platform.OS === "web") return;
  const value: UiBootstrap = { version: 1, language, theme };
  publish({ resolved: true, value });
  try {
    await AsyncStorage.setItem(UI_BOOTSTRAP_KEY, JSON.stringify(value));
  } catch {
    // The mirror is a startup convenience. SQLite remains the source of truth.
  }
}

/** Test helper: forget the in-memory mirror state. */
export function resetUiBootstrapForTests(next?: UiBootstrap | null) {
  loading = null;
  state =
    next === undefined
      ? Platform.OS === "web"
        ? { resolved: true, value: null }
        : { resolved: false }
      : { resolved: true, value: next };
}
