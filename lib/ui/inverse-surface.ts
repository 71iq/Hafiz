export type InverseSurfaceColors = {
  background: string;
  text: string;
  muted: string;
};

const LIGHT_THEME_INVERSE: InverseSurfaceColors = {
  background: "#003638",
  text: "#FFFFFF",
  muted: "rgba(255,255,255,0.72)",
};

const DARK_THEME_INVERSE: InverseSurfaceColors = {
  background: "#CCFBF1",
  text: "#003638",
  muted: "rgba(0,54,56,0.72)",
};

export function inverseSurfaceColors(isDark: boolean): InverseSurfaceColors {
  return isDark ? DARK_THEME_INVERSE : LIGHT_THEME_INVERSE;
}
