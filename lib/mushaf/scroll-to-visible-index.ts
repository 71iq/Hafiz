import type { FlashListRef } from "@shopify/flash-list";

type ScrollList = Pick<FlashListRef<unknown>, "scrollToIndex" | "computeVisibleIndices">;

export async function scrollToVisibleIndex(
  getList: () => ScrollList | null,
  index: number,
  animated: boolean,
  isCurrent: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 12 && isCurrent(); attempt += 1) {
    const list = getList();
    if (list) {
      try {
        await list.scrollToIndex({ index, animated: attempt === 0 && animated, viewPosition: 0.12 });
        if (!isCurrent()) return;
        const { startIndex, endIndex } = list.computeVisibleIndices();
        if (index >= startIndex && index <= endIndex) return;
      } catch {
        // The ref can exist before FlashList has measured its initial layout.
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
  }
}
