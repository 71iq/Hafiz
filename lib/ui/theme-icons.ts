import type { ThemePalette } from "@/lib/settings/context";

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

export function accentIconColor(theme: ThemePalette): string {
  return theme === "dark" || theme === "amoled" ? "#2dd4bf" : "#0d9488";
}

export function errorIconColor(theme: ThemePalette): string {
  return theme === "dark" || theme === "amoled" ? "#f87171" : "#dc2626";
}

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
