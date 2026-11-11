import { Text, View } from "react-native";
import { THEME_COLORS, type ThemeMode, type ThemePalette } from "@/lib/settings/context";

type Props = {
  theme: ThemeMode;
  selected?: boolean;
  size?: number;
  systemTheme?: "dark" | "white";
  /** Visible name under the swatch; without it the five swatches (one half black) were guesswork. */
  label?: string;
};

export function ThemeColorSwatch({ theme, selected = false, size = 36, systemTheme = "white", label }: Props) {
  if (label) {
    return (
      <View style={{ width: "100%", alignItems: "center", gap: 4, pointerEvents: "none" }}>
        <ThemeColorSwatch theme={theme} selected={selected} size={size} systemTheme={systemTheme} />
        <Text
          accessible={false}
          numberOfLines={1}
          className={selected ? "text-primary-accent dark:text-primary-bright" : "text-warm-500 dark:text-neutral-400"}
          style={{ fontFamily: selected ? "Manrope_700Bold" : "Manrope_500Medium", fontSize: 11 }}
        >
          {label}
        </Text>
      </View>
    );
  }

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
