import { THEME_COLORS, type ThemeMode, type ThemePalette } from "@/lib/settings/context";
import { accentIconColor } from "@/lib/ui/theme-icons";
import type { WidgetColors } from "@/lib/widget/types";

/**
 * Spec 5.1: the widget's five color roles for each app theme, mirroring the Home streak card
 * (bg-surface-low, text-charcoal, text-warm-600 and the teal accent, with their dark variants).
 * The White and Dark values are also the widget's resource colors in values/colors.xml and
 * values-night/colors.xml, used for the System theme; tests/unit/widget-resources.test.ts keeps
 * them equal.
 */
const TEXT: Record<ThemePalette, Pick<WidgetColors, "textPrimary" | "textSecondary" | "accentText">> = {
  white: { textPrimary: "#2D2D2D", textSecondary: "#3F3F46", accentText: "#0F766E" },
  beige: { textPrimary: "#2D2D2D", textSecondary: "#6E5A47", accentText: "#0F766E" },
  dark: { textPrimary: "#F5F5F5", textSecondary: "#A3A3A3", accentText: "#2DD4BF" },
  amoled: { textPrimary: "#F5F5F5", textSecondary: "#A3A3A3", accentText: "#2DD4BF" },
};

function colorsFor(palette: ThemePalette): WidgetColors {
  return {
    surface: THEME_COLORS[palette].surfaceLow.toUpperCase(),
    textPrimary: TEXT[palette].textPrimary,
    textSecondary: TEXT[palette].textSecondary,
    accent: accentIconColor(palette).toUpperCase(),
    accentText: TEXT[palette].accentText,
  };
}

export const WIDGET_PALETTES: Readonly<Record<ThemePalette, WidgetColors>> = {
  white: colorsFor("white"),
  beige: colorsFor("beige"),
  dark: colorsFor("dark"),
  amoled: colorsFor("amoled"),
};

export type WidgetAppearance =
  | Readonly<{ colorMode: "system" }>
  | Readonly<{ colorMode: "fixed"; colors: WidgetColors }>;

/**
 * The app's theme, not the system's. The System theme sends no colors, so the widget follows the
 * launcher's night mode even while Hafiz is closed; a fixed theme sends its resolved colors.
 */
export function widgetAppearance(themeMode: ThemeMode, effectiveTheme: ThemePalette): WidgetAppearance {
  if (themeMode === "system") return { colorMode: "system" };
  return { colorMode: "fixed", colors: WIDGET_PALETTES[effectiveTheme] };
}
