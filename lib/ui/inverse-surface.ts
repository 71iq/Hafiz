/**
 * Colors for small floating labels (word gloss, rail preview, toolbar tooltips) drawn over the
 * reader. Light themes use the deep teal brand surface with white text; Dark and Tahajjud use a pale
 * teal surface with deep teal text, so the label stays distinct from a near-black page. Notices use
 * Toast's own per-theme inverse colors.
 */
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
