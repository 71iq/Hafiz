import { Fragment } from "react";
import { Platform, Text, View } from "react-native";
import {
  quranPageFontName,
  quranPageMarkerFontPaletteStyle,
  quranPageFontPaletteStyle,
} from "@/lib/fonts/loader";
import { useSettings } from "@/lib/settings/context";
import { useQuranPageFontReady } from "@/lib/fonts/use-quran-page-font";

type Props = {
  textQcf2: string;
  v2Page: number;
  fontSize: number;
  lineHeight: number;
  colorClassName?: string;
  highlightWordPos?: number;
  showAyahMarker?: boolean;
  ayah?: number;
};

export function Qcf2AyahText({
  textQcf2,
  v2Page,
  fontSize,
  lineHeight,
  colorClassName = "text-charcoal dark:text-neutral-100",
  highlightWordPos,
  showAyahMarker = true,
}: Props) {
  const { quranFontStyle, showAyahMarkers, quranMarkerStyle, effectiveTheme } = useSettings();
  const visible = useQuranPageFontReady(quranFontStyle, v2Page);

  // Glyphs mounted before their page font exists render and measure in the system font.
  if (!visible) return <View style={{ minHeight: lineHeight }} />;

  const allTokens = textQcf2.split(" ").filter(Boolean);
  const tokens = showAyahMarker && showAyahMarkers ? allTokens : allTokens.slice(0, -1);
  if (tokens.length === 0) return null;
  const highlightIndex = typeof highlightWordPos === "number" ? highlightWordPos - 1 : -1;
  const fontFamily = quranPageFontName(quranFontStyle, v2Page);
  const fontPaletteStyle = quranPageFontPaletteStyle(quranFontStyle, v2Page, effectiveTheme);
  const markerFontPaletteStyle = quranPageMarkerFontPaletteStyle(
    quranFontStyle,
    v2Page,
    effectiveTheme,
    quranMarkerStyle,
  );

  if (Platform.OS === "android") {
    // Android clips each separate Text to its own advance box, and page-font word glyphs draw outside
    // it, so per-word Text views showed cut fragments of the words. One Text with nested spans draws
    // every word fully, like the reader's verse view.
    return (
      <Text
        className={colorClassName}
        style={{ fontFamily, ...fontPaletteStyle, fontSize, lineHeight, textAlign: "center", alignSelf: "stretch" }}
      >
        {tokens.map((token, index) => {
          const highlighted = index === highlightIndex;
          const isMarker = showAyahMarker && showAyahMarkers && index === tokens.length - 1;
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
      style={{
        direction: "ltr",
        flexDirection: "row-reverse",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: Math.max(3, fontSize * 0.16),
        rowGap: Math.max(4, fontSize * 0.2),
      }}
    >
      {tokens.map((token, index) => {
        const highlighted = index === highlightIndex;
        const isMarker = showAyahMarker && showAyahMarkers && index === tokens.length - 1;
        return (
          <Text
            key={`${token}-${index}`}
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
