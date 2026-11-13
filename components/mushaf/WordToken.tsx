import { memo, useCallback, useRef } from "react";
import { Text, Pressable, Platform, View } from "react-native";
import { useSettings } from "@/lib/settings/context";
import { useWordTap } from "./useWordTap";

type Props = {
  glyph: string;
  fontFamily: string;
  fontPalette?: string | null;
  fontSize: number;
  lineHeight: number;
  surah: number;
  ayah: number;
  wordPos: number;
  v2Page: number;
  disabled?: boolean;
  highlightColor?: string;
  hidden?: boolean;
  compactLayout?: boolean;
  /** ERR-06: a short bar under a word missed in 3 or more sessions. Never drawn on a hidden word. */
  weakSpot?: boolean;
};

/** The weak-spot mark, in the reader's amber note color. */
export const WEAK_SPOT_LIGHT = "#d97706";
export const WEAK_SPOT_DARK = "#f59e0b";

// Android clips each Text to its own box, but QCF page words draw outside their advance: over all
// 604 pages, shaped words reach up to 1.77 em past the line-end (left) edge and, rarely, 1.48 em past
// the right edge. On Android the word's Text keeps its box, highlight and taps but draws no ink; a
// non-interactive copy widened by this much on both sides draws the glyph. Its right padding keeps the
// right-aligned glyph exactly where the word box puts it; centering would follow Android's ink
// bounds and shift it (RF189).
const INK_OVERFLOW_EM = 2;

function WordTokenInner({
  glyph,
  fontFamily,
  fontPalette,
  fontSize,
  lineHeight,
  surah,
  ayah,
  wordPos,
  v2Page,
  disabled = false,
  highlightColor,
  hidden = false,
  compactLayout = false,
  weakSpot = false,
}: Props) {
  const { isDark, viewMode, pageScroll } = useSettings();
  const tokenRef = useRef<View>(null);
  const tap = useWordTap({ surah, ayah, wordPos, v2Page, disabled, hidden });
  const { wordRef, isTooltipSelected, isTouchInput, openDetail } = tap;
  const allowNativeTouchSelection =
    Platform.OS === "web" &&
    isTouchInput &&
    viewMode === "page" &&
    pageScroll === "horizontal";

  const pressWord = tap.press;
  const handlePress = useCallback(() => {
    pressWord((done) =>
      tokenRef.current?.measureInWindow((x, y, width, height) => done({ x, y, width, height })),
    );
  }, [pressWord]);
  const handleLongPress = tap.longPress;

  // Web: right-click also opens the detail sheet (matches "long press" intent)
  const webContextMenu =
    Platform.OS === "web" && !disabled && !hidden
      ? {
          onContextMenu: (e: any) => {
            e?.preventDefault?.();
            openDetail(wordRef);
          },
        }
      : {};

  // Highlight background for page view (verse view highlights at container level)
  let bgColor: string | undefined;
  if (highlightColor) {
    bgColor = highlightColor + "20";
  }

  const webSelectionProps =
    Platform.OS === "web"
      ? ({
          dataSet: {
            hafizQuranToken: "word",
            hafizSurah: String(surah),
            hafizAyah: String(ayah),
            hafizWordPos: String(wordPos),
            hafizQuranHidden: hidden ? "true" : "false",
            ...(weakSpot && !hidden ? { hafizWeakSpot: "true" } : null),
          },
        } as any)
      : {};

  const drawsInkLayer = Platform.OS === "android" && !hidden;
  const inkClassName = isTooltipSelected
    ? "text-primary-accent dark:text-primary-bright"
    : "text-charcoal dark:text-neutral-100";

  return (
    <Pressable
      ref={tokenRef as any}
      onPress={handlePress}
      onLongPress={allowNativeTouchSelection ? undefined : handleLongPress}
      delayLongPress={400}
      disabled={disabled || hidden}
      style={{
        paddingHorizontal: compactLayout ? 0 : 1,
        overflow: "visible",
        // The underline marking a hidden word sits on the wrapper, so the word itself can be fully
        // invisible below it.
        ...(hidden && {
          borderBottomWidth: Math.max(2, fontSize * 0.08),
          borderBottomColor: isDark ? "#474747" : "#e8dac5",
          paddingBottom: Math.max(1, fontSize * 0.04),
        }),
        ...(Platform.OS === "web" ? ({ userSelect: hidden ? "none" : "text" } as any) : null),
      }}
      {...webContextMenu}
      {...webSelectionProps}
    >
      <Text
        selectable={Platform.OS === "web" && !hidden}
        className={inkClassName}
        style={{
          fontFamily,
          ...(Platform.OS === "web" && fontPalette ? ({ fontPalette } as any) : null),
          fontSize,
          lineHeight,
          paddingHorizontal: compactLayout ? 0 : 1,
          ...(bgColor && {
            backgroundColor: bgColor,
            borderRadius: 6,
          }),
          ...(isTooltipSelected && !bgColor && {
            backgroundColor: "rgba(13, 148, 136, 0.08)",
            borderRadius: 6,
          }),
          // Page fonts are colour fonts whose palette layers ignore the text colour, so a transparent
          // colour still drew hidden words faintly. Opacity hides every layer.
          ...(hidden && { color: "transparent", opacity: 0 }),
          ...(Platform.OS === "web" ? ({ userSelect: hidden ? "none" : "text" } as any) : null),
          ...(drawsInkLayer && { color: "transparent" }),
        }}
      >
        {glyph}
      </Text>
      {drawsInkLayer && (
        // A View, because Android ignores pointerEvents on Text and the wide layer would take
        // neighboring words' taps.
        <View
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: -fontSize * INK_OVERFLOW_EM,
            right: -fontSize * INK_OVERFLOW_EM,
          }}
        >
          <Text
            className={inkClassName}
            style={{
              fontFamily,
              fontSize,
              lineHeight,
              // The layer is placed from the Pressable's edge; add its and the word Text's padding.
              paddingRight: fontSize * INK_OVERFLOW_EM + (compactLayout ? 0 : 2),
              textAlign: "right",
            }}
          >
            {glyph}
          </Text>
        </View>
      )}
      {weakSpot && !hidden ? (
        // A short rounded bar, half the word's width: a dot under a Quran word could read as part of
        // the script. A full-width row centers it without physical left/right offsets.
        <View
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={{ position: "absolute", bottom: 1, width: "100%", alignItems: "center" }}
        >
          <View style={{ width: "50%", height: 2, borderRadius: 1, backgroundColor: isDark ? WEAK_SPOT_DARK : WEAK_SPOT_LIGHT }} />
        </View>
      ) : null}
    </Pressable>
  );
}

export const WordToken = memo(WordTokenInner);
