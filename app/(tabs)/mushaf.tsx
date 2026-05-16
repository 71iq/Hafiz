import { useEffect, useState, useCallback, useRef } from "react";
import { useFocusEffect, router } from "expo-router";
import { View, Text, Pressable, ActivityIndicator, Platform, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { FlashList, FlashListRef } from "@shopify/flash-list";
import { useChrome } from "@/lib/ui/chrome";
import { BookOpen, AlignJustify, Eye, EyeOff, Search, BookMarked } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { WordInteractionProvider } from "@/lib/word/context";
import { SelectionProvider, useSelection } from "@/lib/selection/context";
import { SurahHeader } from "@/components/mushaf/SurahHeader";
import { AyahBlock } from "@/components/mushaf/AyahBlock";
import { FontSizeControl } from "@/components/mushaf/FontSizeControl";
import { PageMushaf } from "@/components/mushaf/PageMushaf";
import { GoToNavigator } from "@/components/mushaf/GoToNavigator";
import { MushafIndicator } from "@/components/mushaf/MushafIndicator";
import { MushafSlider } from "@/components/mushaf/MushafSlider";
import { WordDetailSheet } from "@/components/mushaf/WordDetailSheet";
import { loadMushafIndex, findJuzForAyah, findHizbForAyah, topmostAyahForPage, type MushafIndex } from "@/lib/mushaf/position";
import { FloatingWordTooltip } from "@/components/mushaf/WordTooltip";
import { SelectionActionBar } from "@/components/mushaf/SelectionActionBar";
import { BookmarksSheet } from "@/components/mushaf/BookmarksSheet";
import { Toast } from "@/components/ui/Toast";
import { SearchCommand } from "@/components/SearchCommand";
import { useWordInteraction } from "@/lib/word/context";
import { consumePendingDeepLink, peekPendingDeepLink } from "@/lib/deep-link";
import { toArabicNumber } from "@/lib/arabic";
import { SIDEBAR_BREAKPOINT, VIEWPORT_BREAKPOINTS } from "@/lib/ui/viewport";

type MushafTarget = { surah: number; ayah: number; wordPos?: number };

/** Registers an ayah navigation callback inside WordInteractionProvider */
function AyahNavigationRegistrar({
  onNavigateToTarget,
}: {
  onNavigateToTarget: (target: MushafTarget) => void;
}) {
  const { setNavigateToAyah, closeDetail } = useWordInteraction();

  useEffect(() => {
    setNavigateToAyah((surah: number, ayah: number, wordPos?: number) => {
      closeDetail();
      onNavigateToTarget({ surah, ayah, wordPos });
    });
  }, [setNavigateToAyah, closeDetail, onNavigateToTarget]);

  return null;
}

type SurahRow = {
  number: number;
  name_arabic: string;
  name_english: string;
  ayah_count: number;
  revelation_type: string;
};

type AyahRow = {
  surah: number;
  ayah: number;
  text_qcf2: string;
  v2_page: number;
};

type MushafItem =
  | {
      type: "surah-header";
      surahNumber: number;
      nameArabic: string;
      nameEnglish: string;
      ayahCount: number;
      revelationType: string;
    }
  | {
      type: "ayah";
      surah: number;
      ayah: number;
      text: string;
      v2Page: number;
    };

export default function MushafScreen() {
  return (
    <WordInteractionProvider>
      <SelectionProvider>
        <MushafInner />
      </SelectionProvider>
    </WordInteractionProvider>
  );
}

function MushafInner() {
  const db = useDatabase();
  const { fontSize, lineHeight, viewMode, setViewMode, pageScroll, isDark, isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isPhone = windowWidth < SIDEBAR_BREAKPOINT;
  const isTablet = windowWidth >= SIDEBAR_BREAKPOINT && windowWidth < VIEWPORT_BREAKPOINTS.desktop;
  // Compact layout under ~480px — phones. Drops labels and tightens gaps.
  const isNarrow = windowWidth < 480;
  const { selection, toastMessage, dismissToast } = useSelection();
  const { navigateToAyah } = useWordInteraction();
  const { visible: chromeVisible, setVisible: setChromeVisible } = useChrome();
  const lastScrollYRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchMovedRef = useRef(false);
  const tapRevealGuardUntilRef = useRef(0);

  const handleScrollChrome = useCallback((e: any) => {
    const y = e?.nativeEvent?.contentOffset?.y;
    if (typeof y !== "number") return;
    const dy = y - lastScrollYRef.current;
    const now = Date.now();
    if (now <= tapRevealGuardUntilRef.current) {
      lastScrollYRef.current = y;
      return;
    }
    if (dy < -8) {
      setChromeVisible(true);
    } else if (dy > 8) {
      setChromeVisible(false);
    }
    lastScrollYRef.current = y;
  }, [setChromeVisible]);

  const toggleChromeFromReaderTap = useCallback(() => {
    if (!isPhone && !isTablet) return;
    tapRevealGuardUntilRef.current = Date.now() + 700;
    setChromeVisible((visible) => !visible);
  }, [isPhone, isTablet, setChromeVisible]);

  const readerTapProps = Platform.OS === "web"
    ? ({
        onPointerDown: (e: any) => {
          if (!isPhone && !isTablet) return;
          touchStartRef.current = {
            x: e?.nativeEvent?.pageX ?? e?.nativeEvent?.clientX ?? 0,
            y: e?.nativeEvent?.pageY ?? e?.nativeEvent?.clientY ?? 0,
          };
          touchMovedRef.current = false;
        },
        onPointerMove: (e: any) => {
          if (!isPhone && !isTablet) return;
          const start = touchStartRef.current;
          if (!start) return;
          const x = e?.nativeEvent?.pageX ?? e?.nativeEvent?.clientX;
          const y = e?.nativeEvent?.pageY ?? e?.nativeEvent?.clientY;
          if (
            typeof x === "number" &&
            typeof y === "number" &&
            (Math.abs(x - start.x) > 8 || Math.abs(y - start.y) > 8)
          ) {
            touchMovedRef.current = true;
          }
        },
        onPointerUp: () => {
          if (!isPhone && !isTablet) return;
          if (!touchMovedRef.current) toggleChromeFromReaderTap();
          touchStartRef.current = null;
        },
      } as Record<string, unknown>)
    : ({
        onTouchStart: (e: any) => {
          const touch = e?.nativeEvent?.touches?.[0];
          touchStartRef.current = touch
            ? { x: touch.pageX ?? 0, y: touch.pageY ?? 0 }
            : null;
          touchMovedRef.current = false;
        },
        onTouchMove: (e: any) => {
          const start = touchStartRef.current;
          const touch = e?.nativeEvent?.touches?.[0];
          if (!start || !touch) return;
          const x = touch.pageX;
          const y = touch.pageY;
          if (
            typeof x === "number" &&
            typeof y === "number" &&
            (Math.abs(x - start.x) > 8 || Math.abs(y - start.y) > 8)
          ) {
            touchMovedRef.current = true;
          }
        },
        onTouchEnd: () => {
          if (!touchMovedRef.current) toggleChromeFromReaderTap();
          touchStartRef.current = null;
        },
      } as Record<string, unknown>);

  // Header slides/fades out AND collapses its height so the list fills the
  // freed vertical space. We measure the natural header height on first
  // layout and animate height from that to 0.
  const headerHidden = useSharedValue(0);
  useEffect(() => {
    headerHidden.value = withTiming(chromeVisible ? 0 : 1, { duration: 200 });
  }, [chromeVisible, headerHidden]);
  const [measuredHeaderH, setMeasuredHeaderH] = useState<number | null>(null);
  const headerAnimStyle = useAnimatedStyle(() => {
    if (measuredHeaderH == null) {
      return { opacity: 1, overflow: "hidden" };
    }
    return {
      height: measuredHeaderH * (1 - headerHidden.value),
      opacity: 1 - headerHidden.value,
      overflow: "hidden",
    };
  });
  const sliderAnimStyle = useAnimatedStyle(() => ({
    opacity: 1 - headerHidden.value,
  }));
  const onHeaderLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0 && measuredHeaderH == null) setMeasuredHeaderH(h);
    },
    [measuredHeaderH]
  );

  const [items, setItems] = useState<MushafItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNavigator, setShowNavigator] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hideMode, setHideMode] = useState(false);
  const [mushafIndex, setMushafIndex] = useState<MushafIndex | null>(null);
  const [topAyah, setTopAyah] = useState<{ surah: number; ayah: number } | null>(null);
  const currentPageRef = useRef(1);
  const goToPageRef = useRef<((page: number) => void) | null>(null);
  const flashListRef = useRef<FlashListRef<MushafItem>>(null);

  const [surahHeaderIndices, setSurahHeaderIndices] = useState<
    Map<number, number>
  >(new Map());

  // Deep link highlight: "surah:ayah" key that triggers pulse animation
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [highlightedWord, setHighlightedWord] = useState<{ surah: number; ayah: number; wordPos: number } | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const highlightTarget = useCallback((target: MushafTarget) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedKey(`${target.surah}:${target.ayah}`);
    setHighlightedWord(
      typeof target.wordPos === "number"
        ? { surah: target.surah, ayah: target.ayah, wordPos: target.wordPos }
        : null
    );
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedKey(null);
      setHighlightedWord(null);
      highlightTimerRef.current = null;
    }, 2200);
  }, []);

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  // Load shared juz/surah/page index once for the indicator
  useEffect(() => {
    loadMushafIndex(db).then(setMushafIndex).catch((e) => {
      console.warn("[Mushaf] failed to load index:", e);
    });
  }, [db]);

  useEffect(() => {
    async function loadQuran() {
      try {
        const surahs = await db.getAllAsync<SurahRow>(
          "SELECT number, name_arabic, name_english, ayah_count, revelation_type FROM surahs ORDER BY number"
        );
        const surahMap = new Map<number, SurahRow>();
        for (const s of surahs) {
          surahMap.set(s.number, s);
        }

        const ayahs = await db.getAllAsync<AyahRow>(
          "SELECT surah, ayah, text_qcf2, v2_page FROM quran_text ORDER BY surah, ayah"
        );

        const flatItems: MushafItem[] = [];
        const headerIndices = new Map<number, number>();
        let currentSurah = 0;

        for (const row of ayahs) {
          if (row.surah !== currentSurah) {
            currentSurah = row.surah;
            const surah = surahMap.get(currentSurah);
            if (surah) {
              headerIndices.set(surah.number, flatItems.length);
              flatItems.push({
                type: "surah-header",
                surahNumber: surah.number,
                nameArabic: surah.name_arabic,
                nameEnglish: surah.name_english,
                ayahCount: surah.ayah_count,
                revelationType: surah.revelation_type,
              });
            }
          }

          flatItems.push({
            type: "ayah",
            surah: row.surah,
            ayah: row.ayah,
            text: row.text_qcf2,
            v2Page: row.v2_page,
          });
        }

        setItems(flatItems);
        setSurahHeaderIndices(headerIndices);
      } catch (err) {
        console.error("[Mushaf] Failed to load Quran data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadQuran();
  }, [db]);

  const scrollToTarget = useCallback(
    async (target: MushafTarget, animated = true) => {
      if (viewMode === "verse") {
        const idx = items.findIndex(
          (item) => item.type === "ayah" && item.surah === target.surah && item.ayah === target.ayah
        );
        if (idx >= 0 && flashListRef.current) {
          await flashListRef.current.scrollToIndex({
            index: idx,
            animated,
            viewPosition: 0.12,
          });
          setTopAyah({ surah: target.surah, ayah: target.ayah });
        }
        return;
      }

      const ayahItem = items.find(
        (item) => item.type === "ayah" && item.surah === target.surah && item.ayah === target.ayah
      );
      if (ayahItem && ayahItem.type === "ayah" && goToPageRef.current) {
        goToPageRef.current(ayahItem.v2Page);
      }
    },
    [items, viewMode]
  );

  const navigateToTarget = useCallback(
    (target: MushafTarget, animated = true) => {
      void scrollToTarget(target, animated)
        .catch((e) => {
          console.warn("[Mushaf] target navigation failed:", e);
        })
        .finally(() => {
          highlightTarget(target);
        });
    },
    [highlightTarget, scrollToTarget]
  );

  // Consume pending deep link on tab focus (supports both hafiz:// links and search navigation)
  useFocusEffect(
    useCallback(() => {
      if (loading || items.length === 0) return;
      const target = consumePendingDeepLink();
      if (!target) return;

      setTimeout(() => navigateToTarget(target), 100);
    }, [loading, items, navigateToTarget])
  );

  const renderItem = useCallback(
    ({ item }: { item: MushafItem }) => {
      if (item.type === "surah-header") {
        return (
          <SurahHeader
            surahNumber={item.surahNumber}
            nameArabic={item.nameArabic}
            nameEnglish={item.nameEnglish}
            ayahCount={item.ayahCount}
            revelationType={item.revelationType}
          />
        );
      }
      return (
        <AyahBlock
          surah={item.surah}
          ayah={item.ayah}
          text={item.text}
          v2Page={item.v2Page}
          fontSize={fontSize}
          lineHeight={lineHeight}
          hideMode={hideMode}
          highlighted={highlightedKey === `${item.surah}:${item.ayah}`}
          highlightedWordPos={
            highlightedWord?.surah === item.surah && highlightedWord?.ayah === item.ayah
              ? highlightedWord.wordPos
              : null
          }
        />
      );
    },
    [fontSize, lineHeight, hideMode, highlightedKey, highlightedWord]
  );

  const getItemType = useCallback((item: MushafItem) => item.type, []);

  const keyExtractor = useCallback(
    (item: MushafItem, _index: number) =>
      item.type === "surah-header"
        ? `header-${item.surahNumber}`
        : `ayah-${item.surah}-${item.ayah}`,
    []
  );

  const handleGoToPage = useCallback(
    (page: number) => {
      if (viewMode === "page" && goToPageRef.current) {
        goToPageRef.current(page);
      }
    },
    [viewMode]
  );

  const handleGoToSurahVerse = useCallback(
    (surahNumber: number) => {
      const index = surahHeaderIndices.get(surahNumber);
      if (index !== undefined && flashListRef.current) {
        flashListRef.current.scrollToIndex({
          index,
          animated: true,
        });
      }
    },
    [surahHeaderIndices]
  );

  const handleBookmarkNavigate = useCallback(
    (surah: number, ayah: number, wordPos?: number) => {
      navigateToAyah(surah, ayah, wordPos);
    },
    [navigateToAyah]
  );

  const isPageMode = viewMode === "page";
  const showBottomSlider = isPageMode;
  const pageFontSizeLocked = isPageMode && pageScroll === "horizontal";
  const mobileBottomNavHeight = 54;
  const mobileBottomNavGap = 6;
  const mobileBottomNavOffset = isPhone
    ? Math.max(insets.bottom, 10) + mobileBottomNavHeight + mobileBottomNavGap
    : 0;
  const railBottomOffset = isPhone
    ? mobileBottomNavOffset
    : isTablet
      ? Math.max(insets.bottom, 16)
      : 0;
  const pageScrollBottomInset = showBottomSlider ? 8 : undefined;
  const floatingRailSurface = {
    backgroundColor: isDark ? "rgba(28,25,23,0.95)" : "rgba(255,248,241,0.95)",
    borderWidth: 1,
    borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.72)",
    shadowColor: "#000",
    shadowOpacity: isDark ? 0.24 : 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  } as const;
  const pageHeaderOverlayStyle = isPageMode
    ? ({
        position: Platform.OS === "web" && (isPhone || isTablet) ? ("fixed" as any) : "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 80,
      } as const)
    : null;

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // For page view, derive the topmost ayah from the visible page
  useEffect(() => {
    if (!isPageMode || !mushafIndex) return;
    const top = topmostAyahForPage(mushafIndex, currentPage);
    if (top) setTopAyah(top);
  }, [currentPage, mushafIndex, isPageMode]);

  // Persist last visible position (debounced) so the next visit restores it
  const lastSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (loading) return;
    if (lastSaveTimerRef.current) clearTimeout(lastSaveTimerRef.current);
    lastSaveTimerRef.current = setTimeout(() => {
      const value = isPageMode
        ? { mode: "page", page: currentPage }
        : topAyah
          ? { mode: "verse", surah: topAyah.surah, ayah: topAyah.ayah }
          : null;
      if (!value) return;
      db.runAsync(
        "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
        ["last_mushaf_position", JSON.stringify(value)]
      ).catch(() => {});
    }, 600);
    return () => {
      if (lastSaveTimerRef.current) {
        clearTimeout(lastSaveTimerRef.current);
        lastSaveTimerRef.current = null;
      }
    };
  }, [db, loading, isPageMode, currentPage, topAyah?.surah, topAyah?.ayah]);

  // Restore last position on first mount once items are loaded — skipped if a
  // pending deep link will scroll us elsewhere (the deep-link handler runs in
  // its own focus effect).
  const restoredOnceRef = useRef(false);
  useEffect(() => {
    if (restoredOnceRef.current) return;
    if (loading || items.length === 0 || !mushafIndex) return;
    restoredOnceRef.current = true;
    (async () => {
      try {
        const row = await db.getFirstAsync<{ value: string }>(
          "SELECT value FROM user_settings WHERE key = 'last_mushaf_position'"
        );
        if (!row?.value) return;
        const parsed = JSON.parse(row.value);
        // Defer to deep-link handler if one is pending — peek without consuming
        if (peekPendingDeepLink()) return;

        if (parsed?.mode === "page" && isPageMode && parsed.page > 1 && goToPageRef.current) {
          setTimeout(() => {
            if (currentPageRef.current === 1) goToPageRef.current?.(parsed.page);
          }, 150);
        } else if (parsed?.mode === "verse" && !isPageMode) {
          const idx = items.findIndex(
            (it) => it.type === "ayah" && it.surah === parsed.surah && it.ayah === parsed.ayah
          );
          if (idx >= 0) {
            setTimeout(() => {
              flashListRef.current?.scrollToIndex({ index: idx, animated: false });
            }, 150);
          }
        }
      } catch (e) {
        console.warn("[Mushaf] restore last position failed:", e);
      }
    })();
  }, [loading, items, mushafIndex, isPageMode, db]);

  // Web only: ArrowLeft / ArrowRight in page mode → ±1 page (RTL aware)
  useEffect(() => {
    if (Platform.OS !== "web" || !isPageMode) return;
    const handler = (e: KeyboardEvent) => {
      if (showNavigator || showSearch || showBookmarks) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      // Don't hijack typing inside inputs/textareas/contenteditable
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      // Arabic reads right-to-left: ArrowRight goes back, ArrowLeft advances.
      // Under an LTR UI we still want this convention since the Mushaf itself
      // is always RTL-paginated.
      const dir = e.key === "ArrowLeft" ? +1 : -1;
      const next = Math.max(1, Math.min(604, currentPage + dir));
      goToPageRef.current?.(next);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPageMode, currentPage, showNavigator, showSearch, showBookmarks]);

  // Verse-view: track topmost visible ayah via FlashList viewable items
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: MushafItem }> }) => {
      const firstAyah = viewableItems
        .map((v) => v.item)
        .find((it) => it.type === "ayah");
      if (firstAyah && firstAyah.type === "ayah") {
        setTopAyah({ surah: firstAyah.surah, ayah: firstAyah.ayah });
      }
    }
  ).current;

  // Resolve indicator labels from current top ayah
  const indicator = (() => {
    if (!mushafIndex || !topAyah) {
      return {
        name: null as string | null,
        juz: null as number | null,
        hizb: null as number | null,
      };
    }
    const sm = mushafIndex.surahByNumber.get(topAyah.surah);
    const juz = findJuzForAyah(mushafIndex, topAyah.surah, topAyah.ayah);
    const hizb = findHizbForAyah(mushafIndex, topAyah.surah, topAyah.ayah);
    const name = uiLanguage === "ar" ? sm?.name_arabic : sm?.name_english;
    return { name: name ?? null, juz, hizb };
  })();
  if (loading && !isPageMode) {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark items-center justify-center">
        <ActivityIndicator size="large" color="#0d9488" />
        <Text
          className="text-warm-400 dark:text-neutral-400 mt-3"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 14 }}
        >
          {s.loadingQuran}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <>
      <AyahNavigationRegistrar
        onNavigateToTarget={navigateToTarget}
      />
      <SafeAreaView
        className="flex-1 bg-surface dark:bg-surface-dark"
        edges={["top"]}
      >
        {/* Header chrome — phone gets the new glass top bar, desktop keeps current layout. */}
        <Animated.View
          pointerEvents={chromeVisible ? "auto" : "none"}
          style={[pageHeaderOverlayStyle, headerAnimStyle]}
        >
          {isPhone || isTablet ? (
            <View onLayout={onHeaderLayout} className="px-3 pt-2 pb-1">
              <View
                style={{
                  direction: "ltr",
                  flexDirection: isRTL ? "row-reverse" : "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <View
                  className="rounded-full border border-white/15 p-1"
                  style={{
                    flexDirection: "row",
                    backgroundColor: isDark ? "rgba(28,25,23,0.82)" : "rgba(255,248,241,0.82)",
                    ...(Platform.OS === "web"
                      ? ({ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" } as any)
                      : null),
                  }}
                >
                  <Pressable
                    onPress={() => setViewMode("verse")}
                    className={`rounded-full px-2.5 py-1 ${!isPageMode ? "bg-surface-bright dark:bg-surface-dark-bright" : ""}`}
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                  >
                    <AlignJustify size={16} color={!isPageMode ? "#0d9488" : (isDark ? "#737373" : "#8B8178")} />
                  </Pressable>
                  <Pressable
                    onPress={() => setViewMode("page")}
                    className={`rounded-full px-2.5 py-1 ${isPageMode ? "bg-surface-bright dark:bg-surface-dark-bright" : ""}`}
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                  >
                    <BookOpen size={16} color={isPageMode ? "#0d9488" : (isDark ? "#737373" : "#8B8178")} />
                  </Pressable>
                </View>

                <View
                  className="rounded-full border border-white/15 p-1"
                  style={{
                    flexDirection: "row",
                    gap: 2,
                    backgroundColor: isDark ? "rgba(28,25,23,0.82)" : "rgba(255,248,241,0.82)",
                    ...(Platform.OS === "web"
                      ? ({ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" } as any)
                      : null),
                  }}
                >
                  <Pressable
                    onPress={() => setShowBookmarks(true)}
                    className="rounded-full px-2.5 py-2"
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                  >
                    <BookMarked size={16} color={isDark ? "#737373" : "#8B8178"} />
                  </Pressable>
                  {viewMode === "verse" && (
                    <Pressable
                      onPress={() => setHideMode((prev) => !prev)}
                      className={`rounded-full px-2.5 py-2 ${hideMode ? "bg-primary-accent/15 dark:bg-primary-bright/15" : ""}`}
                      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                    >
                      {hideMode ? <EyeOff size={16} color="#0d9488" /> : <Eye size={16} color={isDark ? "#737373" : "#8B8178"} />}
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => setShowSearch(true)}
                    className="rounded-full px-2.5 py-2"
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                  >
                    <Search size={16} color={isDark ? "#737373" : "#8B8178"} />
                  </Pressable>
                </View>
              </View>
            </View>
          ) : (
            <View
              onLayout={onHeaderLayout}
              className={`flex-row items-center justify-between bg-surface dark:bg-surface-dark ${
                isNarrow ? "px-2 py-2" : "px-4 py-3"
              }`}
            >
              <View className={`flex-row items-center ${isNarrow ? "gap-1.5" : "gap-2.5"}`}>
                <View className="flex-row bg-surface-high dark:bg-surface-dark-high rounded-full p-1">
                  <Pressable
                    onPress={() => setViewMode("verse")}
                    className={`rounded-full ${isNarrow ? "px-2 py-1" : "px-3 py-1.5"} ${
                      !isPageMode ? "bg-surface-bright dark:bg-surface-dark-bright" : ""
                    }`}
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                  >
                    <AlignJustify size={16} color={!isPageMode ? "#0d9488" : (isDark ? "#737373" : "#8B8178")} />
                  </Pressable>
                  <Pressable
                    onPress={() => setViewMode("page")}
                    className={`rounded-full ${isNarrow ? "px-2 py-1" : "px-3 py-1.5"} ${
                      isPageMode ? "bg-surface-bright dark:bg-surface-dark-bright" : ""
                    }`}
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                  >
                    <BookOpen size={16} color={isPageMode ? "#0d9488" : (isDark ? "#737373" : "#8B8178")} />
                  </Pressable>
                </View>
              </View>
              <View className={`flex-row items-center ${isNarrow ? "gap-1" : "gap-2.5"}`}>
                <Pressable
                  onPress={() => setShowBookmarks(true)}
                  className={`rounded-full bg-surface-high dark:bg-surface-dark-high ${isNarrow ? "px-2 py-2" : "px-3 py-2"}`}
                  style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                >
                  <BookMarked size={16} color={isDark ? "#737373" : "#8B8178"} />
                </Pressable>
                {viewMode === "verse" && (
                  <Pressable
                    onPress={() => setHideMode((prev) => !prev)}
                    className={`rounded-full ${isNarrow ? "px-2 py-2" : "px-3 py-2"} ${
                      hideMode
                        ? "bg-primary-accent/15 dark:bg-primary-bright/15"
                        : "bg-surface-high dark:bg-surface-dark-high"
                    }`}
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                  >
                    {hideMode ? <EyeOff size={16} color="#0d9488" /> : <Eye size={16} color={isDark ? "#737373" : "#8B8178"} />}
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setShowSearch(true)}
                  className={`rounded-full bg-surface-high dark:bg-surface-dark-high ${isNarrow ? "px-2 py-2" : "px-3 py-2"}`}
                  style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                >
                  <Search size={16} color={isDark ? "#737373" : "#8B8178"} />
                </Pressable>
                {!isNarrow && <FontSizeControl disabled={pageFontSizeLocked} />}
              </View>
            </View>
          )}
        </Animated.View>

        {!isPhone && !isPageMode && (
          <Animated.View pointerEvents="none" style={headerAnimStyle}>
            <MushafIndicator surahName={indicator.name} juz={indicator.juz} />
          </Animated.View>
        )}

        {/* Content */}
        {isPageMode ? (
          <View
            className="flex-1"
            {...readerTapProps}
            style={{
              paddingTop: 0,
              paddingBottom: isPhone ? 8 : 0,
            }}
          >
            <View
              className="flex-1"
              style={{ overflow: "hidden" }}
            >
              <PageMushaf
                onPageChange={setCurrentPage}
                goToPageRef={goToPageRef}
                onScroll={handleScrollChrome}
                onHorizontalGesture={() => {
                  touchMovedRef.current = true;
                }}
                pagePaddingTop={isPhone ? 14 : 8}
                pagePaddingBottom={isPhone ? 12 : isTablet ? 0 : 32}
                scrollBottomInset={pageScrollBottomInset}
                pageSidePadding={isPhone ? 6 : 16}
                centerVerticalOnPhone={isPhone}
                horizontalTopInset={0}
                horizontalBottomInset={0}
                highlightedAyahKey={highlightedKey}
                highlightedWord={highlightedWord}
              />
            </View>
            {!chromeVisible && (
              <>
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    right: 12,
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text
                    className="text-warm-500 dark:text-neutral-400"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
                    numberOfLines={1}
                  >
                    {indicator.name ? (isRTL ? `سورة ${indicator.name}` : `Surah ${indicator.name}`) : ""}
                  </Text>
                  <Text
                    className="text-warm-500 dark:text-neutral-400"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
                    numberOfLines={1}
                  >
                    {indicator.juz && indicator.hizb
                      ? (isRTL
                        ? `الجزء ${toArabicNumber(indicator.juz)} • الحزب ${toArabicNumber(indicator.hizb)}`
                        : `Juz ${indicator.juz} • Hizb ${indicator.hizb}`)
                      : ""}
                  </Text>
                </View>
                {pageScroll === "horizontal" && (
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      bottom: 12,
                      left: currentPage % 2 === 0 ? 12 : undefined,
                      right: currentPage % 2 === 0 ? undefined : 12,
                    }}
                  >
                    <Text
                      className="text-warm-500 dark:text-neutral-400"
                      style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
                    >
                      {isRTL ? toArabicNumber(currentPage) : String(currentPage)}
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>
        ) : (
          <View className="flex-1" {...readerTapProps}>
            <FlashList
              ref={flashListRef}
              data={items}
              renderItem={renderItem}
              getItemType={getItemType}
              keyExtractor={keyExtractor}
              extraData={{ fontSize, hideMode, highlightedKey, highlightedWord }}
              contentContainerStyle={{ paddingBottom: isPhone ? 24 : 56 }}
              onScroll={handleScrollChrome}
              scrollEventThrottle={16}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
            />
          </View>
        )}

        {/* Go-to navigator modal */}
        <GoToNavigator
          visible={showNavigator}
          onClose={() => setShowNavigator(false)}
          onGoToPage={handleGoToPage}
          mode={viewMode}
          currentPage={currentPage}
          onGoToSurahVerse={handleGoToSurahVerse}
        />

        {/* Bookmarks sheet */}
        <BookmarksSheet
          visible={showBookmarks}
          onClose={() => setShowBookmarks(false)}
          onNavigate={handleBookmarkNavigate}
        />

        {/* Floating word tooltip (portal-based, web only) */}
        <FloatingWordTooltip />

        {/* Search command modal */}
        <SearchCommand
          visible={showSearch}
          onClose={() => setShowSearch(false)}
          onNavigateToAyah={handleBookmarkNavigate}
        />

        {/* Word detail modal */}
        <WordDetailSheet />

        {/* Selection action bar */}
        <SelectionActionBar />

        {/* Bottom slider — fades with chrome */}
        {showBottomSlider && (
          <Animated.View
            pointerEvents={chromeVisible ? "auto" : "none"}
            style={[
              {
                position: Platform.OS === "web" && (isPhone || isTablet) ? "fixed" as any : "absolute",
                left: isPhone || isTablet ? 12 : 0,
                right: isPhone || isTablet ? 12 : 0,
                bottom: railBottomOffset,
                zIndex: 70,
                borderRadius: isPhone || isTablet ? 22 : 0,
                overflow: "hidden",
                ...(Platform.OS === "web" ? ({ pointerEvents: chromeVisible ? "auto" : "none" } as any) : null),
                ...(Platform.OS === "web" && (isPhone || isTablet)
                  ? ({ backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" } as any)
                  : null),
              },
              floatingRailSurface,
              sliderAnimStyle,
            ]}
          >
            <MushafSlider
              currentPage={currentPage}
              interactive={chromeVisible}
              onUserActivity={() => setChromeVisible(true)}
              onCommit={(p) => {
                if (isPageMode) goToPageRef.current?.(p);
                else {
                  // Verse view: jump to the first ayah on that page
                  const ayah = mushafIndex
                    ? topmostAyahForPage(mushafIndex, p)
                    : null;
                  if (ayah) {
                    const idx = items.findIndex(
                      (it) => it.type === "ayah" && it.surah === ayah.surah && it.ayah === ayah.ayah
                    );
                    if (idx >= 0) flashListRef.current?.scrollToIndex({ index: idx, animated: true });
                  }
                }
              }}
              onExpand={() => setShowNavigator(true)}
              index={mushafIndex}
            />
          </Animated.View>
        )}

        {/* Toast notifications */}
        <Toast message={toastMessage} onDismiss={dismissToast} />
      </SafeAreaView>
    </>
  );
}
