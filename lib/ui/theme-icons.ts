import type { ThemePalette } from "@/lib/settings/context";

/**
 * A secondary icon color that matches the active theme's text tokens (warm-600 in the theme CSS
 * variables): warm brown on beige, zinc on white, light gray in the dark themes. Icons take a color
 * value rather than a class, so they need this instead of a hard-coded hex.
 */
export function mutedIconColor(theme: ThemePalette): string {
  switch (theme) {
    case "beige":
      return "#6e5a47";
    case "white":
      return "#52525b";
    default:
      return "#a3a3a3";
  }
}
