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

/** The primary accent as an icon color: teal-600 on light themes, teal-400 on dark themes. */
export function accentIconColor(theme: ThemePalette): string {
  return theme === "dark" || theme === "amoled" ? "#2dd4bf" : "#0d9488";
}

/** The error color for icons and short status text; each reads at 4.5:1 or more on its surface. */
export function errorIconColor(theme: ThemePalette): string {
  return theme === "dark" || theme === "amoled" ? "#f87171" : "#dc2626";
}

/**
 * Warning surface and text for notices such as the offline banner. Each text color reads at 4.5:1
 * or more on its own surface (beige 6.8, white 8.2, dark 11.6, AMOLED 13.7).
 */
export function warningColors(theme: ThemePalette): { surface: string; text: string } {
  switch (theme) {
    case "beige":
      return { surface: "#FBEBC5", text: "#6B4A12" };
    case "white":
      return { surface: "#FEF3C7", text: "#78350F" };
    case "dark":
      return { surface: "#2B2414", text: "#FDDC91" };
    default:
      return { surface: "#1A1509", text: "#FDDC91" };
  }
}
