import { memo, useCallback, useRef } from "react";
import { Text, Pressable, Platform, View } from "react-native";
import { useSettings, type ThemePalette } from "@/lib/settings/context";
import { useWordTap } from "./useWordTap";

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
  arrivalWash?: string;
  hidden?: boolean;
  compactLayout?: boolean;
  weakSpot?: boolean;
};

export const WEAK_SPOT_LIGHT = "#d97706";
export const WEAK_SPOT_DARK = "#f59e0b";

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
  arrivalWash,
  hidden = false,
  compactLayout = false,
  weakSpot = false,
}: Props) {
  const { isDark, viewMode, pageScroll, effectiveTheme } = useSettings();
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

  const webContextMenu =
    Platform.OS === "web" && !disabled && !hidden
      ? {
          onContextMenu: (e: any) => {
            e?.preventDefault?.();
            openDetail(wordRef);
          },
        }
      : {};

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
          ...(hidden && { color: "transparent", opacity: 0 }),
          ...(Platform.OS === "web" ? ({ userSelect: hidden ? "none" : "text" } as any) : null),
          ...(drawsInkLayer && { color: "transparent" }),
        }}
      >
        {glyph}
      </Text>
      {drawsInkLayer && (
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
              paddingRight: fontSize * INK_OVERFLOW_EM + (compactLayout ? 0 : 2),
              textAlign: "right",
            }}
          >
            {glyph}
          </Text>
        </View>
      )}
      {weakSpot && !hidden ? (
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
