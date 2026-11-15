import type { FlashListRef } from "@shopify/flash-list";

type ScrollList = Pick<FlashListRef<unknown>, "scrollToIndex" | "computeVisibleIndices"> &
  Partial<Pick<FlashListRef<unknown>, "scrollToOffset" | "getLayout" | "getAbsoluteLastScrollOffset">>;

export type VerseScrollResult = "visible" | "estimated" | "failed" | "cancelled";

const MEASURED_ATTEMPTS = 12;
const ATTEMPT_DELAY_MS = 80;
const ESTIMATE_RETRY_DELAY_MS = 300;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isVisible(list: ScrollList, index: number): boolean {
  const { startIndex, endIndex } = list.computeVisibleIndices();
  return index >= startIndex && index <= endIndex;
}

/**
 * Offset of `index` estimated from measured rows: the nearest measured row before it plus the
 * average measured height for each row in between. Null when nothing has been measured yet.
 */
function estimateOffset(list: ScrollList, index: number): number | null {
  if (!list.getLayout) return null;
  let anchor: { index: number; y: number } | null = null;
  let measured = 0;
  let totalHeight = 0;
  for (let i = index; i >= 0; i -= 1) {
    const layout = list.getLayout(i);
    if (!layout || !(layout.height > 0)) continue;
    if (!anchor) anchor = { index: i, y: layout.y };
    measured += 1;
    totalHeight += layout.height;
    if (measured >= 20) break;
  }
  if (!anchor || measured === 0) return null;
  const average = totalHeight / measured;
  return Math.max(0, anchor.y + (index - anchor.index) * average);
}

/**
 * Scrolls a variable-height list until `index` is measured and visible. When twelve measured
 * attempts fail, it jumps to an estimated offset, waits 300 ms and retries the index once, then
 * confirms the target is actually visible. "failed" means measurement never confirmed it, so the
 * caller can offer an explicit retry.
 */
export async function scrollToVisibleIndex(
  getList: () => ScrollList | null,
  index: number,
  animated: boolean,
  isCurrent: () => boolean,
): Promise<VerseScrollResult> {
  for (let attempt = 0; attempt < MEASURED_ATTEMPTS && isCurrent(); attempt += 1) {
    const list = getList();
    if (list) {
      try {
        await list.scrollToIndex({ index, animated: attempt === 0 && animated, viewPosition: 0.12 });
        if (!isCurrent()) return "cancelled";
        if (isVisible(list, index)) return "visible";
      } catch {
        // The ref can exist before FlashList has measured its initial layout.
      }
    }
    await wait(ATTEMPT_DELAY_MS);
  }
  if (!isCurrent()) return "cancelled";

  const list = getList();
  const estimate = list ? estimateOffset(list, index) : null;
  if (!list || estimate === null || !list.scrollToOffset) return "failed";
  list.scrollToOffset({ offset: estimate, animated: false });
  await wait(ESTIMATE_RETRY_DELAY_MS);
  if (!isCurrent()) return "cancelled";
  try {
    await list.scrollToIndex({ index, animated: false, viewPosition: 0.12 });
    if (!isCurrent()) return "cancelled";
    return isVisible(list, index) ? "estimated" : "failed";
  } catch {
    return "failed";
  }
}
