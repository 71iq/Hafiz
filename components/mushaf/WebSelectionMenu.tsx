import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Copy } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { useSelection } from "@/lib/selection/context";
import {
  fetchUthmaniWordsForSelection,
  type QuranSelectionWordRef,
  type UthmaniSelectionText,
} from "@/lib/selection/queries";

type MenuState = {
  x: number;
  y: number;
  refs: QuranSelectionWordRef[];
  refsKey: string;
  copyText: string | null;
};

const TOKEN_SELECTOR = "[data-hafiz-quran-token]";
const MENU_WIDTH = 118;
const MENU_HEIGHT = 44;
const VIEWPORT_GUTTER = 8;
const SELECTION_STYLE_ID = "hafiz-quran-selection-style";

export function WebSelectionMenu() {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const { showToast } = useSelection();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const latestMenuRef = useRef<MenuState | null>(null);

  useEffect(() => {
    latestMenuRef.current = menu;
  }, [menu]);

  const buildCopyText = useCallback(
    async (refs: QuranSelectionWordRef[]) => {
      const selectionText = await fetchUthmaniWordsForSelection(db, refs);
      return selectionText ? formatSelectionForCopy(selectionText) : null;
    },
    [db],
  );

  const copyRefsToClipboard = useCallback(
    async (refs: QuranSelectionWordRef[]) => {
      const copyText = await buildCopyText(refs);
      if (!copyText) return false;
      await Clipboard.setStringAsync(copyText);
      window.getSelection()?.removeAllRanges();
      setMenu(null);
      showToast(s.copied);
      return true;
    },
    [buildCopyText, s.copied, showToast],
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

  const positionForSelection = useCallback((selection: Selection, fallback?: { x: number; y: number }) => {
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();
    const rawX = rect && rect.width > 0 ? rect.left + rect.width / 2 : fallback?.x ?? 0;
    const rawY = rect && rect.height > 0 ? rect.top - MENU_HEIGHT - 8 : (fallback?.y ?? 0) - MENU_HEIGHT - 8;
    const belowY = rect && rect.height > 0 ? rect.bottom + 8 : (fallback?.y ?? 0) + 8;
    const maxX = Math.max(VIEWPORT_GUTTER, window.innerWidth - MENU_WIDTH - VIEWPORT_GUTTER);
    const maxY = Math.max(VIEWPORT_GUTTER, window.innerHeight - MENU_HEIGHT - VIEWPORT_GUTTER);
    const x = Math.min(Math.max(rawX - MENU_WIDTH / 2, VIEWPORT_GUTTER), maxX);
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

    const handleMouseUp = (event: MouseEvent) => {
      window.setTimeout(() => {
        showForCurrentSelection({ x: event.clientX, y: event.clientY });
      }, 0);
    };

    const handleKeyUp = () => {
      window.setTimeout(() => {
        showForCurrentSelection();
      }, 0);
    };

    const handleScroll = () => setMenu(null);

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-hafiz-selection-menu]")) return;
      if (latestMenuRef.current) setMenu(null);
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
          window.getSelection()?.removeAllRanges();
          setMenu(null);
          showToast(s.copied);
        }, 0);
        return;
      }

      void copyRefsToClipboard(refs);
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keyup", handleKeyUp);
    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("copy", handleCopyEvent);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("copy", handleCopyEvent);
    };
  }, [copyRefsToClipboard, s.copied, showForCurrentSelection, showToast]);

  const handleCopy = useCallback(async () => {
    if (!menu) return;
    try {
      const copyText = menu.copyText ?? await buildCopyText(menu.refs);
      if (!copyText) return;
      await Clipboard.setStringAsync(copyText);
      window.getSelection()?.removeAllRanges();
      setMenu(null);
      showToast(s.copied);
    } catch (e) {
      console.warn("[WebSelectionMenu] Failed to copy selected text:", e);
    }
  }, [buildCopyText, menu, s.copied, showToast]);

  if (Platform.OS !== "web" || !menu) return null;

  const foreground = isDark ? "#f5f5f5" : "#2D2D2D";
  const border = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const menuRootProps = { dataSet: { hafizSelectionMenu: "true" } } as any;
  const menuButtonProps = { onMouseDown: (event: any) => event.preventDefault() } as any;

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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={s.copy}
        onPress={handleCopy}
        style={({ pressed }) => ({
          position: "fixed" as any,
          left: menu.x,
          top: menu.y,
          width: MENU_WIDTH,
          height: MENU_HEIGHT,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: isDark ? "rgba(38,38,38,0.98)" : "rgba(255,248,241,0.98)",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: isRTL ? "row-reverse" : "row",
          gap: 8,
          opacity: pressed ? 0.78 : 1,
          boxShadow: "0 14px 32px rgba(0, 0, 0, 0.18)",
          userSelect: "none",
        } as any)}
        {...menuButtonProps}
      >
        <Copy size={16} color={foreground} />
        <Text
          style={{
            color: foreground,
            fontFamily: "Manrope_600SemiBold",
            fontSize: 13,
            lineHeight: 18,
          }}
        >
          {s.copy}
        </Text>
      </Pressable>
    </View>
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

function formatSelectionForCopy(selection: UthmaniSelectionText): string {
  const refs = selection.ranges.map((range) => {
    const ref =
      range.ayahStart === range.ayahEnd
        ? `${range.surahName} : ${range.ayahStart}`
        : `${range.surahName} : ${range.ayahStart}-${range.ayahEnd}`;
    return `[${ref}]`;
  });

  return `"${selection.text.trim()}"\n${refs.join(" ")}\nhttps://hafizquran.app/open?surah=${selection.firstSurah}&ayah=${selection.firstAyah}`;
}
