import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";
import { MushafPage, type PageLineLayout } from "./MushafPage";

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

function ayahKey(surah: number, ayah: number): number {
  return surah * 10000 + ayah;
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
};

// Fixed heights for getItemLayout calculation
const SEPARATOR_HEIGHT = 48; // py-4 (32) + text-xs line (16)
const PAGE_PADDING = 40; // paddingTop 8 + paddingBottom 32
const SURAH_HEADER_COMPACT_HEIGHT = 68; // mt-3(12) + card(48) + mb-2(8)

function computePageItemHeight(
  page: PageData,
  lineHeight: number,
  isFirst: boolean
): number {
  let h = isFirst ? 0 : SEPARATOR_HEIGHT;
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
    const h = computePageItemHeight(pages[i], lineHeight, i === 0);
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

export function PageMushaf({ onPageChange, goToPageRef }: Props) {
  const db = useDatabase();
  const { fontSize, lineHeight } = useSettings();
  const { width } = useWindowDimensions();
  const [pageData, setPageData] = useState<PageData[]>([]);
  const [surahMap, setSurahMap] = useState<Map<number, SurahRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const flatListRef = useRef<FlatList>(null);

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

  // Expose goToPage function to parent — instant jump via getItemLayout
  useEffect(() => {
    if (goToPageRef) {
      goToPageRef.current = (page: number) => {
        if (page >= 1 && page <= pageData.length) {
          flatListRef.current?.scrollToIndex({
            index: page - 1,
            animated: false,
          });
        }
      };
    }
  }, [goToPageRef, pageData.length]);

  // Track which page is currently visible
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: PageData }> }) => {
      if (viewableItems.length > 0) {
        const firstVisible = viewableItems[0].item.page;
        setCurrentPage(firstVisible);
        onPageChange?.(firstVisible);
      }
    }
  ).current;

  const renderPage = useCallback(
    ({ item, index }: { item: PageData; index: number }) => (
      <View>
        {/* Page separator before every page except the first */}
        {index > 0 && <PageSeparator page={item.page} />}
        <MushafPage
          pageNumber={item.page}
          ayahs={item.ayahs}
          surahMap={surahMap}
          fontSize={fontSize}
          lineHeight={lineHeight}
          width={width}
          lineLayout={item.lineLayout}
          globalWordOffset={item.globalWordOffset}
        />
      </View>
    ),
    [surahMap, fontSize, lineHeight, width]
  );

  const keyExtractor = useCallback(
    (item: PageData) => `page-${item.page}`,
    []
  );

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
    <View className="flex-1">
      <FlatList
        ref={flatListRef}
        data={pageData}
        renderItem={renderPage}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        extraData={fontSize}
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        contentContainerStyle={{ paddingBottom: 60 }}
      />

      {/* Page indicator */}
      <View className="absolute bottom-3 left-0 right-0 items-center pointer-events-none">
        <View className="bg-warm-800/80 dark:bg-neutral-800/90 rounded-full px-4 py-1.5">
          <Text className="text-white text-xs font-semibold">
            Page {currentPage} of 604
          </Text>
        </View>
      </View>
    </View>
  );
}
