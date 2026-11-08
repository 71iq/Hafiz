export function shouldJustifyMushafLine(
  pageNumber: number,
  lineNumber: number,
  centered: boolean,
  wordCount: number,
): boolean {
  if (centered || wordCount <= 1) return false;
  if (pageNumber === 2 && lineNumber === 5) return false;
  return true;
}

type PageGeometry = {
  lineLayout?: readonly { line_type: string }[];
  pageWordLineNumbers?: readonly number[];
  usePageWords?: boolean;
};

export const SEPARATOR_HEIGHT = 48; // py-4 (32) + text-xs line (16)
const SURAH_HEADER_COMPACT_HEIGHT = 68; // mt-3(12) + card(48) + mb-2(8)
export const MUSHAF_LINE_COUNT = 15;
const DESKTOP_PAGE_LINE_MAX_WIDTH = 680;
export const DESKTOP_PAGE_SAFE_GUTTER = 32;
const MAX_MUSHAF_PAGE = 604;

export function clampPage(page: number | undefined, maxPage = MAX_MUSHAF_PAGE): number {
  const value = typeof page === "number" && Number.isFinite(page) ? Math.round(page) : 1;
  return Math.max(1, Math.min(maxPage, value));
}

export function fitTypographyToPageWidth(
  fontSize: number,
  lineHeight: number,
  availableWidth: number,
  lineWidthScale: number,
): { fontSize: number; lineHeight: number } {
  if (availableWidth <= 0 || fontSize <= 0) {
    return { fontSize, lineHeight };
  }
  const maxFontSize = availableWidth / lineWidthScale;
  if (fontSize <= maxFontSize) {
    return { fontSize, lineHeight };
  }
  const fittedFontSize = maxFontSize;
  const scale = fittedFontSize / fontSize;
  return {
    fontSize: fittedFontSize,
    lineHeight: Math.max(Math.ceil(fittedFontSize * 1.55), Math.floor(lineHeight * scale)),
  };
}

export function computeLineWidth(
  fontSize: number,
  availableWidth: number,
  maxLineWidth: number,
  lineWidthScale: number,
  fillAvailableWidth = false,
): number {
  if (availableWidth <= 0) return 0;
  if (fillAvailableWidth) return Math.max(0, Math.min(availableWidth, maxLineWidth));
  return Math.max(0, Math.min(fontSize * lineWidthScale, availableWidth, maxLineWidth));
}

export function computeVerticalLineMaxWidth(
  fontSize: number,
  availableWidth: number,
  compactPageWidth: boolean,
  lineWidthScale: number,
): number {
  if (compactPageWidth) return availableWidth;
  const naturalLineWidth = fontSize * lineWidthScale;
  const safeViewportWidth = Math.max(0, availableWidth - DESKTOP_PAGE_SAFE_GUTTER * 2);
  const expandedMaxWidth = Math.max(DESKTOP_PAGE_LINE_MAX_WIDTH, naturalLineWidth);
  return Math.max(0, Math.min(expandedMaxWidth, safeViewportWidth));
}

function computePageItemHeight(
  page: PageGeometry,
  lineHeight: number,
  isLast: boolean,
  pagePaddingTop: number,
  pagePaddingBottom: number,
  quranLineHeightMultiplier = 1,
): number {
  let h = isLast ? 0 : SEPARATOR_HEIGHT;
  h += pagePaddingTop + pagePaddingBottom;

  if (page.lineLayout && page.lineLayout.length > 0) {
    if (page.usePageWords && page.pageWordLineNumbers) {
      for (const line of page.lineLayout) {
        if (line.line_type === "surah_name") {
          h += SURAH_HEADER_COMPACT_HEIGHT;
        } else if (line.line_type === "basmallah") {
          h += lineHeight * 0.85 + 8; // my-1 margins
        }
      }
      h += page.pageWordLineNumbers.length * lineHeight * quranLineHeightMultiplier;
    } else {
      for (const line of page.lineLayout) {
        if (line.line_type === "surah_name") {
          h += SURAH_HEADER_COMPACT_HEIGHT;
        } else if (line.line_type === "basmallah") {
          h += lineHeight * 0.85 + 8; // my-1 margins
        } else {
          h += lineHeight * quranLineHeightMultiplier;
        }
      }
    }
  } else {
    h += 15 * lineHeight * quranLineHeightMultiplier; // fallback: standard 15 lines
  }

  return h;
}

export function getRenderedLineCount(page: PageGeometry): number {
  if (!page.lineLayout || page.lineLayout.length === 0) return MUSHAF_LINE_COUNT;
  if (page.usePageWords && page.pageWordLineNumbers) {
    const structuralLineCount = page.lineLayout.filter((line) => line.line_type !== "ayah").length;
    return structuralLineCount + page.pageWordLineNumbers.length;
  }
  return page.lineLayout.length;
}

export function buildLayoutOffsets(
  pages: readonly PageGeometry[],
  lineHeight: number,
  pagePaddingTop: number,
  pagePaddingBottom: number,
  quranLineHeightMultiplier = 1,
): { heights: number[]; offsets: number[] } {
  const heights: number[] = [];
  const offsets: number[] = [];
  let cumOffset = 0;

  for (let i = 0; i < pages.length; i++) {
    const h = computePageItemHeight(
      pages[i],
      lineHeight,
      i === pages.length - 1,
      pagePaddingTop,
      pagePaddingBottom,
      quranLineHeightMultiplier,
    );
    heights.push(h);
    offsets.push(cumOffset);
    cumOffset += h;
  }

  return { heights, offsets };
}
