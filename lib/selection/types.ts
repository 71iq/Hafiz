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
  "#FBBF24",
  "#34D399",
  "#60A5FA",
  "#F472B6",
  "#A78BFA",
  "#FB7185",
  "#38BDF8",
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

export function highlightColorNameKey(color: HighlightColor): HighlightColorNameKey {
  return HIGHLIGHT_COLOR_NAME_KEYS[color];
}
