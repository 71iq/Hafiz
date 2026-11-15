import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Copy, Eraser, Highlighter, Share2 } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings, withThemeOpacity } from "@/lib/settings/context";
import { useSelection } from "@/lib/selection/context";
import { formatQuranCopy } from "@/lib/selection/format";
import { HIGHLIGHT_COLORS, highlightColorNameKey } from "@/lib/selection/types";
import {
  fetchUthmaniWordsForSelection,
  type QuranSelectionWordRef,
} from "@/lib/selection/queries";

type MenuState = {
  x: number;
  y: number;
  refs: QuranSelectionWordRef[];
  refsKey: string;
  copyText: string | null;
};

type BusyAction = "copy" | "share" | "highlight" | "erase";

const TOKEN_SELECTOR = "[data-hafiz-quran-token]";
const MENU_WIDTH = 312;
const MENU_COLLAPSED_HEIGHT = 52;
const MENU_EXPANDED_HEIGHT = 112;
const VIEWPORT_GUTTER = 8;
const SELECTION_STYLE_ID = "hafiz-quran-selection-style";

function canWebShare(): boolean {
  return Platform.OS === "web" && typeof navigator !== "undefined" && typeof navigator.share === "function";
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";
}

export function WebSelectionMenu() {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, themeSurface, uiLanguage } = useSettings();
  const { showToast, addHighlightForRefs, highlightIdsForRefs, removeHighlightsForRefs } = useSelection();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [menuHeight, setMenuHeight] = useState(MENU_COLLAPSED_HEIGHT);
  const latestMenuRef = useRef<MenuState | null>(null);
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where keyboard focus was when the menu opened, so closing returns it to the reader.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const busy = busyAction !== null;
  const shareSupported = canWebShare();

  useEffect(() => {
    latestMenuRef.current = menu;
  }, [menu]);

  useEffect(() => {
    setColorPickerOpen(false);
  }, [menu?.refsKey]);

  const buildCopyText = useCallback(
    async (refs: QuranSelectionWordRef[]) => {
      const selectionText = await fetchUthmaniWordsForSelection(db, refs);
      return selectionText
        ? formatQuranCopy({ text: selectionText.text, ranges: selectionText.ranges, language: uiLanguage })
        : null;
    },
    [db, uiLanguage],
  );

  const restoreReaderFocus = useCallback(() => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && typeof document !== "undefined" && document.contains(target)) {
      requestAnimationFrame(() => target.focus?.());
    }
  }, []);

  const closeMenu = useCallback(
    (options: { clearSelection?: boolean } = {}) => {
      if (options.clearSelection) window.getSelection()?.removeAllRanges();
      setMenu(null);
      restoreReaderFocus();
    },
    [restoreReaderFocus],
  );

  const copyRefsToClipboard = useCallback(
    async (refs: QuranSelectionWordRef[]) => {
      const copyText = await buildCopyText(refs);
      if (!copyText) return false;
      await Clipboard.setStringAsync(copyText);
      closeMenu({ clearSelection: true });
      showToast(s.copied);
      return true;
    },
    [buildCopyText, closeMenu, s.copied, showToast],
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (document.getElementById(SELECTION_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = SELECTION_STYLE_ID;
    style.textContent = `
      ${TOKEN_SELECTOR}::selection,
      ${TOKEN_SELECTOR} *::selection {
        background: rgba(13, 148, 136, 0.22);
        color: inherit;
      }
      ${TOKEN_SELECTOR}::-moz-selection,
      ${TOKEN_SELECTOR} *::-moz-selection {
        background: rgba(13, 148, 136, 0.22);
        color: inherit;
      }
    `;
    document.head.appendChild(style);
  }, []);

  const positionForSelection = useCallback((
    selection: Selection,
    fallback?: { x: number; y: number },
    height = MENU_COLLAPSED_HEIGHT,
  ) => {
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();
    const width = Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
    const rawX = rect && rect.width > 0 ? rect.left + rect.width / 2 : fallback?.x ?? 0;
    const rawY = rect && rect.height > 0 ? rect.top - height - 8 : (fallback?.y ?? 0) - height - 8;
    const belowY = rect && rect.height > 0 ? rect.bottom + 8 : (fallback?.y ?? 0) + 8;
    const maxX = Math.max(VIEWPORT_GUTTER, window.innerWidth - width - VIEWPORT_GUTTER);
    const maxY = Math.max(VIEWPORT_GUTTER, window.innerHeight - height - VIEWPORT_GUTTER);
    const x = Math.min(Math.max(rawX - width / 2, VIEWPORT_GUTTER), maxX);
    const y = Math.min(Math.max(rawY < VIEWPORT_GUTTER ? belowY : rawY, VIEWPORT_GUTTER), maxY);
    return { x, y };
  }, []);

  const showForCurrentSelection = useCallback(
    (fallback?: { x: number; y: number }) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setMenu(null);
        return false;
      }

      const refs = readSelectedQuranTokens(selection);
      if (refs.length === 0) {
        setMenu(null);
        return false;
      }

      if (!latestMenuRef.current && typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        returnFocusRef.current = document.activeElement;
      }
      const refsKey = getRefsKey(refs);
      setMenu({ ...positionForSelection(selection, fallback), refs, refsKey, copyText: null });
      void buildCopyText(refs)
        .then((copyText) => {
          setMenu((current) => current?.refsKey === refsKey ? { ...current, copyText } : current);
        })
        .catch((e) => console.warn("[WebSelectionMenu] Failed to prepare selected text:", e));
      return true;
    },
    [buildCopyText, positionForSelection],
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const scheduleSelectionMenu = (fallback?: { x: number; y: number }, delay = 0) => {
      if (selectionTimerRef.current) {
        clearTimeout(selectionTimerRef.current);
      }
      selectionTimerRef.current = setTimeout(() => {
        selectionTimerRef.current = null;
        showForCurrentSelection(fallback);
      }, delay);
    };

    const handleMouseUp = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-hafiz-selection-menu]")) return;
      scheduleSelectionMenu({ x: event.clientX, y: event.clientY });
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "ContextMenu" || event.key === "F10") return;
      scheduleSelectionMenu();
    };

    // C02/C07: the menu is the topmost surface while open, so Escape closes it (and clears the
    // selection) before any reader shortcut. Shift+F10 or the context-menu key opens it.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape" && latestMenuRef.current) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu({ clearSelection: true });
        return;
      }
      const opensMenu = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
      if (opensMenu && showForCurrentSelection()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleScroll = () => setMenu(null);

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-hafiz-selection-menu]")) return;
      if (latestMenuRef.current) setMenu(null);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-hafiz-selection-menu]")) return;
      scheduleSelectionMenu({ x: event.clientX, y: event.clientY }, 80);
    };

    const handleSelectionChange = () => {
      scheduleSelectionMenu(undefined, 120);
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!showForCurrentSelection({ x: event.clientX, y: event.clientY })) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const handleCopyEvent = (event: ClipboardEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const refs = readSelectedQuranTokens(selection);
      if (refs.length === 0) return;

      event.preventDefault();
      const refsKey = getRefsKey(refs);
      const cachedCopyText =
        latestMenuRef.current?.refsKey === refsKey
          ? latestMenuRef.current.copyText
          : null;

      if (cachedCopyText && event.clipboardData) {
        event.clipboardData.setData("text/plain", cachedCopyText);
        window.setTimeout(() => {
          closeMenu({ clearSelection: true });
          showToast(s.copied);
        }, 0);
        return;
      }

      void copyRefsToClipboard(refs).catch((e) => {
        console.warn("[WebSelectionMenu] Failed to copy selected text:", e);
        showToast(s.copyFailed);
      });
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keyup", handleKeyUp);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("copy", handleCopyEvent);

    return () => {
      if (selectionTimerRef.current) {
        clearTimeout(selectionTimerRef.current);
        selectionTimerRef.current = null;
      }
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("copy", handleCopyEvent);
    };
  }, [closeMenu, copyRefsToClipboard, s.copied, s.copyFailed, showForCurrentSelection, showToast]);

  const handleCopy = useCallback(async () => {
    if (!menu || busy) return;
    setBusyAction("copy");
    try {
      const copyText = menu.copyText ?? await buildCopyText(menu.refs);
      if (!copyText) throw new Error("Selected text is unavailable");
      await Clipboard.setStringAsync(copyText);
      closeMenu({ clearSelection: true });
      showToast(s.copied);
    } catch (e) {
      console.warn("[WebSelectionMenu] Failed to copy selected text:", e);
      showToast(s.copyFailed);
    } finally {
      setBusyAction(null);
    }
  }, [buildCopyText, busy, closeMenu, menu, s.copied, s.copyFailed, showToast]);

  // Web Share runs only from this press (a user action) and carries the same text as Copy. A
  // dismissed share sheet is not a failure and is not announced as a success either.
  const handleShare = useCallback(async () => {
    if (!menu || busy || !canWebShare()) return;
    setBusyAction("share");
    try {
      const text = menu.copyText ?? await buildCopyText(menu.refs);
      if (!text) throw new Error("Selected text is unavailable");
      await navigator.share({ text });
      closeMenu({ clearSelection: true });
    } catch (e) {
      if (!isAbortError(e)) {
        console.warn("[WebSelectionMenu] Failed to share selected text:", e);
        showToast(s.readerShareFailed);
      }
    } finally {
      setBusyAction(null);
    }
  }, [buildCopyText, busy, closeMenu, menu, s.readerShareFailed, showToast]);

  const handleToggleColorPicker = useCallback(() => {
    if (!menu || busy) return;
    if (!colorPickerOpen) {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        setMenu((current) => (
          current ? { ...current, ...positionForSelection(selection, undefined, MENU_EXPANDED_HEIGHT) } : current
        ));
      }
    }
    setColorPickerOpen((open) => !open);
  }, [busy, colorPickerOpen, menu, positionForSelection]);

  const handleHighlight = useCallback(
    async (color: string) => {
      if (!menu || busy) return;
      setBusyAction("highlight");
      try {
        await addHighlightForRefs(menu.refs, color);
        closeMenu({ clearSelection: true });
        showToast(s.highlightAdded);
      } catch (e) {
        console.warn("[WebSelectionMenu] Failed to highlight selected text:", e);
        showToast(s.highlightActionFailed);
      } finally {
        setBusyAction(null);
      }
    },
    [addHighlightForRefs, busy, closeMenu, menu, s.highlightActionFailed, s.highlightAdded, showToast],
  );

  const handleErase = useCallback(async () => {
    if (!menu || busy) return;
    setBusyAction("erase");
    try {
      await removeHighlightsForRefs(menu.refs);
      closeMenu({ clearSelection: true });
      showToast(s.highlightRemoved);
    } catch (e) {
      console.warn("[WebSelectionMenu] Failed to remove the selected highlight:", e);
      showToast(s.highlightActionFailed);
    } finally {
      setBusyAction(null);
    }
  }, [busy, closeMenu, menu, removeHighlightsForRefs, s.highlightActionFailed, s.highlightRemoved, showToast]);

  if (Platform.OS !== "web" || !menu) return null;

  const foreground = isDark ? "#f5f5f5" : "#2D2D2D";
  const border = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const buttonBackground = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.045)";
  const menuRootProps = { dataSet: { hafizSelectionMenu: "true" } } as any;
  const menuButtonProps = { onMouseDown: (event: any) => event.preventDefault() } as any;
  const selectionHighlighted = highlightIdsForRefs(menu.refs).length > 0;
  const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
  // The measured height keeps the menu inside the viewport when its labels wrap.
  const top = Math.max(VIEWPORT_GUTTER, Math.min(menu.y, window.innerHeight - menuHeight - VIEWPORT_GUTTER));

  const actionButton = (
    key: BusyAction | "highlight-toggle",
    label: string,
    icon: ReactNode,
    onPress: () => void,
    pressedState = false,
  ) => {
    const ownBusy = busyAction === key;
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy: ownBusy, ...(key === "highlight-toggle" ? { expanded: colorPickerOpen } : null) }}
        onPress={onPress}
        disabled={busy}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 44,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: isRTL ? "row-reverse" : "row",
          gap: 6,
          paddingHorizontal: 6,
          opacity: busy && !ownBusy ? 0.45 : pressed ? 0.78 : 1,
          backgroundColor: pressed || pressedState ? buttonBackground : "transparent",
        } as any)}
        {...menuButtonProps}
      >
        {ownBusy ? <ActivityIndicator size={14} color={foreground} /> : icon}
        <MenuLabel color={foreground}>{label}</MenuLabel>
      </Pressable>
    );
  };

  return (
    <View
      {...menuRootProps}
      pointerEvents="box-none"
      style={{
        position: "fixed" as any,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1200,
      }}
    >
      <View
        accessibilityRole="menu"
        onLayout={(event) => {
          const height = Math.round(event.nativeEvent.layout.height);
          if (height > 0) setMenuHeight((current) => (current === height ? current : height));
        }}
        style={{
          position: "fixed" as any,
          left: menu.x,
          top,
          width: menuWidth,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: withThemeOpacity(themeSurface, 0.98),
          padding: 4,
          boxShadow: "0 14px 32px rgba(0, 0, 0, 0.18)",
          userSelect: "none",
        } as any}
      >
        <View
          style={{
            flexDirection: isRTL ? "row-reverse" : "row",
            alignItems: "center",
            gap: 4,
          }}
        >
          {actionButton("copy", s.copy, <Copy size={16} color={foreground} />, handleCopy)}
          {shareSupported
            ? actionButton("share", s.readerShare, <Share2 size={16} color={foreground} />, handleShare)
            : null}
          {actionButton(
            "highlight-toggle",
            s.highlight,
            <Highlighter size={16} color={foreground} />,
            handleToggleColorPicker,
            colorPickerOpen,
          )}
        </View>

        {colorPickerOpen && (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={s.highlight}
            style={{
              flexDirection: isRTL ? "row-reverse" : "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              paddingTop: 4,
            }}
          >
            {HIGHLIGHT_COLORS.map((color) => (
              <Pressable
                key={color}
                accessibilityRole="button"
                accessibilityLabel={s[highlightColorNameKey(color)]}
                onPress={() => handleHighlight(color)}
                disabled={busy}
                style={({ pressed }) => ({
                  width: 36,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: busy ? 0.45 : pressed ? 0.78 : 1,
                } as any)}
                {...menuButtonProps}
              >
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: color,
                    borderWidth: 2,
                    borderColor: withThemeOpacity(themeSurface, 0.98),
                    boxShadow: isDark ? "0 0 0 1px rgba(255,255,255,0.12)" : "0 0 0 1px rgba(0,0,0,0.08)",
                  } as any}
                />
              </Pressable>
            ))}
            {selectionHighlighted ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.readerRemoveHighlight}
                onPress={handleErase}
                disabled={busy}
                style={({ pressed }) => ({
                  width: 36,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: busy && busyAction !== "erase" ? 0.45 : pressed ? 0.78 : 1,
                } as any)}
                {...menuButtonProps}
              >
                {busyAction === "erase" ? (
                  <ActivityIndicator size={14} color={foreground} />
                ) : (
                  <Eraser size={18} color={foreground} />
                )}
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

function MenuLabel({ color, children }: { color: string; children: ReactNode }) {
  return (
    <Text
      numberOfLines={2}
      style={{
        color,
        fontFamily: "Manrope_600SemiBold",
        fontSize: 13,
        lineHeight: 18,
        textAlign: "center",
        flexShrink: 1,
      }}
    >
      {children}
    </Text>
  );
}

function readSelectedQuranTokens(selection: Selection): QuranSelectionWordRef[] {
  const range = selection.getRangeAt(0);
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(TOKEN_SELECTOR));
  const refs = new Map<string, QuranSelectionWordRef>();

  for (const node of nodes) {
    if (node.dataset.hafizQuranHidden === "true") continue;
    try {
      if (!range.intersectsNode(node)) continue;
    } catch {
      continue;
    }

    const surah = Number(node.dataset.hafizSurah);
    const ayah = Number(node.dataset.hafizAyah);
    const wordPos = Number(node.dataset.hafizWordPos);
    if (!Number.isFinite(surah) || !Number.isFinite(ayah) || !Number.isFinite(wordPos)) continue;
    const literalText = node.dataset.hafizLiteralText;
    const isMarker = node.dataset.hafizAyahMarker === "true";
    refs.set(`${surah}:${ayah}:${wordPos}:${literalText ?? ""}:${isMarker}`, {
      surah,
      ayah,
      wordPos,
      literalText,
      isMarker,
    });
  }

  return Array.from(refs.values()).sort(
    (a, b) => a.surah - b.surah || a.ayah - b.ayah || a.wordPos - b.wordPos,
  );
}

function getRefsKey(refs: QuranSelectionWordRef[]): string {
  return refs
    .map((ref) => `${ref.surah}:${ref.ayah}:${ref.wordPos}:${ref.literalText ?? ""}:${ref.isMarker ? 1 : 0}`)
    .join("|");
}
