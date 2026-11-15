type SelectionAnchor = {
  surah: number;
  ayah: number;
};

export type Selection = {
  start: SelectionAnchor;
  end: SelectionAnchor;
};

export type HighlightEntry = {
  id: number;
  surah: number;
  ayah: number;
  wordStart: number | null;
  wordEnd: number | null;
  color: string;
};

export type BookmarkEntry = {
  surah: number;
  ayah: number;
  createdAt: string;
};

export const HIGHLIGHT_COLORS = [
  "#FBBF24", // Amber
  "#34D399", // Green
  "#60A5FA", // Blue
  "#F472B6", // Pink
  "#A78BFA", // Violet
  "#FB7185", // Rose
  "#38BDF8", // Sky
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

const HIGHLIGHT_COLOR_NAME_KEYS = {
  "#FBBF24": "highlightColorAmber",
  "#34D399": "highlightColorGreen",
  "#60A5FA": "highlightColorBlue",
  "#F472B6": "highlightColorPink",
  "#A78BFA": "highlightColorViolet",
  "#FB7185": "highlightColorRose",
  "#38BDF8": "highlightColorSky",
} as const satisfies Record<HighlightColor, string>;

export type HighlightColorNameKey = (typeof HIGHLIGHT_COLOR_NAME_KEYS)[HighlightColor];

/** The localized name key for a palette color (both ayah actions and the web selection menu use it). */
export function highlightColorNameKey(color: HighlightColor): HighlightColorNameKey {
  return HIGHLIGHT_COLOR_NAME_KEYS[color];
}
