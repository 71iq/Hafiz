import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  Animated as RNAnimated,
  ActivityIndicator,
  Easing,
  Platform,
  PanResponder,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useDatabase } from "@/lib/database/provider";
import {
  DEFAULT_FONT_SIZE_INDEX,
  FONT_SIZE_LINE_HEIGHTS,
  FONT_SIZE_LINE_HEIGHTS_MOBILE,
  FONT_SIZE_STEPS,
  FONT_SIZE_STEPS_MOBILE,
  useSettings,
} from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import {
  MushafPage,
  flattenPageWords,
  loadPageWordsData,
  mushafLineWidthScale,
  pageWordLineNumbers,
  splitGlyphs,
  type HifzVisibility,
  type PageLineLayout,
  type PageWordsData,
} from "./MushafPage";
import {
  SEPARATOR_HEIGHT,
  MUSHAF_LINE_COUNT,
  DESKTOP_PAGE_SAFE_GUTTER,
  clampPage,
  fitTypographyToPageWidth,
  computeLineWidth,
  computeVerticalLineMaxWidth,
  getRenderedLineCount,
  buildLayoutOffsets,
} from "@/lib/mushaf/page-layout";
import { findJuzRangeForAyah } from "@/lib/mushaf/position";
import { AyahDetailModal } from "./AyahDetailModal";
import { JuzNameText } from "./JuzNameText";
import { toArabicNumber } from "@/lib/arabic";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import {
  isSurahNameFontLoaded,
  loadQuranPageFont,
  loadSurahNameFont,
  surahNameFontName,
  surahNameGlyph,
} from "@/lib/fonts/loader";

type PageRow = {
  page: number;
  surah_start: number;
  ayah_start: number;
  surah_end: number;
  ayah_end: number;
};

type AyahRow = {
  surah: number;
  ayah: number;
  text_qcf2: string;
  v2_page: number;
};

type SurahRow = {
  number: number;
  name_arabic: string;
  name_english: string;
  ayah_count: number;
  revelation_type: string;
};

type JuzRangeRow = {
  juz: number;
  surah: number;
  ayah_start: number;
  ayah_end: number;
};

type AyahData = {
  surah: number;
  ayah: number;
  textQcf2: string;
};

type PageLineRow = {
  page_number: number;
  line_number: number;
  line_type: string;
  is_centered: number;
  first_word_id: number | null;
  last_word_id: number | null;
  surah_number: number | null;
};

type PageData = {
  page: number;
  ayahs: AyahData[];
  lineLayout?: PageLineLayout[];
  globalWordOffset?: number;
  pageWordLineNumbers?: number[];
  usePageWords?: boolean;
};

type WebDragState = {
  active: boolean;
  claimed: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastTime: number;
  vx: number;
};

const QURAN_SELECTION_TARGET_SELECTOR = "[data-hafiz-quran-token]";

function isQuranSelectionTarget(target: EventTarget | null | undefined): boolean {
  if (Platform.OS !== "web" || typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest(QURAN_SELECTION_TARGET_SELECTOR));
}

function hasActiveBrowserSelection(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.rangeCount > 0);
}

/**
 * Build page data using v2_page assignments.
 * QCF2 glyphs are PUA codepoints tied to per-page fonts, so each ayah
 * must be assigned to the page matching its v2_page.
 */
function buildPageData(
  pages: PageRow[],
  ayahs: AyahRow[],
  lineLookup: Map<number, PageLineLayout[]>,
  offsetLookup: Map<number, number>,
  pageWords: PageWordsData | null
): PageData[] {
  // Group ayahs by their QCF2 page assignment
  const ayahsByPage = new Map<number, AyahRow[]>();
  for (const a of ayahs) {
    if (!a.v2_page) continue;
    let arr = ayahsByPage.get(a.v2_page);
    if (!arr) {
      arr = [];
      ayahsByPage.set(a.v2_page, arr);
    }
    arr.push(a);
  }

  const result: PageData[] = [];
  for (const page of pages) {
    const rows = ayahsByPage.get(page.page) ?? [];
    const pageAyahs: AyahData[] = rows.map(a => ({
      surah: a.surah,
      ayah: a.ayah,
      textQcf2: a.text_qcf2 ?? "",
    }));

    const pd: PageData = { page: page.page, ayahs: pageAyahs };
    const lines = lineLookup.get(page.page);
    if (lines) {
      pd.lineLayout = lines;
      pd.globalWordOffset = offsetLookup.get(page.page) ?? 0;
    }
    const lineWords = pageWords?.[page.page - 1] ?? null;
    if (lineWords) {
      const canonicalGlyphs = pageAyahs.flatMap((ayah) => splitGlyphs(ayah.textQcf2));
      const pageWordGlyphs = flattenPageWords(lineWords);
      const usePageWords =
        canonicalGlyphs.length === pageWordGlyphs.length &&
        canonicalGlyphs.every((glyph, index) => glyph === pageWordGlyphs[index]);
      if (usePageWords) {
        pd.usePageWords = true;
        pd.pageWordLineNumbers = pageWordLineNumbers(lineWords);
      }
    }
    result.push(pd);
  }

  return result;
}

type Props = {
  currentPage?: number;
  onPageChange?: (page: number) => void;
  goToPageRef?: React.MutableRefObject<((page: number) => void) | null>;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  pagePaddingTop?: number;
  pagePaddingBottom?: number;
  pageSidePadding?: number;
  horizontalTopInset?: number;
  horizontalBottomInset?: number;
  scrollBottomInset?: number;
  onHorizontalGesture?: () => void;
  highlightedAyahKey?: string | null;
  highlightedWord?: { surah: number; ayah: number; wordPos: number } | null;
  autoScrollActive?: boolean;
  autoScrollPlaying?: boolean;
  autoScrollSpeed?: number;
  onAutoScrollUserPause?: () => void;
  onAutoScrollEnd?: () => void;
  hifzVisibility?: HifzVisibility | null;
};

// Fixed heights for getItemLayout calculation
const HORIZONTAL_PAGE_TOP_PADDING = 0;
const HORIZONTAL_PAGE_BOTTOM_RESERVE = 8;
const HORIZONTAL_CANCEL_DURATION = 190;
const HORIZONTAL_PAGE_TURN_MIN_DURATION = 240;
const HORIZONTAL_PAGE_TURN_MAX_DURATION = 320;
const HORIZONTAL_PAN_ACTIVATE_DX = 4;
const HORIZONTAL_PAN_CAPTURE_DX = 6;
const HORIZONTAL_PAN_DIRECTION_RATIO = 0.8;
const HORIZONTAL_FLICK_MIN_DISTANCE = 12;
const HORIZONTAL_FLICK_VELOCITY = 0.26;
const HORIZONTAL_EASING = Easing.out(Easing.cubic);
const FOCUS_BASE_SECONDS_PER_PAGE = 90;

function PageSeparator({
  page,
  surahNumber,
  surahName,
  juz,
  isRTL,
  width,
}: {
  page: number;
  surahNumber: number | null;
  surahName: string | null;
  juz: number | null;
  isRTL: boolean;
  width: number;
}) {
  const [surahNameFontReady, setSurahNameFontReady] = useState(() => isSurahNameFontLoaded());
  const pageLabel = isRTL ? toArabicNumber(page) : String(page);
  const surahLabel = surahName ? (isRTL ? `سورة ${surahName}` : `Surah ${surahName}`) : "";
  const juzLabel = juz ? (isRTL ? `الجزء ${toArabicNumber(juz)}` : `Juz ${juz}`) : "";
  const glyph = typeof surahNumber === "number" ? surahNameGlyph(surahNumber) : undefined;
  const useGlyph = Boolean(isRTL && glyph && surahNameFontReady);

  useEffect(() => {
    if (!isRTL || !glyph) return;
    if (isSurahNameFontLoaded()) {
      setSurahNameFontReady(true);
      return;
    }
    let cancelled = false;
    loadSurahNameFont()
      .then(() => {
        if (!cancelled) requestAnimationFrame(() => setSurahNameFontReady(true));
      })
      .catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [glyph, isRTL]);

  return (
    <View className="items-center justify-center px-3" style={{ height: SEPARATOR_HEIGHT }}>
      <View className="flex-row items-center justify-between" style={{ direction: isRTL ? "rtl" : "ltr", width }}>
        <Text
          accessibilityLabel={surahLabel}
          className="text-warm-500 dark:text-neutral-400"
          style={{
            fontFamily: useGlyph ? surahNameFontName() : "Manrope_500Medium",
            fontSize: useGlyph ? 18 : 12,
            lineHeight: useGlyph ? 22 : undefined,
            writingDirection: useGlyph ? "ltr" : isRTL ? "rtl" : "ltr",
          }}
          numberOfLines={1}
        >
          {useGlyph ? glyph : surahLabel}
        </Text>

        <View className="flex-row items-center" style={{ width: "40%" }}>
          <View className="flex-1 h-px bg-warm-200 dark:bg-neutral-700" />
          {/* Android measured three Arabic-Indic digits a little narrower than it draws them, so the
              last one wrapped out of view (442 drew as ٤٤); the minimum width holds any page number. */}
          <Text
            className="px-3 text-xs text-warm-400 dark:text-neutral-500"
            style={{ minWidth: 64, textAlign: "center", writingDirection: "ltr", flexShrink: 0 }}
            numberOfLines={1}
          >
            {pageLabel}
          </Text>
          <View className="flex-1 h-px bg-warm-200 dark:bg-neutral-700" />
        </View>

        <JuzNameText
          juz={juz}
          enabled={isRTL}
          fallback={juzLabel}
          className="text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
          glyphStyle={{ fontSize: 18, lineHeight: 22 }}
          numberOfLines={1}
        />
      </View>
    </View>
  );
}

export function PageMushaf({
  currentPage: requestedPage,
  onPageChange,
  goToPageRef,
  onScroll,
  pagePaddingTop = 8,
  pagePaddingBottom = 32,
  pageSidePadding = 16,
  horizontalTopInset = 0,
  horizontalBottomInset = 0,
  scrollBottomInset,
  onHorizontalGesture,
  highlightedAyahKey = null,
  highlightedWord = null,
  autoScrollActive = false,
  autoScrollPlaying = false,
  autoScrollSpeed = 1,
  onAutoScrollUserPause,
  onAutoScrollEnd,
  hifzVisibility = null,
}: Props) {
  const db = useDatabase();
  const { fontSize, fontSizeIndex, lineHeight, pageScroll, isRTL, uiLanguage, quranRenderFontStyle: quranFontStyle } = useSettings();
  const s = useStrings();
  const { width, height: windowHeight } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const pageWidth = containerWidth || width;
  const effectiveContainerHeight = containerHeight > 0 ? containerHeight : Math.max(0, windowHeight);
  const horizontal = pageScroll === "horizontal";
  const verticalScrollBottomInset = scrollBottomInset ?? pagePaddingBottom + 24;
  const pageAvailableWidth = Math.max(0, pageWidth - pageSidePadding * 2);
  const compactPageWidth = width < SIDEBAR_BREAKPOINT;
  const compactDefaultFontSize = FONT_SIZE_STEPS_MOBILE[DEFAULT_FONT_SIZE_INDEX];
  const lineWidthScale = mushafLineWidthScale(quranFontStyle);
  const verticalUsesJustifiedLayout = fontSizeIndex === DEFAULT_FONT_SIZE_INDEX;
  const verticalAllowsLineWrap = !verticalUsesJustifiedLayout;
  const verticalFitWidth = compactPageWidth
    ? pageAvailableWidth
    : Math.max(0, pageAvailableWidth - DESKTOP_PAGE_SAFE_GUTTER * 2);
  const verticalTypography = useMemo(
    () =>
      verticalUsesJustifiedLayout
        ? fitTypographyToPageWidth(fontSize, lineHeight, verticalFitWidth, lineWidthScale)
        : { fontSize, lineHeight },
    [fontSize, lineHeight, lineWidthScale, verticalFitWidth, verticalUsesJustifiedLayout]
  );
  const verticalLineMaxWidth = useMemo(
    () =>
      verticalUsesJustifiedLayout
        ? computeVerticalLineMaxWidth(verticalTypography.fontSize, pageAvailableWidth, compactPageWidth, lineWidthScale)
        : pageAvailableWidth,
    [compactPageWidth, lineWidthScale, pageAvailableWidth, verticalTypography.fontSize, verticalUsesJustifiedLayout]
  );
  const verticalShouldFillAvailable =
    verticalAllowsLineWrap || (compactPageWidth && verticalTypography.fontSize >= compactDefaultFontSize);
  const verticalLineWidth = useMemo(
    () => computeLineWidth(verticalTypography.fontSize, pageAvailableWidth, verticalLineMaxWidth, lineWidthScale, verticalShouldFillAvailable),
    [lineWidthScale, pageAvailableWidth, verticalLineMaxWidth, verticalShouldFillAvailable, verticalTypography.fontSize]
  );
  const verticalLineSlotHeight = verticalTypography.lineHeight;
  const verticalLineHeightMultiplier = verticalAllowsLineWrap
    ? Math.max(1, Math.ceil((verticalTypography.fontSize * lineWidthScale) / Math.max(1, verticalLineWidth)))
    : 1;
  const [pageData, setPageData] = useState<PageData[]>([]);
  const [surahMap, setSurahMap] = useState<Map<number, SurahRow>>(new Map());
  const [pageRows, setPageRows] = useState<PageRow[]>([]);
  const [juzRangeRows, setJuzRangeRows] = useState<JuzRangeRow[]>([]);
  const [pageMetaMap, setPageMetaMap] = useState<Map<number, { surahNumber: number | null; surahName: string | null; juz: number | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const initialPage = clampPage(requestedPage);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [detailAyah, setDetailAyah] = useState<{ surah: number; ayah: number } | null>(null);
  const currentPageRef = useRef(initialPage);
  const dragStartPageRef = useRef(1);
  const pageIndicatorMountedRef = useRef(false);
  const pageIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const horizontalAnimatingRef = useRef(false);
  const wheelLockedRef = useRef(false);
  const horizontalDragOffsetRef = useRef(0);
  const webDragRef = useRef<WebDragState>({
    active: false,
    claimed: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    vx: 0,
  });
  const dragX = useRef(new RNAnimated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollLastTimeRef = useRef<number | null>(null);
  const verticalOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const autoScrollEndedRef = useRef(false);
  const [webDragging, setWebDragging] = useState(false);
  const [showPageIndicator, setShowPageIndicator] = useState(false);
  const currentPageLabel = isRTL ? toArabicNumber(currentPage) : String(currentPage);
  const totalPageLabel = isRTL ? toArabicNumber(604) : "604";
  const verticalAutoScrollEnabled = autoScrollActive && !horizontal;

  const cancelAutoScrollFrame = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    autoScrollLastTimeRef.current = null;
  }, []);

  const pauseAutoScrollForUser = useCallback(() => {
    if (!verticalAutoScrollEnabled || !autoScrollPlaying) return;
    onAutoScrollUserPause?.();
  }, [autoScrollPlaying, onAutoScrollUserPause, verticalAutoScrollEnabled]);

  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    const nextWidth = Math.round(e.nativeEvent.layout.width);
    const nextHeight = Math.round(e.nativeEvent.layout.height);
    if (nextWidth > 0) {
      setContainerWidth((current) => (current === nextWidth ? current : nextWidth));
    }
    if (nextHeight > 0) {
      setContainerHeight((current) => (current === nextHeight ? current : nextHeight));
    }
  }, []);

  // Layout offsets for getItemLayout — enables instant scrollToIndex
  const [layoutInfo, setLayoutInfo] = useState<{
    heights: number[];
    offsets: number[];
  } | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [pages, ayahs, surahs, pageLines, juzRanges, pageWords] = await Promise.all([
          db.getAllAsync<PageRow>(
            "SELECT page, surah_start, ayah_start, surah_end, ayah_end FROM page_map ORDER BY page"
          ),
          db.getAllAsync<AyahRow>(
            "SELECT surah, ayah, text_qcf2, v2_page FROM quran_text ORDER BY surah, ayah"
          ),
          db.getAllAsync<SurahRow>(
            "SELECT number, name_arabic, name_english, ayah_count, revelation_type FROM surahs ORDER BY number"
          ),
          db.getAllAsync<PageLineRow>(
            "SELECT page_number, line_number, line_type, is_centered, first_word_id, last_word_id, surah_number FROM page_lines ORDER BY page_number, line_number"
          ),
          db.getAllAsync<JuzRangeRow>(
            "SELECT juz, surah, ayah_start, ayah_end FROM juz_map ORDER BY juz, surah, ayah_start"
          ),
          loadPageWordsData().catch((e) => {
            console.warn("[PageMushaf] failed to load page words:", e);
            return null;
          }),
        ]);

        const map = new Map<number, SurahRow>();
        for (const s of surahs) {
          map.set(s.number, s);
        }
        setSurahMap(map);
        setPageRows(pages);
        setJuzRangeRows(juzRanges);

        // Group page lines by page number and compute globalWordOffset per page
        const lineLookup = new Map<number, PageLineLayout[]>();
        const offsetLookup = new Map<number, number>();

        for (const row of pageLines) {
          let lines = lineLookup.get(row.page_number);
          if (!lines) {
            lines = [];
            lineLookup.set(row.page_number, lines);
          }
          lines.push({
            line_number: row.line_number,
            line_type: row.line_type,
            is_centered: row.is_centered,
            first_word_id: row.first_word_id,
            last_word_id: row.last_word_id,
            surah_number: row.surah_number,
          });

          // Track min first_word_id per page for offset calculation
          if (typeof row.first_word_id === "number" && row.first_word_id > 0) {
            const current = offsetLookup.get(row.page_number);
            if (current === undefined || row.first_word_id - 1 < current) {
              offsetLookup.set(row.page_number, row.first_word_id - 1);
            }
          }
        }

        const data = buildPageData(pages, ayahs, lineLookup, offsetLookup, pageWords);
        setPageData(data);
        setLayoutInfo(buildLayoutOffsets(data, verticalLineSlotHeight, pagePaddingTop, pagePaddingBottom, verticalLineHeightMultiplier));
      } catch (err) {
        console.error("[PageMushaf] Failed to load data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [db]);

  useEffect(() => {
    if (pageRows.length === 0 || surahMap.size === 0) return;
    const meta = new Map<number, { surahNumber: number | null; surahName: string | null; juz: number | null }>();
    for (const p of pageRows) {
      const surahName = uiLanguage === "ar"
        ? surahMap.get(p.surah_start)?.name_arabic ?? null
        : surahMap.get(p.surah_start)?.name_english ?? null;
      const range = findJuzRangeForAyah(juzRangeRows, p.surah_start, p.ayah_start);
      const juz = range ? range.juz : null;
      meta.set(p.page, { surahNumber: p.surah_start, surahName, juz });
    }
    setPageMetaMap(meta);
  }, [juzRangeRows, pageRows, surahMap, uiLanguage]);

  // Rebuild layout offsets when lineHeight changes (font size adjustment)
  useEffect(() => {
    if (pageData.length > 0) {
      setLayoutInfo(buildLayoutOffsets(pageData, verticalLineSlotHeight, pagePaddingTop, pagePaddingBottom, verticalLineHeightMultiplier));
    }
  }, [verticalLineHeightMultiplier, verticalLineSlotHeight, pageData, pagePaddingTop, pagePaddingBottom]);

  // A font or size change rebuilds every page height while the list keeps its pixel offset, which
  // landed on a different page. Keep the reader on the same page at the same relative position.
  // When the pages grow, the target can lie past the end of the old content and Android clamps the
  // scroll there, so the offset stays pending until the list reports content tall enough to hold it.
  const previousLayoutRef = useRef(layoutInfo);
  const pendingAnchorOffsetRef = useRef<number | null>(null);
  useEffect(() => {
    const previous = previousLayoutRef.current;
    previousLayoutRef.current = layoutInfo;
    if (horizontal || !previous || !layoutInfo || previous === layoutInfo) return;
    const index = currentPageRef.current - 1;
    const previousStart = previous.offsets[index];
    const previousHeight = previous.heights[index];
    const nextStart = layoutInfo.offsets[index];
    const nextHeight = layoutInfo.heights[index];
    if ([previousStart, previousHeight, nextStart, nextHeight].some((value) => typeof value !== "number")) return;
    const progress = previousHeight > 0
      ? Math.max(0, Math.min(1, (verticalOffsetRef.current - previousStart) / previousHeight))
      : 0;
    const offset = nextStart + progress * nextHeight;
    verticalOffsetRef.current = offset;
    pendingAnchorOffsetRef.current = offset + effectiveContainerHeight > contentHeightRef.current ? offset : null;
    flatListRef.current?.scrollToOffset({ offset, animated: false });
    if (pendingAnchorOffsetRef.current === null) return;
    // Never leave page tracking suspended if the list does not report a new size.
    const timer = setTimeout(() => {
      pendingAnchorOffsetRef.current = null;
    }, 1500);
    return () => clearTimeout(timer);
    // The container height is read for this layout change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizontal, layoutInfo]);

  // getItemLayout enables instant scrollToIndex without rendering intermediate items
  const getItemLayout = useCallback(
    (_data: ArrayLike<PageData> | null | undefined, index: number) => {
      if (!layoutInfo || index < 0 || index >= layoutInfo.heights.length) {
        // Fallback estimate
        const estHeight = 15 * verticalLineSlotHeight + pagePaddingTop + pagePaddingBottom + (index > 0 ? SEPARATOR_HEIGHT : 0);
        return { length: estHeight, offset: index * estHeight, index };
      }
      return {
        length: layoutInfo.heights[index],
        offset: layoutInfo.offsets[index],
        index,
      };
    },
    [layoutInfo, verticalLineSlotHeight, pagePaddingTop, pagePaddingBottom]
  );

  const updateCurrentPage = useCallback(
    (page: number) => {
      if (page < 1 || page > pageData.length) return;
      if (currentPageRef.current === page) return;
      currentPageRef.current = page;
      setCurrentPage(page);
      onPageChange?.(page);
    },
    [onPageChange, pageData.length]
  );

  useEffect(() => {
    if (!pageIndicatorMountedRef.current) {
      pageIndicatorMountedRef.current = true;
      return;
    }
    if (pageIndicatorTimerRef.current) clearTimeout(pageIndicatorTimerRef.current);
    setShowPageIndicator(true);
    pageIndicatorTimerRef.current = setTimeout(() => {
      setShowPageIndicator(false);
      pageIndicatorTimerRef.current = null;
    }, 900);
    return () => {
      if (pageIndicatorTimerRef.current) {
        clearTimeout(pageIndicatorTimerRef.current);
        pageIndicatorTimerRef.current = null;
      }
    };
  }, [currentPage]);

  const jumpToPage = useCallback(
    (page: number, animated = false) => {
      if (page < 1 || page > pageData.length) return;
      if (horizontal) {
        horizontalAnimatingRef.current = false;
        dragX.stopAnimation();
        horizontalDragOffsetRef.current = 0;
        dragX.setValue(0);
      } else {
        const index = page - 1;
        const offset = layoutInfo?.offsets[index];
        if (typeof offset === "number") {
          flatListRef.current?.scrollToOffset({
            offset,
            animated,
          });
        } else {
          flatListRef.current?.scrollToIndex({
            index,
            animated,
          });
        }
      }
      updateCurrentPage(page);
    },
    [dragX, horizontal, layoutInfo, pageData.length, updateCurrentPage]
  );

  // Expose goToPage function to parent — instant jump via getItemLayout
  useEffect(() => {
    if (goToPageRef) {
      goToPageRef.current = (page: number) => jumpToPage(page, false);
    }
  }, [goToPageRef, jumpToPage]);

  useEffect(() => {
    if (requestedPage === undefined || pageData.length === 0) return;
    const page = clampPage(requestedPage, pageData.length);
    if (page !== currentPageRef.current) {
      jumpToPage(page, false);
    }
  }, [jumpToPage, pageData.length, requestedPage]);

  // A jump lands on the page's top, but at larger font sizes a page is taller than the screen and a
  // target ayah lower on it (2:255 on page 42) stayed out of view. Bring the highlighted ayah near the
  // top, estimating its height on the page from the glyphs before it.
  useEffect(() => {
    if (horizontal || !highlightedAyahKey || !layoutInfo || pageData.length === 0) return;
    const index = pageData.findIndex((item) =>
      item.ayahs.some((ayah) => `${ayah.surah}:${ayah.ayah}` === highlightedAyahKey)
    );
    if (index < 0) return;
    const pageStart = layoutInfo.offsets[index];
    const pageHeight = layoutInfo.heights[index];
    if (typeof pageStart !== "number" || typeof pageHeight !== "number") return;
    if (pageHeight <= effectiveContainerHeight) return;
    const glyphCounts = pageData[index].ayahs.map((ayah) => ayah.textQcf2.split(/\s+/).filter(Boolean).length);
    const total = glyphCounts.reduce((sum, count) => sum + count, 0);
    const targetIndex = pageData[index].ayahs.findIndex((ayah) => `${ayah.surah}:${ayah.ayah}` === highlightedAyahKey);
    const before = glyphCounts.slice(0, targetIndex).reduce((sum, count) => sum + count, 0);
    if (total <= 0 || before <= 0) return;
    const contentHeight = pageHeight - pagePaddingTop - pagePaddingBottom - SEPARATOR_HEIGHT;
    const targetY = pageStart + pagePaddingTop + (before / total) * contentHeight;
    const offset = Math.max(pageStart, targetY - effectiveContainerHeight * 0.25);
    // On a cold start the list is still applying its initial page, so the offset stays pending and is
    // retried until a scroll event confirms it, as for a font size change.
    const frame = requestAnimationFrame(() => {
      verticalOffsetRef.current = offset;
      pendingAnchorOffsetRef.current = offset;
      retryPendingAnchor();
    });
    const timer = setTimeout(() => {
      if (pendingAnchorOffsetRef.current === offset) pendingAnchorOffsetRef.current = null;
    }, 1500);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    // Only a new target scrolls; later layout or size changes keep the reader's own position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedAyahKey, horizontal, pageData.length > 0, layoutInfo !== null]);

  // Neighbouring page fonts load ahead in both modes, so a page scrolled into view is not a spinner.
  useEffect(() => {
    if (pageData.length === 0) return;
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(pageData.length, currentPage + 2);
    for (let page = start; page <= end; page++) {
      loadQuranPageFont(quranFontStyle, page).catch(console.warn);
    }
    loadQuranPageFont(quranFontStyle, 1).catch(console.warn);
  }, [currentPage, pageData.length, quranFontStyle]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;

      const current = currentPageRef.current;
      let next: number | null = null;
      if (horizontal) return;
      if (event.key === "ArrowDown") next = current + 1;
      if (event.key === "ArrowUp") next = current - 1;
      if (next === null) return;

      event.preventDefault();
      pauseAutoScrollForUser();
      jumpToPage(Math.max(1, Math.min(pageData.length, next)), true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [horizontal, jumpToPage, pageData.length, pauseAutoScrollForUser]);

  const handleScrollToIndexFailed = useCallback(
    ({ index }: { index: number }) => {
      if (layoutInfo && index >= 0 && index < layoutInfo.offsets.length) {
        flatListRef.current?.scrollToOffset({
          offset: layoutInfo.offsets[index],
          animated: false,
        });
      }
    },
    [layoutInfo]
  );

  const pageForVerticalOffset = useCallback(
    (offset: number) => {
      if (!layoutInfo || pageData.length === 0) return null;
      const probe = offset + Math.min(240, Math.max(0, effectiveContainerHeight * 0.3));
      let low = 0;
      let high = layoutInfo.offsets.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (layoutInfo.offsets[mid] <= probe) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      const index = Math.max(0, Math.min(pageData.length - 1, high));
      return pageData[index]?.page ?? null;
    },
    [effectiveContainerHeight, layoutInfo, pageData]
  );

  const handleVerticalScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const pending = pendingAnchorOffsetRef.current;
      if (pending !== null) {
        if (Math.abs(event.nativeEvent.contentOffset.y - pending) > 2) {
          onScroll?.(event);
          return;
        }
        pendingAnchorOffsetRef.current = null;
      }
      verticalOffsetRef.current = event.nativeEvent.contentOffset.y;
      const page = pageForVerticalOffset(event.nativeEvent.contentOffset.y);
      if (page !== null) updateCurrentPage(page);
      onScroll?.(event);
    },
    [onScroll, pageForVerticalOffset, updateCurrentPage]
  );

  // The JS layout can report the new content height before the native scroll view has it, so the
  // pending offset is retried briefly until a scroll event confirms the list reached it.
  const retryPendingAnchor = useCallback((attempt = 0) => {
    const pending = pendingAnchorOffsetRef.current;
    if (pending === null) return;
    flatListRef.current?.scrollToOffset({ offset: pending, animated: false });
    if (attempt < 20) setTimeout(() => retryPendingAnchor(attempt + 1), 50);
  }, []);

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeightRef.current = height;
      const pending = pendingAnchorOffsetRef.current;
      if (pending === null || pending + effectiveContainerHeight > height) return;
      retryPendingAnchor();
    },
    [effectiveContainerHeight, retryPendingAnchor]
  );

  const resetHorizontalDrag = useCallback(
    (duration = HORIZONTAL_CANCEL_DURATION) => {
      RNAnimated.timing(dragX, {
        toValue: 0,
        duration,
        easing: HORIZONTAL_EASING,
        useNativeDriver: Platform.OS !== "web",
      }).start(() => {
        horizontalDragOffsetRef.current = 0;
        horizontalAnimatingRef.current = false;
      });
    },
    [dragX]
  );

  const animateHorizontalPageChange = useCallback(
    (nextPage: number, direction: 1 | -1) => {
      if (pageWidth <= 0 || nextPage < 1 || nextPage > pageData.length) {
        resetHorizontalDrag();
        return;
      }
      horizontalAnimatingRef.current = true;
      const targetX = direction === 1 ? pageWidth : -pageWidth;
      const remainingDistance = Math.abs(targetX - horizontalDragOffsetRef.current);
      const remainingRatio = Math.max(0, Math.min(1, remainingDistance / pageWidth));
      const duration = Math.round(
        HORIZONTAL_PAGE_TURN_MIN_DURATION +
          (HORIZONTAL_PAGE_TURN_MAX_DURATION - HORIZONTAL_PAGE_TURN_MIN_DURATION) * remainingRatio
      );
      RNAnimated.timing(dragX, {
        toValue: targetX,
        duration,
        easing: HORIZONTAL_EASING,
        useNativeDriver: Platform.OS !== "web",
      }).start(({ finished }) => {
        if (!finished) {
          resetHorizontalDrag(0);
          return;
        }
        updateCurrentPage(nextPage);
        requestAnimationFrame(() => {
          horizontalDragOffsetRef.current = 0;
          dragX.setValue(0);
          horizontalAnimatingRef.current = false;
        });
      });
    },
    [dragX, pageData.length, pageWidth, resetHorizontalDrag, updateCurrentPage]
  );

  const finishHorizontalGesture = useCallback(
    (dx: number, vx: number) => {
      if (horizontalAnimatingRef.current) return;
      const startPage = dragStartPageRef.current;
      const threshold = Math.max(28, pageWidth * 0.1);
      const fastEnough = Math.abs(vx) > HORIZONTAL_FLICK_VELOCITY;
      const farEnough = Math.abs(dx) > threshold;
      const hasIntentionalDistance = Math.abs(dx) > HORIZONTAL_FLICK_MIN_DISTANCE;
      const dragDirection: 1 | -1 = dx > 0 ? 1 : -1;
      const velocityDirection: 1 | -1 = vx > 0 ? 1 : -1;

      const direction: 1 | -1 | null = farEnough
        ? dragDirection
        : fastEnough && (!hasIntentionalDistance || velocityDirection === dragDirection)
          ? velocityDirection
          : null;

      if (direction === null) {
        resetHorizontalDrag();
        return;
      }
      const nextPage = Math.max(1, Math.min(pageData.length, startPage + direction));
      if (nextPage === startPage) {
        resetHorizontalDrag();
        return;
      }
      animateHorizontalPageChange(nextPage, direction);
    },
    [animateHorizontalPageChange, pageData.length, pageWidth, resetHorizontalDrag]
  );

  const setHorizontalDragFromDelta = useCallback(
    (dx: number) => {
      if (pageWidth <= 0) return;
      const startPage = dragStartPageRef.current;
      const atFirst = startPage === 1 && dx < 0;
      const atLast = startPage === pageData.length && dx > 0;
      const boundedDx = Math.max(-pageWidth, Math.min(pageWidth, dx));
      const nextOffset = atFirst || atLast ? boundedDx * 0.25 : boundedDx;
      horizontalDragOffsetRef.current = nextOffset;
      dragX.setValue(nextOffset);
    },
    [dragX, pageData.length, pageWidth]
  );

  const horizontalPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          horizontal &&
          !horizontalAnimatingRef.current &&
          Math.abs(gesture.dx) > HORIZONTAL_PAN_ACTIVATE_DX &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * HORIZONTAL_PAN_DIRECTION_RATIO,
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          horizontal &&
          !horizontalAnimatingRef.current &&
          Math.abs(gesture.dx) > HORIZONTAL_PAN_CAPTURE_DX &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * HORIZONTAL_PAN_DIRECTION_RATIO,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          onHorizontalGesture?.();
          dragStartPageRef.current = currentPageRef.current;
          dragX.stopAnimation();
        },
        onPanResponderMove: (_event, gesture) => {
          setHorizontalDragFromDelta(gesture.dx);
        },
        onPanResponderRelease: (_event, gesture) => {
          finishHorizontalGesture(gesture.dx, gesture.vx);
        },
        onPanResponderTerminate: () => {
          resetHorizontalDrag();
        },
      }),
    [dragX, finishHorizontalGesture, horizontal, onHorizontalGesture, pageData.length, resetHorizontalDrag, setHorizontalDragFromDelta]
  );

  const handleHorizontalPointerDown = useCallback(
    (event: { target?: EventTarget | null; nativeEvent?: { button?: number; clientX?: number; clientY?: number; pointerType?: string; target?: EventTarget | null } }) => {
      const nativeEvent = event.nativeEvent;
      if (
        Platform.OS !== "web" ||
        !nativeEvent ||
        horizontalAnimatingRef.current ||
        (nativeEvent.button !== undefined && nativeEvent.button !== 0)
      ) {
        return;
      }
      const pointerType = nativeEvent.pointerType;
      const target = event.target ?? nativeEvent.target;
      if (hasActiveBrowserSelection() || (pointerType === "mouse" && isQuranSelectionTarget(target))) {
        return;
      }
      const x = nativeEvent.clientX ?? 0;
      const y = nativeEvent.clientY ?? 0;
      dragStartPageRef.current = currentPageRef.current;
      dragX.stopAnimation();
      webDragRef.current = {
        active: true,
        claimed: false,
        startX: x,
        startY: y,
        lastX: x,
        lastTime: performance.now(),
        vx: 0,
      };
      setWebDragging(true);
    },
    [dragX]
  );

  useEffect(() => {
    if (Platform.OS !== "web" || !webDragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      const state = webDragRef.current;
      if (!state.active) return;
      if (hasActiveBrowserSelection()) {
        state.active = false;
        setWebDragging(false);
        resetHorizontalDrag(0);
        return;
      }
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (!state.claimed) {
        if (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
        state.claimed = true;
        onHorizontalGesture?.();
      }

      event.preventDefault();
      const now = performance.now();
      const dt = Math.max(1, now - state.lastTime);
      state.vx = (event.clientX - state.lastX) / dt;
      state.lastX = event.clientX;
      state.lastTime = now;
      setHorizontalDragFromDelta(dx);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const state = webDragRef.current;
      if (!state.active) return;
      state.active = false;
      setWebDragging(false);
      const dx = state.lastX - state.startX;
      if (state.claimed) {
        event.preventDefault();
        finishHorizontalGesture(dx, state.vx);
      } else {
        resetHorizontalDrag(0);
      }
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerEnd, { passive: false });
    document.addEventListener("pointercancel", handlePointerEnd, { passive: false });

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [finishHorizontalGesture, onHorizontalGesture, resetHorizontalDrag, setHorizontalDragFromDelta, webDragging]);

  const handleHorizontalWheel = useCallback(
    (event: { nativeEvent?: { deltaX?: number; deltaY?: number; preventDefault?: () => void } }) => {
      const nativeEvent = event.nativeEvent;
      if (Platform.OS !== "web" || !nativeEvent || wheelLockedRef.current || horizontalAnimatingRef.current) {
        return;
      }
      const deltaX = nativeEvent.deltaX ?? 0;
      const deltaY = nativeEvent.deltaY ?? 0;
      if (hasActiveBrowserSelection()) return;
      if (Math.abs(deltaX) < 36 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;

      onHorizontalGesture?.();
      wheelLockedRef.current = true;
      const direction: 1 | -1 = deltaX > 0 ? -1 : 1;
      const startPage = currentPageRef.current;
      const nextPage = Math.max(1, Math.min(pageData.length, startPage + direction));
      if (nextPage !== startPage) {
        animateHorizontalPageChange(nextPage, direction);
      } else {
        resetHorizontalDrag();
      }
      setTimeout(() => {
        wheelLockedRef.current = false;
      }, 320);
    },
    [animateHorizontalPageChange, onHorizontalGesture, pageData.length, resetHorizontalDrag]
  );

  const openAyahDetail = useCallback((surah: number, ayah: number) => {
    pauseAutoScrollForUser();
    setDetailAyah({ surah, ayah });
  }, [pauseAutoScrollForUser]);

  const horizontalRenderedLineCount = useMemo(() => {
    if (!horizontal || pageData.length === 0) return MUSHAF_LINE_COUNT;
    const start = Math.max(1, currentPage - 1);
    const end = Math.min(pageData.length, currentPage + 1);
    let lineCount = MUSHAF_LINE_COUNT;
    for (let page = start; page <= end; page++) {
      const data = pageData[page - 1];
      if (data) lineCount = Math.max(lineCount, getRenderedLineCount(data));
    }
    return lineCount;
  }, [currentPage, horizontal, pageData]);

  const horizontalTypography = useMemo(() => {
    const fitHeightRaw = containerHeight || Math.max(0, windowHeight - 120);
    const fitHeight = Math.max(0, fitHeightRaw);
    if (!horizontal || fitHeight <= 0) {
      return { fontSize, lineHeight };
    }
    const compactHorizontal = width < SIDEBAR_BREAKPOINT;
    const baseFontSize = compactHorizontal
      ? FONT_SIZE_STEPS_MOBILE[DEFAULT_FONT_SIZE_INDEX]
      : FONT_SIZE_STEPS[DEFAULT_FONT_SIZE_INDEX];
    const baseLineHeight = compactHorizontal
      ? FONT_SIZE_LINE_HEIGHTS_MOBILE[DEFAULT_FONT_SIZE_INDEX]
      : FONT_SIZE_LINE_HEIGHTS[DEFAULT_FONT_SIZE_INDEX];
    const minLineHeight = compactHorizontal ? 30 : 42;
    const minFontSize = compactHorizontal ? 16 : 20;
    const availableLineHeight = Math.floor(
      (fitHeight - HORIZONTAL_PAGE_BOTTOM_RESERVE - HORIZONTAL_PAGE_TOP_PADDING) /
        horizontalRenderedLineCount
    );
    const heightFittedLineHeight = Math.max(minLineHeight, Math.min(baseLineHeight, availableLineHeight));
    const heightFittedFontSize = Math.min(
      baseFontSize,
      Math.floor(baseFontSize * (heightFittedLineHeight / baseLineHeight))
    );
    const widthFitted = fitTypographyToPageWidth(
      Math.max(minFontSize, heightFittedFontSize),
      heightFittedLineHeight,
      pageAvailableWidth,
      lineWidthScale
    );
    return {
      fontSize: widthFitted.fontSize,
      lineHeight: widthFitted.lineHeight,
    };
  }, [containerHeight, fontSize, horizontal, horizontalRenderedLineCount, lineHeight, lineWidthScale, pageAvailableWidth, width, windowHeight]);
  const horizontalLineWidth = useMemo(
    () => computeLineWidth(
      horizontalTypography.fontSize,
      pageAvailableWidth,
      pageAvailableWidth,
      lineWidthScale,
      compactPageWidth && horizontalTypography.fontSize >= compactDefaultFontSize
    ),
    [compactDefaultFontSize, compactPageWidth, horizontalTypography.fontSize, lineWidthScale, pageAvailableWidth]
  );

  const extraData = useMemo(
    () => ({
      fontSize,
      lineHeight,
      verticalTypography,
      pageWidth,
      verticalLineWidth,
      verticalLineSlotHeight,
      horizontalTypography,
      horizontalLineWidth,
      effectiveContainerHeight,
      highlightedAyahKey,
      highlightedWord,
      verticalScrollBottomInset,
      hifzVisibility,
    }),
    [
      fontSize,
      lineHeight,
      verticalTypography,
      horizontalTypography,
      highlightedAyahKey,
      highlightedWord,
      horizontalLineWidth,
      effectiveContainerHeight,
      pageWidth,
      verticalLineSlotHeight,
      verticalLineWidth,
      verticalScrollBottomInset,
      hifzVisibility,
    ]
  );

  useEffect(() => {
    return () => {
      cancelAutoScrollFrame();
    };
  }, [cancelAutoScrollFrame]);

  useEffect(() => {
    if (!verticalAutoScrollEnabled || !autoScrollPlaying || loading || !layoutInfo || effectiveContainerHeight <= 0) {
      cancelAutoScrollFrame();
      autoScrollEndedRef.current = false;
      return;
    }

    autoScrollEndedRef.current = false;

    const tick = (now: number) => {
      const lastIndex = layoutInfo.heights.length - 1;
      const layoutContentHeight = lastIndex >= 0
        ? layoutInfo.offsets[lastIndex] + layoutInfo.heights[lastIndex] + verticalScrollBottomInset
        : 0;
      const maxOffset = Math.max(0, Math.max(contentHeightRef.current, layoutContentHeight) - effectiveContainerHeight);
      if (maxOffset <= 0) {
        autoScrollFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const lastTime = autoScrollLastTimeRef.current ?? now;
      const deltaSeconds = Math.max(0, Math.min(0.05, (now - lastTime) / 1000));
      autoScrollLastTimeRef.current = now;

      const pageIndex = Math.max(0, Math.min(pageData.length - 1, currentPageRef.current - 1));
      const pageHeight = layoutInfo.heights[pageIndex] ?? verticalLineSlotHeight * MUSHAF_LINE_COUNT;
      const pixelsPerSecond = (pageHeight / FOCUS_BASE_SECONDS_PER_PAGE) * Math.max(0.1, autoScrollSpeed);
      const nextOffset = Math.min(maxOffset, verticalOffsetRef.current + pixelsPerSecond * deltaSeconds);

      flatListRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
      verticalOffsetRef.current = nextOffset;

      if (nextOffset >= maxOffset - 1) {
        cancelAutoScrollFrame();
        if (!autoScrollEndedRef.current) {
          autoScrollEndedRef.current = true;
          onAutoScrollEnd?.();
        }
        return;
      }

      autoScrollFrameRef.current = requestAnimationFrame(tick);
    };

    autoScrollFrameRef.current = requestAnimationFrame(tick);
    return cancelAutoScrollFrame;
  }, [
    autoScrollPlaying,
    autoScrollSpeed,
    cancelAutoScrollFrame,
    effectiveContainerHeight,
    layoutInfo,
    loading,
    onAutoScrollEnd,
    pageData.length,
    verticalAutoScrollEnabled,
    verticalLineSlotHeight,
    verticalScrollBottomInset,
  ]);

  const renderPage = useCallback(
    ({ item, index }: { item: PageData; index: number }) => {
      return (
        // A page waiting for its font renders a small placeholder; holding the computed height keeps
        // later pages at the offsets getItemLayout reports, so jumps and the page number stay right.
        <View style={layoutInfo ? { minHeight: layoutInfo.heights[index] } : undefined}>
          <MushafPage
            pageNumber={item.page}
            ayahs={item.ayahs}
            surahMap={surahMap}
            fontSize={verticalTypography.fontSize}
            lineHeight={verticalTypography.lineHeight}
            width={pageWidth}
            lineLayout={item.lineLayout}
            globalWordOffset={item.globalWordOffset}
            usePageWords={item.usePageWords}
            pageWordLineNumbers={item.pageWordLineNumbers}
            onOpenAyahDetail={openAyahDetail}
            highlightedAyahKey={highlightedAyahKey}
            highlightedWord={highlightedWord}
            paddingTop={pagePaddingTop}
            paddingBottom={pagePaddingBottom}
            sidePadding={pageSidePadding}
            lineWidth={verticalLineWidth}
            lineSlotHeight={verticalLineSlotHeight}
            allowLineWrap={verticalAllowsLineWrap}
            hifzVisibility={hifzVisibility}
          />
          {index < pageData.length - 1 && (
            <PageSeparator
              page={item.page}
              surahNumber={pageMetaMap.get(item.page)?.surahNumber ?? null}
              surahName={pageMetaMap.get(item.page)?.surahName ?? null}
              juz={pageMetaMap.get(item.page)?.juz ?? null}
              isRTL={isRTL}
              width={verticalLineWidth}
            />
          )}
        </View>
      );
    },
    [
      layoutInfo,
      surahMap,
      fontSize,
      lineHeight,
      verticalTypography,
      pageWidth,
      pageData.length,
      openAyahDetail,
      pageMetaMap,
      pagePaddingTop,
      pagePaddingBottom,
      pageSidePadding,
      verticalLineWidth,
      isRTL,
      highlightedAyahKey,
      highlightedWord,
      verticalLineSlotHeight,
      hifzVisibility,
      verticalAllowsLineWrap,
    ]
  );

  const keyExtractor = useCallback(
    (item: PageData) => `page-${item.page}`,
    []
  );

  const horizontalPages = useMemo(() => {
    if (!horizontal || pageData.length === 0) return [];
    const start = Math.max(1, currentPage - 1);
    const end = Math.min(pageData.length, currentPage + 1);
    const pages: PageData[] = [];
    for (let page = start; page <= end; page++) {
      const data = pageData[page - 1];
      if (data) pages.push(data);
    }
    return pages;
  }, [currentPage, horizontal, pageData]);

  const horizontalGestureProps = Platform.OS === "web"
    ? ({
        onPointerDown: handleHorizontalPointerDown,
        onWheel: handleHorizontalWheel,
      } as Record<string, unknown>)
    : horizontalPanResponder.panHandlers;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#0d9488" />
        <Text className="text-warm-500 dark:text-neutral-400 mt-3 text-sm">{s.loading}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1" onLayout={onContainerLayout}>
      {horizontal ? (
        <View
          className="flex-1 overflow-hidden"
          {...horizontalGestureProps}
        >
          <RNAnimated.View
            style={{
              flex: 1,
              position: "relative",
              transform: [{ translateX: dragX }],
            }}
          >
            {horizontalPages.map((item) => (
              <View
                key={`page-${item.page}`}
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: (currentPage - item.page) * pageWidth,
                  width: pageWidth,
                }}
              >
                <View
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    paddingTop: horizontalTopInset,
                    paddingBottom: horizontalBottomInset,
                  }}
                >
                  <MushafPage
                    pageNumber={item.page}
                    ayahs={item.ayahs}
                    surahMap={surahMap}
                    fontSize={horizontalTypography.fontSize}
                    lineHeight={horizontalTypography.lineHeight}
                    width={pageWidth}
                    lineLayout={item.lineLayout}
                    globalWordOffset={item.globalWordOffset}
                    usePageWords={item.usePageWords}
                    pageWordLineNumbers={item.pageWordLineNumbers}
                    onOpenAyahDetail={openAyahDetail}
                    highlightedAyahKey={highlightedAyahKey}
                    highlightedWord={highlightedWord}
                    paddingTop={HORIZONTAL_PAGE_TOP_PADDING}
                    paddingBottom={0}
                    sidePadding={pageSidePadding}
                    lineWidth={horizontalLineWidth}
                    lineSlotHeight={horizontalTypography.lineHeight}
                    allowLineWrap={false}
                    showLoadingIndicator={false}
                    hifzVisibility={hifzVisibility}
                  />
                </View>
              </View>
            ))}
          </RNAnimated.View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={pageData}
          renderItem={renderPage}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          extraData={extraData}
          onScroll={handleVerticalScroll}
          onContentSizeChange={handleContentSizeChange}
          onScrollBeginDrag={pauseAutoScrollForUser}
          onMomentumScrollBegin={pauseAutoScrollForUser}
          onTouchStart={pauseAutoScrollForUser}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          initialScrollIndex={Math.max(0, currentPage - 1)}
          // A page is a few hundred native views, but rendering only one ahead left blank pages
          // during a fast scroll; two per batch and a window of five keep pages ready.
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          updateCellsBatchingPeriod={50}
          windowSize={5}
          contentContainerStyle={{ paddingBottom: verticalScrollBottomInset }}
          {...(Platform.OS === "web" ? ({ onWheel: pauseAutoScrollForUser } as Record<string, unknown>) : {})}
        />
      )}

      <AyahDetailModal target={detailAyah} onClose={() => setDetailAyah(null)} />

      {showPageIndicator && (
        <View className="absolute bottom-3 left-0 right-0 items-center pointer-events-none">
          <View className="bg-warm-800/80 dark:bg-neutral-800/90 rounded-full px-4 py-1.5">
            <Text className="text-white text-xs font-semibold">
              {interpolate(s.pageXOfY, { page: currentPageLabel, total: totalPageLabel })}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
