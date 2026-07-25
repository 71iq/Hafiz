import { View } from "react-native";
import { THEME_COLORS, type ThemeMode, type ThemePalette } from "@/lib/settings/context";

type Props = {
  theme: ThemeMode;
  selected?: boolean;
  size?: number;
};

const PALETTE_SEGMENTS: Record<ThemePalette, string[]> = {
  white: [THEME_COLORS.white.surface, THEME_COLORS.white.surfaceMid, THEME_COLORS.white.surfaceHigh],
  beige: [THEME_COLORS.beige.surface, THEME_COLORS.beige.surfaceMid, THEME_COLORS.beige.surfaceHigh],
  dark: [THEME_COLORS.dark.surface, THEME_COLORS.dark.surfaceMid, THEME_COLORS.dark.surfaceBright],
  amoled: [THEME_COLORS.amoled.surface, THEME_COLORS.amoled.surfaceMid, THEME_COLORS.amoled.surfaceBright],
};

const SYSTEM_SEGMENTS = [
  THEME_COLORS.white.surface,
  THEME_COLORS.white.surfaceHigh,
  THEME_COLORS.dark.surfaceBright,
  THEME_COLORS.dark.surface,
];

export function ThemeColorSwatch({ theme, selected = false, size = 36 }: Props) {
  const segments = theme === "system" ? SYSTEM_SEGMENTS : PALETTE_SEGMENTS[theme];

  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: selected ? 3 : 1,
        borderColor: selected ? "#0D9488" : "rgba(127,127,127,0.55)",
        overflow: "hidden",
        flexDirection: "row",
        pointerEvents: "none",
      }}
    >
      {segments.map((backgroundColor, index) => (
        <View key={`${backgroundColor}-${index}`} style={{ flex: 1, backgroundColor }} />
      ))}
    </View>
  );
}
