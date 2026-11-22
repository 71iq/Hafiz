import { memo, useCallback, useRef } from "react";
import { Text, Pressable, Platform, PixelRatio, View } from "react-native";
import { formatAyahRef } from "@/lib/arabic";
import { useSettings, type ThemePalette } from "@/lib/settings/context";
import { useWordTap } from "./useWordTap";

/** The line standing in for a hidden word: at least 3:1 against each theme's page. */
const HIDDEN_WORD_UNDERLINE: Record<ThemePalette, string> = {
  beige: "#9A8470",
  white: "#8A8F98",
  dark: "#6B6B6B",
  amoled: "#5E5E5E",
};

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
  /** C07 arrival wash color behind a navigated-to word; it never recolors the glyph. */
  arrivalWash?: string;
  hidden?: boolean;
  compactLayout?: boolean;
  /** ERR-06: a short bar under a word missed in 3 or more sessions. Never drawn on a hidden word. */
  weakSpot?: boolean;
};

/** The weak-spot mark, in the reader's amber note color. */
export const WEAK_SPOT_LIGHT = "#d97706";
export const WEAK_SPOT_DARK = "#f59e0b";

// Shaped word bounds across the 604 Classic and Modern page fonts extend up to 1.77 em
// left of the advance and 4.99 em right of it. The advance still owns spacing and taps.
const LEFT_INK_EM = 2;
const RIGHT_INK_EM = 5;

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
  arrivalWash,
  hidden = false,
  compactLayout = false,
  weakSpot = false,
}: Props) {
  const { isDark, isRTL, viewMode, pageScroll, effectiveTheme } = useSettings();
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
  let bgColor: string | undefined = arrivalWash;
  if (!bgColor && highlightColor) {
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
  const wordBackgroundColor = bgColor ?? (isTooltipSelected ? "rgba(13, 148, 136, 0.08)" : undefined);
  const wordPadding = compactLayout ? 0 : 1;
  // Round up to a physical pixel as Android does when it resolves a Text font size.
  const pixelRatio = PixelRatio.get();
  const em = Math.ceil(fontSize * PixelRatio.getFontScale() * pixelRatio) / pixelRatio;
  const rightGutter = RIGHT_INK_EM * em + 1;
  const inkClassName = isTooltipSelected
    ? "text-primary-accent dark:text-primary-bright"
    : "text-charcoal dark:text-neutral-100";

  return (
    <Pressable
      ref={tokenRef as any}
      accessible={!hidden}
      aria-hidden={hidden || undefined}
      accessibilityRole="button"
      accessibilityLabel={hidden ? undefined : formatAyahRef(isRTL, surah, ayah, wordPos)}
      onAccessibilityTap={handleLongPress}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "activate") handleLongPress();
      }}
      onPress={handlePress}
      onLongPress={allowNativeTouchSelection ? undefined : handleLongPress}
      delayLongPress={400}
      disabled={disabled || hidden}
      style={{
        paddingHorizontal: wordPadding,
        overflow: "visible",
        // The underline marking a hidden word sits on the wrapper, so the word itself can be fully
        // invisible below it.
        ...(hidden && {
          borderBottomWidth: Math.max(2, fontSize * 0.08),
          borderBottomColor: HIDDEN_WORD_UNDERLINE[effectiveTheme],
          paddingBottom: Math.max(1, fontSize * 0.04),
        }),
        ...(Platform.OS === "web" ? ({ userSelect: hidden ? "none" : "text" } as any) : null),
      }}
      {...webContextMenu}
      {...webSelectionProps}
    >
      {drawsInkLayer && wordBackgroundColor && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            start: wordPadding,
            end: wordPadding,
            backgroundColor: wordBackgroundColor,
            borderRadius: 6,
          }}
        />
      )}
      <Text
        aria-hidden
        selectable={Platform.OS === "web" && !hidden}
        className={inkClassName}
        style={{
          fontFamily,
          ...(Platform.OS === "web" && fontPalette ? ({ fontPalette } as any) : null),
          fontSize,
          lineHeight,
          paddingHorizontal: wordPadding,
          ...(!drawsInkLayer && wordBackgroundColor && {
            backgroundColor: wordBackgroundColor,
            borderRadius: 6,
          }),
          // Android Fabric treats transparent black as an unset text colour, and palette colours
          // can ignore the text colour altogether. View opacity hides both kinds of font ink.
          ...((hidden || drawsInkLayer) && { opacity: 0 }),
          ...(Platform.OS === "web" ? ({ userSelect: hidden ? "none" : "text" } as any) : null),
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
            left: -(LEFT_INK_EM * em + 1),
            right: -rightGutter,
          }}
        >
          <Text
            className={inkClassName}
            style={{
              fontFamily,
              fontSize,
              lineHeight,
              textAlign: "right",
            }}
          >
            {/* Android clips TextView at its padding. Reserve the right inset inside the
                RTL line instead, so the glyph can paint across it at its original position. */}
            {"\u200f"}<View style={{ width: rightGutter + 2 * wordPadding, height: 0 }} />{glyph}
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
