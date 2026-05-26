import { useEffect, useState } from "react";
import { Text, type StyleProp, type TextProps, type TextStyle } from "react-native";
import {
  isQuranCommonFontLoaded,
  juzNameGlyph,
  juzNumberGlyph,
  loadQuranCommonFont,
  quranCommonFontName,
} from "@/lib/fonts/loader";

type Props = Omit<TextProps, "children"> & {
  enabled?: boolean;
  fallback: string;
  glyphStyle?: StyleProp<TextStyle>;
  juz: number | null;
  variant?: "name" | "number";
};

export function JuzNameText({
  accessibilityLabel,
  enabled = true,
  fallback,
  glyphStyle,
  juz,
  style,
  variant = "number",
  ...props
}: Props) {
  const [fontReady, setFontReady] = useState(() => isQuranCommonFontLoaded());
  const glyph =
    typeof juz === "number"
      ? variant === "name"
        ? juzNameGlyph(juz)
        : juzNumberGlyph(juz)
      : undefined;
  const useGlyph = Boolean(enabled && glyph && fontReady);

  useEffect(() => {
    if (!enabled) return;
    if (!glyph) return;
    if (isQuranCommonFontLoaded()) {
      setFontReady(true);
      return;
    }
    let cancelled = false;
    loadQuranCommonFont()
      .then(() => {
        if (!cancelled) requestAnimationFrame(() => setFontReady(true));
      })
      .catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [enabled, glyph]);

  return (
    <Text
      {...props}
      accessibilityLabel={accessibilityLabel ?? fallback}
      style={[
        style,
        useGlyph
          ? [
              {
                fontFamily: quranCommonFontName(),
                writingDirection: "ltr",
              },
              glyphStyle,
            ]
          : null,
      ]}
    >
      {useGlyph ? glyph : fallback}
    </Text>
  );
}
