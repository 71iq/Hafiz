import { useEffect, useRef, type RefObject } from "react";
import { Platform } from "react-native";

type Options = {
  /** False while the sheet is closed or another surface sits on top of it. */
  enabled: boolean;
  isRTL: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

// Controls that use Left and Right themselves, or where the keys move a text caret.
const ARROW_OWNER_ROLES = new Set([
  "slider",
  "spinbutton",
  "tab",
  "tablist",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "radio",
  "radiogroup",
  "scrollbar",
]);

type ElementLike = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  parentElement?: ElementLike | null;
};

/** True when Left/Right belong to the focused element rather than to sheet navigation. */
export function arrowKeysBelongToTarget(target: unknown): boolean {
  let node = target as ElementLike | null;
  while (node && typeof node === "object") {
    const tag = node.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (node.isContentEditable) return true;
    const role = node.getAttribute?.("role");
    if (role && ARROW_OWNER_ROLES.has(role)) return true;
    node = node.parentElement ?? null;
  }
  return false;
}

/** Maps a key to a step, mirroring Left and Right in Arabic so Right goes back. */
export function detailArrowStep(key: string, isRTL: boolean): "previous" | "next" | null {
  if (key === "ArrowLeft") return isRTL ? "next" : "previous";
  if (key === "ArrowRight") return isRTL ? "previous" : "next";
  return null;
}

/**
 * Web keyboard stepping for a detail sheet. Left and Right step only while focus is inside the
 * sheet (or nowhere yet, right after it opens), never while typing or inside a control that owns
 * the arrow keys, and only for the topmost surface the caller enables.
 */
export function useDetailArrowKeys(scopeRef: RefObject<unknown>, { enabled, isRTL, onPrevious, onNext }: Options) {
  const latest = useRef({ isRTL, onPrevious, onNext });
  latest.current = { isRTL, onPrevious, onNext };

  useEffect(() => {
    if (!enabled || Platform.OS !== "web" || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const step = detailArrowStep(event.key, latest.current.isRTL);
      if (!step) return;
      if (arrowKeysBelongToTarget(event.target)) return;
      const active = typeof document === "undefined" ? null : document.activeElement;
      const scope = scopeRef.current as { contains?: (node: unknown) => boolean } | null;
      const focusInScope = !!active && !!scope?.contains?.(active);
      const focusNowhere = !active || active === document.body;
      if (!focusInScope && !focusNowhere) return;
      event.preventDefault();
      event.stopPropagation();
      if (step === "previous") latest.current.onPrevious();
      else latest.current.onNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, scopeRef]);
}
