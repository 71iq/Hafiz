import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  Animated as RNAnimated,
  ActivityIndicator,
  Platform,
  PanResponder,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { MushafPage, type PageLineLayout } from "./MushafPage";
import { AyahDetailModal } from "./AyahDetailModal";

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

/**
 * Build page data using v2_page assignments.
 * QCF2 glyphs are PUA codepoints tied to per-page fonts, so each ayah
 * must be assigned to the page matching its v2_page.
 */
function buildPageData(
  pages: PageRow[],
  ayahs: AyahRow[],
  lineLookup: Map<number, PageLineLayout[]>,
  offsetLookup: Map<number, number>
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
    result.push(pd);
  }

  return result;
}

type Props = {
  onPageChange?: (page: number) => void;
  goToPageRef?: React.MutableRefObject<((page: number) => void) | null>;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

// Fixed heights for getItemLayout calculation
const SEPARATOR_HEIGHT = 48; // py-4 (32) + text-xs line (16)
const PAGE_PADDING = 40; // paddingTop 8 + paddingBottom 32
const SURAH_HEADER_COMPACT_HEIGHT = 68; // mt-3(12) + card(48) + mb-2(8)
const HORIZONTAL_PAGE_TOP_PADDING = 0;
const HORIZONTAL_PAGE_BOTTOM_RESERVE = 56;
const MUSHAF_LINE_COUNT = 15;

function computePageItemHeight(
  page: PageData,
  lineHeight: number,
  isLast: boolean
): number {
  let h = isLast ? 0 : SEPARATOR_HEIGHT;
  h += PAGE_PADDING;

  if (page.lineLayout && page.lineLayout.length > 0) {
    for (const line of page.lineLayout) {
      if (line.line_type === "surah_name") {
        h += SURAH_HEADER_COMPACT_HEIGHT;
      } else if (line.line_type === "basmallah") {
        h += lineHeight * 0.85 + 8; // my-1 margins
      } else {
        h += lineHeight;
      }
    }
  } else {
    h += 15 * lineHeight; // fallback: standard 15 lines
  }

  return h;
}

function buildLayoutOffsets(
  pages: PageData[],
  lineHeight: number
): { heights: number[]; offsets: number[] } {
  const heights: number[] = [];
  const offsets: number[] = [];
  let cumOffset = 0;

  for (let i = 0; i < pages.length; i++) {
    const h = computePageItemHeight(pages[i], lineHeight, i === pages.length - 1);
    heights.push(h);
    offsets.push(cumOffset);
    cumOffset += h;
  }

  return { heights, offsets };
}

function PageSeparator({ page }: { page: number }) {
  return (
    <View className="items-center" style={{ height: SEPARATOR_HEIGHT, justifyContent: "center" }}>
      <View className="flex-row items-center" style={{ width: "60%" }}>
        <View className="flex-1 h-px bg-warm-200 dark:bg-neutral-700" />
        <Text className="px-3 text-xs text-warm-400 dark:text-neutral-500">
          {toArabicNumber(page)}
        </Text>
        <View className="flex-1 h-px bg-warm-200 dark:bg-neutral-700" />
      </View>
    </View>
  );
}

export function PageMushaf({ onPageChange, goToPageRef, onScroll }: Props) {
  const db = useDatabase();
  const { fontSize, lineHeight, pageScroll } = useSettings();
  const s = useStrings();
  const { width, height: windowHeight } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const pageWidth = containerWidth || width;
  const horizontal = pageScroll === "horizontal";
  const [pageData, setPageData] = useState<PageData[]>([]);
  const [surahMap, setSurahMap] = useState<Map<number, SurahRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [detailAyah, setDetailAyah] = useState<{ surah: number; ayah: number } | null>(null);
  const currentPageRef = useRef(1);
  const dragStartPageRef = useRef(1);
  const pageIndicatorMountedRef = useRef(false);
  const pageIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const horizontalAnimatingRef = useRef(false);
  const wheelLockedRef = useRef(false);
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
  const [webDragging, setWebDragging] = useState(false);
  const [showPageIndicator, setShowPageIndicator] = useState(false);

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
        const [pages, ayahs, surahs, pageLines] = await Promise.all([
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
        ]);

        const map = new Map<number, SurahRow>();
        for (const s of surahs) {
          map.set(s.number, s);
        }
        setSurahMap(map);

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

        const data = buildPageData(pages, ayahs, lineLookup, offsetLookup);
        setPageData(data);
        setLayoutInfo(buildLayoutOffsets(data, lineHeight));
      } catch (err) {
        console.error("[PageMushaf] Failed to load data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [db, lineHeight]);

  // Rebuild layout offsets when lineHeight changes (font size adjustment)
  useEffect(() => {
    if (pageData.length > 0) {
      setLayoutInfo(buildLayoutOffsets(pageData, lineHeight));
    }
  }, [lineHeight, pageData]);

  // getItemLayout enables instant scrollToIndex without rendering intermediate items
  const getItemLayout = useCallback(
    (_data: ArrayLike<PageData> | null | undefined, index: number) => {
      if (!layoutInfo || index < 0 || index >= layoutInfo.heights.length) {
        // Fallback estimate
        const estHeight = 15 * lineHeight + PAGE_PADDING + (index > 0 ? SEPARATOR_HEIGHT : 0);
        return { length: estHeight, offset: index * estHeight, index };
      }
      return {
        length: layoutInfo.heights[index],
        offset: layoutInfo.offsets[index],
        index,
      };
    },
    [layoutInfo, lineHeight]
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
        dragX.setValue(0);
      } else {
        flatListRef.current?.scrollToIndex({
          index: page - 1,
          animated,
        });
      }
      updateCurrentPage(page);
    },
    [dragX, horizontal, pageData.length, updateCurrentPage]
  );

  // Expose goToPage function to parent — instant jump via getItemLayout
  useEffect(() => {
    if (goToPageRef) {
      goToPageRef.current = (page: number) => jumpToPage(page, false);
    }
  }, [goToPageRef, jumpToPage]);

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
      jumpToPage(Math.max(1, Math.min(pageData.length, next)), true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [horizontal, jumpToPage, pageData.length]);

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

  // Track which page is currently visible
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ item: PageData }> }) => {
      if (viewableItems.length > 0) {
        updateCurrentPage(viewableItems[0].item.page);
      }
    },
    [updateCurrentPage]
  );

  const resetHorizontalDrag = useCallback(
    (duration = 120) => {
      RNAnimated.timing(dragX, {
        toValue: 0,
        duration,
        useNativeDriver: Platform.OS !== "web",
      }).start(() => {
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
      RNAnimated.timing(dragX, {
        toValue: direction === 1 ? -pageWidth : pageWidth,
        duration: 150,
        useNativeDriver: Platform.OS !== "web",
      }).start(({ finished }) => {
        if (!finished) {
          resetHorizontalDrag(0);
          return;
        }
        updateCurrentPage(nextPage);
        requestAnimationFrame(() => {
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
      const threshold = Math.max(48, pageWidth * 0.18);
      const fastEnough = Math.abs(vx) > 0.35;
      const farEnough = Math.abs(dx) > threshold;
      if (!fastEnough && !farEnough) {
        resetHorizontalDrag();
        return;
      }

      const direction: 1 | -1 = fastEnough
        ? vx < 0 ? 1 : -1
        : dx < 0 ? 1 : -1;
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
      const atFirst = startPage === 1 && dx > 0;
      const atLast = startPage === pageData.length && dx < 0;
      const boundedDx = Math.max(-pageWidth, Math.min(pageWidth, dx));
      dragX.setValue(atFirst || atLast ? boundedDx * 0.25 : boundedDx);
    },
    [dragX, pageData.length, pageWidth]
  );

  const horizontalPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          horizontal &&
          !horizontalAnimatingRef.current &&
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          horizontal &&
          !horizontalAnimatingRef.current &&
          Math.abs(gesture.dx) > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderGrant: () => {
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
    [dragX, finishHorizontalGesture, horizontal, pageData.length, resetHorizontalDrag, setHorizontalDragFromDelta]
  );

  const handleHorizontalPointerDown = useCallback(
    (event: { nativeEvent?: { button?: number; clientX?: number; clientY?: number } }) => {
      const nativeEvent = event.nativeEvent;
      if (
        Platform.OS !== "web" ||
        !nativeEvent ||
        horizontalAnimatingRef.current ||
        (nativeEvent.button !== undefined && nativeEvent.button !== 0)
      ) {
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
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (!state.claimed) {
        if (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
        state.claimed = true;
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
      const dx = event.clientX - state.startX;
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
  }, [finishHorizontalGesture, resetHorizontalDrag, setHorizontalDragFromDelta, webDragging]);

  const handleHorizontalWheel = useCallback(
    (event: { nativeEvent?: { deltaX?: number; deltaY?: number; preventDefault?: () => void } }) => {
      const nativeEvent = event.nativeEvent;
      if (Platform.OS !== "web" || !nativeEvent || wheelLockedRef.current || horizontalAnimatingRef.current) {
        return;
      }
      const deltaX = nativeEvent.deltaX ?? 0;
      const deltaY = nativeEvent.deltaY ?? 0;
      if (Math.abs(deltaX) < 36 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;

      wheelLockedRef.current = true;
      const direction: 1 | -1 = deltaX > 0 ? 1 : -1;
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
    [animateHorizontalPageChange, pageData.length, resetHorizontalDrag]
  );

  const openAyahDetail = useCallback((surah: number, ayah: number) => {
    setDetailAyah({ surah, ayah });
  }, []);

  const horizontalTypography = useMemo(() => {
    const fitHeight = containerHeight || Math.max(0, windowHeight - 120);
    if (!horizontal || fitHeight <= 0) {
      return { fontSize, lineHeight };
    }
    const availableLineHeight = Math.floor(
      (fitHeight - HORIZONTAL_PAGE_BOTTOM_RESERVE - HORIZONTAL_PAGE_TOP_PADDING) /
        MUSHAF_LINE_COUNT
    );
    const fittedLineHeight = Math.max(42, Math.min(lineHeight, availableLineHeight));
    const fittedFontSize = Math.min(fontSize, Math.floor(fontSize * (fittedLineHeight / lineHeight)));
    return {
      fontSize: Math.max(20, fittedFontSize),
      lineHeight: fittedLineHeight,
    };
  }, [containerHeight, fontSize, horizontal, lineHeight, windowHeight]);

  const extraData = useMemo(
    () => ({ fontSize, pageWidth, horizontalTypography }),
    [fontSize, horizontalTypography, pageWidth]
  );

  const renderPage = useCallback(
    ({ item, index }: { item: PageData; index: number }) => {
      return (
        <View>
          <MushafPage
            pageNumber={item.page}
            ayahs={item.ayahs}
            surahMap={surahMap}
            fontSize={fontSize}
            lineHeight={lineHeight}
            width={pageWidth}
            lineLayout={item.lineLayout}
            globalWordOffset={item.globalWordOffset}
            onOpenAyahDetail={openAyahDetail}
          />
          {index < pageData.length - 1 && <PageSeparator page={item.page} />}
        </View>
      );
    },
    [surahMap, fontSize, lineHeight, pageWidth, pageData.length, openAyahDetail]
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
        <Text className="text-warm-500 dark:text-neutral-400 mt-3 text-sm">
          Loading pages...
        </Text>
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
                  left: (item.page - currentPage) * pageWidth,
                  width: pageWidth,
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
                  onOpenAyahDetail={openAyahDetail}
                  paddingTop={HORIZONTAL_PAGE_TOP_PADDING}
                  paddingBottom={0}
                />
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
          onScroll={onScroll}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          initialNumToRender={1}
          maxToRenderPerBatch={1}
          updateCellsBatchingPeriod={80}
          windowSize={3}
          removeClippedSubviews
          contentContainerStyle={{ paddingBottom: 60 }}
        />
      )}

      <AyahDetailModal target={detailAyah} onClose={() => setDetailAyah(null)} />

      {showPageIndicator && (
        <View className="absolute bottom-3 left-0 right-0 items-center pointer-events-none">
          <View className="bg-warm-800/80 dark:bg-neutral-800/90 rounded-full px-4 py-1.5">
            <Text className="text-white text-xs font-semibold">
              {interpolate(s.pageXOfY, { page: currentPage, total: 604 })}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
