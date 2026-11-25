import { Fragment } from "react";
import { Platform, Text, View } from "react-native";
import {
  quranPageFontName,
  quranPageMarkerFontPaletteStyle,
  quranPageFontPaletteStyle,
} from "@/lib/fonts/loader";
import { useSettings } from "@/lib/settings/context";
import { useQuranPageFontReady } from "@/lib/fonts/use-quran-page-font";
import { ayahGlyphs, glyphsOfMushafWord, uthmaniWordCount, type GlyphRange } from "@/lib/mushaf/glyph-words";

type Props = {
  textQcf2: string;
  textUthmani: string;
  v2Page: number;
  fontSize: number;
  lineHeight: number;
  colorClassName?: string;
  /**
   * A word to highlight, by its position in the word tables (meaning card ids). With `surah` and
   * `ayah` it maps to its glyphs past any hizb or pause mark (lib/mushaf/glyph-words); without them
   * position n is glyph n - 1.
   */
  highlightWordPos?: number;
  hasAyahMarker?: boolean;
  surah?: number;
  ayah?: number;
};

/** The glyph indexes a highlighted word covers, inclusive, or null for none. */
function highlightedGlyphs(
  textQcf2: string,
  textUthmani: string,
  position: number | undefined,
  surah: number | undefined,
  ayah: number | undefined,
): GlyphRange | null {
  if (typeof position !== "number") return null;
  const layout =
    typeof surah === "number" && typeof ayah === "number" && textUthmani
      ? ayahGlyphs(surah, ayah, textQcf2, uthmaniWordCount(textUthmani))
      : null;
  if (layout) return glyphsOfMushafWord(layout, position);
  return { from: position - 1, to: position - 1 };
}

export function Qcf2AyahText({
  textQcf2,
  textUthmani,
  v2Page,
  fontSize,
  lineHeight,
  colorClassName = "text-charcoal dark:text-neutral-100",
  highlightWordPos,
  hasAyahMarker = true,
  surah,
  ayah,
}: Props) {
  const { quranRenderFontStyle: quranFontStyle, showAyahMarkers, quranMarkerStyle, effectiveTheme } = useSettings();
  const visible = useQuranPageFontReady(quranFontStyle, v2Page);

  // Glyphs mounted before their page font exists render and measure in the system font.
  if (!visible) return <View style={{ minHeight: lineHeight }} />;

  const allTokens = textQcf2.split(/\s+/).filter(Boolean);
  const showMarker = hasAyahMarker && showAyahMarkers;
  const tokens = hasAyahMarker && !showMarker ? allTokens.slice(0, -1) : allTokens;
  if (tokens.length === 0) return null;
  const highlight = highlightedGlyphs(textQcf2, textUthmani, highlightWordPos, surah, ayah);
  const isHighlighted = (index: number) => highlight !== null && index >= highlight.from && index <= highlight.to;
  const fontFamily = quranPageFontName(quranFontStyle, v2Page);
  const fontPaletteStyle = quranPageFontPaletteStyle(quranFontStyle, v2Page, effectiveTheme);
  const markerFontPaletteStyle = quranPageMarkerFontPaletteStyle(
    quranFontStyle,
    v2Page,
    effectiveTheme,
    quranMarkerStyle,
  );
  const nativeAccessibility = textUthmani
    ? { accessible: true, accessibilityLabel: textUthmani, accessibilityLanguage: "ar" }
    : { accessible: false, "aria-hidden": true as const };

  if (Platform.OS === "android") {
    // Android clips each separate Text to its own advance box, and page-font word glyphs draw outside
    // it, so per-word Text views showed cut fragments of the words. One Text with nested spans draws
    // every word fully, like the reader's verse view.
    return (
      <Text
        {...nativeAccessibility}
        className={colorClassName}
        style={{ fontFamily, ...fontPaletteStyle, fontSize, lineHeight, textAlign: "center", alignSelf: "stretch" }}
      >
        {tokens.map((token, index) => {
          const highlighted = isHighlighted(index);
          const isMarker = showMarker && index === tokens.length - 1;
          return (
            <Fragment key={`${token}-${index}`}>
              <Text
                className={highlighted ? "text-primary-accent dark:text-primary-bright" : undefined}
                style={{
                  ...(isMarker ? markerFontPaletteStyle : null),
                  backgroundColor: highlighted ? "rgba(13, 148, 136, 0.13)" : undefined,
                }}
              >
                {token}
              </Text>
              {index < tokens.length - 1 ? " " : null}
            </Fragment>
          );
        })}
      </Text>
    );
  }

  return (
    <View
      {...(Platform.OS === "web" ? undefined : nativeAccessibility)}
      style={{
        direction: "ltr",
        flexDirection: "row-reverse",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: Math.max(3, fontSize * 0.16),
        rowGap: Math.max(4, fontSize * 0.2),
      }}
    >
      {Platform.OS === "web" && textUthmani ? (
        <span
          lang="ar"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            clipPath: "inset(50%)",
            overflow: "hidden",
            userSelect: "none",
          }}
        >
          {textUthmani}
        </span>
      ) : null}
      {tokens.map((token, index) => {
        const highlighted = isHighlighted(index);
        const isMarker = showMarker && index === tokens.length - 1;
        return (
          <Text
            key={`${token}-${index}`}
            aria-hidden
            className={highlighted ? "text-primary-accent dark:text-primary-bright" : colorClassName}
            style={{
              fontFamily,
              ...(isMarker ? markerFontPaletteStyle : fontPaletteStyle),
              fontSize,
              lineHeight,
              paddingHorizontal: highlighted ? 7 : 1,
              writingDirection: isMarker ? "rtl" : undefined,
              borderRadius: highlighted ? 10 : 0,
              backgroundColor: highlighted ? "rgba(13, 148, 136, 0.13)" : "transparent",
            }}
          >
            {token}
          </Text>
        );
      })}
    </View>
  );
}
