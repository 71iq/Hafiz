import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  isQuranPageFontLoaded,
  loadQuranPageFont,
  quranPageFontName,
  quranPageMarkerFontPaletteStyle,
  quranPageFontPaletteStyle,
} from "@/lib/fonts/loader";
import { useSettings } from "@/lib/settings/context";

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
  const { quranFontStyle, quranMarkerStyle, effectiveTheme } = useSettings();
  const [visible, setVisible] = useState(() => isQuranPageFontLoaded(quranFontStyle, v2Page));

  useEffect(() => {
    setVisible(false);
    if (isQuranPageFontLoaded(quranFontStyle, v2Page)) {
      requestAnimationFrame(() => setVisible(true));
      return;
    }
    let cancelled = false;
    loadQuranPageFont(quranFontStyle, v2Page).then(() => {
      if (!cancelled) requestAnimationFrame(() => setVisible(true));
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [quranFontStyle, v2Page]);

  const tokens = textQcf2.split(" ").filter(Boolean);
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

  return (
    <View
      style={{
        direction: "ltr",
        flexDirection: "row-reverse",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: Math.max(3, fontSize * 0.16),
        rowGap: Math.max(4, fontSize * 0.2),
        opacity: visible ? 1 : 0,
      }}
    >
      {tokens.map((token, index) => {
        const highlighted = index === highlightIndex;
        const isMarker = showAyahMarker && index === tokens.length - 1;
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
