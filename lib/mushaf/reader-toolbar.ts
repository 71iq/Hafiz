export const TOOLBAR_TARGET = 44;
export const TOOLBAR_GAP = 4;
export const TOOLBAR_GUTTER = 16;
export const TOOLBAR_MODE_LABEL_WIDTH = 84;

export function toolbarRowWidth(count: number): number {
  if (count <= 0) return TOOLBAR_GUTTER * 2;
  return TOOLBAR_GUTTER * 2 + count * TOOLBAR_TARGET + (count - 1) * TOOLBAR_GAP;
}

export const PHONE_TOOLBAR_WIDTH = toolbarRowWidth(6);

export type WideToolbarContent = {
  actionCount: number;
  showsDirectionChevron: boolean;
};

export function wideToolbarWidth({ actionCount, showsDirectionChevron }: WideToolbarContent): number {
  const targets = actionCount + (showsDirectionChevron ? 1 : 0) + 1;
  return toolbarRowWidth(targets) + TOOLBAR_MODE_LABEL_WIDTH;
}

export function usesWideToolbar(viewportWidth: number, availableWidth: number, content: WideToolbarContent): boolean {
  if (viewportWidth < 768) return false;
  return availableWidth >= wideToolbarWidth(content);
}
