/**
 * Reader toolbar sizing. Below 768px the toolbar is six 44px targets (mode switch, Search,
 * Hide/Show, Recitation, Reading settings, More) with 4px gaps and 16px gutters: 316px, so it fits a
 * 320px phone. Narrower than that, the row wraps; targets never shrink and type never scales down.
 */
export const TOOLBAR_TARGET = 44;
export const TOOLBAR_GAP = 4;
export const TOOLBAR_GUTTER = 16;
/** Estimated room for the short current-mode label beside the wide mode switch icon. */
export const TOOLBAR_MODE_LABEL_WIDTH = 84;

/** Width a single row of `count` targets needs, gutters included. */
export function toolbarRowWidth(count: number): number {
  if (count <= 0) return TOOLBAR_GUTTER * 2;
  return TOOLBAR_GUTTER * 2 + count * TOOLBAR_TARGET + (count - 1) * TOOLBAR_GAP;
}

/** The six-target phone row: 316px. */
export const PHONE_TOOLBAR_WIDTH = toolbarRowWidth(6);

export type WideToolbarContent = {
  /** Icon actions after the mode switch, More included. */
  actionCount: number;
  /** Page mode adds the separate 44px direction chevron. */
  showsDirectionChevron: boolean;
};

/** Width of the full wide toolbar: labeled mode switch, optional chevron, then the icon actions. */
export function wideToolbarWidth({ actionCount, showsDirectionChevron }: WideToolbarContent): number {
  const targets = actionCount + (showsDirectionChevron ? 1 : 0) + 1;
  return toolbarRowWidth(targets) + TOOLBAR_MODE_LABEL_WIDTH;
}

/**
 * At 768px and above the full toolbar (labels, its own actions and a direction chevron) shows only
 * while it fits; otherwise the reader uses the same six-target row and shared More menu as phones.
 */
export function usesWideToolbar(viewportWidth: number, availableWidth: number, content: WideToolbarContent): boolean {
  if (viewportWidth < 768) return false;
  return availableWidth >= wideToolbarWidth(content);
}
