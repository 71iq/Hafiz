export type SelectionAnchor = {
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
] as const;
