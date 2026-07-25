import { Text, View } from "react-native";
import { THEME_COLORS, type ThemeMode, type ThemePalette } from "@/lib/settings/context";

type Props = {
  theme: ThemeMode;
  selected?: boolean;
  size?: number;
  systemTheme?: "dark" | "white";
};

export function ThemeColorSwatch({ theme, selected = false, size = 36, systemTheme = "white" }: Props) {
  const palette: ThemePalette = theme === "system" ? systemTheme : theme;
  const backgroundColor = THEME_COLORS[palette].surface;
  const accentColor = palette === "dark" || palette === "amoled" ? "#2DD4BF" : "#0D9488";

  return (
    <View
      accessible={false}
      style={{
        width: "100%",
        height: size,
        borderRadius: 6,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? accentColor : "rgba(127,127,127,0.45)",
        backgroundColor: theme === "system" ? undefined : backgroundColor,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {theme === "system" && (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <View style={{ flex: 1, backgroundColor: THEME_COLORS.white.surface }} />
          <View style={{ flex: 1, backgroundColor: THEME_COLORS.dark.surface }} />
        </View>
      )}
      {selected && (
        <Text
          accessible={false}
          style={{
            position: "absolute",
            top: 1,
            right: 5,
            color: accentColor,
            fontSize: 13,
            lineHeight: 16,
            fontFamily: "Manrope_700Bold",
          }}
        >
          ✓
        </Text>
      )}
    </View>
  );
}
