import { useSyncExternalStore } from "react";
import { router } from "expo-router";

/**
 * Opens the existing Search overlay, which Home owns, from anywhere: the sidebar Search entry,
 * Ctrl/Cmd+K and `/`, and the legacy /search?q= link. A request waits until Home consumes it, so a
 * redirect that mounts Home later still opens Search once with its query.
 */
export type SearchRequest = { id: number; query: string };

let pending: SearchRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

export function requestSearch(query = ""): SearchRequest {
  pending = { id: nextId++, query: query.trim() };
  publish();
  return pending;
}

/** Hands the pending request to its owner once; a stale id (already replaced) is ignored. */
export function consumeSearchRequest(id: number): SearchRequest | null {
  if (!pending || pending.id !== id) return null;
  const request = pending;
  pending = null;
  publish();
  return request;
}

export function usePendingSearchRequest(): SearchRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
    () => null,
  );
}

/** Goes to Home (the single Search owner) and opens Search there. */
export function openSearch(query = "") {
  requestSearch(query);
  router.navigate("/(tabs)/home");
}

/** The shortcut belongs to text editing when focus is in a field or editable content. */
export function isEditableKeyTarget(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable === true;
}

type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "isComposing" | "defaultPrevented" | "target"
>;

/**
 * Ctrl/Cmd+K and `/` open Search outside text editing (C07). `/` ignores Ctrl/Meta/Alt. Composition
 * and an event a nearer owner already handled are left alone.
 */
export function isSearchShortcut(event: ShortcutEvent): boolean {
  if (event.defaultPrevented || event.isComposing || isEditableKeyTarget(event.target)) return false;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") return true;
  return event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
}
