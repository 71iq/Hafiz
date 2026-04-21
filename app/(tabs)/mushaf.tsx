import { useEffect, useState, useCallback, useRef } from "react";
import { useFocusEffect, router } from "expo-router";
import { View, Text, Pressable, ActivityIndicator, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { FlashList, FlashListRef } from "@shopify/flash-list";
import { useChrome, useHideChromeOnScroll } from "@/lib/ui/chrome";
import { BookOpen, AlignJustify, Navigation, Eye, EyeOff, Search, BookMarked } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { WordInteractionProvider } from "@/lib/word/context";
import { SelectionProvider, useSelection } from "@/lib/selection/context";
import { SurahHeader } from "@/components/mushaf/SurahHeader";
import { AyahBlock } from "@/components/mushaf/AyahBlock";
import { FontSizeControl } from "@/components/mushaf/FontSizeControl";
import { PageMushaf } from "@/components/mushaf/PageMushaf";
import { GoToNavigator } from "@/components/mushaf/GoToNavigator";
import { WordDetailSheet } from "@/components/mushaf/WordDetailSheet";
import { FloatingWordTooltip } from "@/components/mushaf/WordTooltip";
import { SelectionActionBar } from "@/components/mushaf/SelectionActionBar";
import { BookmarksSheet } from "@/components/mushaf/BookmarksSheet";
import { Toast } from "@/components/ui/Toast";
import { SearchCommand } from "@/components/SearchCommand";
import { useWordInteraction } from "@/lib/word/context";
import { consumePendingDeepLink } from "@/lib/deep-link";

/** Registers an ayah navigation callback inside WordInteractionProvider */
function AyahNavigationRegistrar({
  items,
  flashListRef,
  goToPageRef,
  viewMode,
}: {
  items: MushafItem[];
  flashListRef: React.RefObject<FlashListRef<MushafItem> | null>;
  goToPageRef: React.RefObject<((page: number) => void) | null>;
  viewMode: string;
}) {
  const { setNavigateToAyah, closeDetail } = useWordInteraction();

  useEffect(() => {
    setNavigateToAyah((surah: number, ayah: number) => {
      closeDetail();

      if (viewMode === "verse") {
        const idx = items.findIndex(
          (item) => item.type === "ayah" && item.surah === surah && item.ayah === ayah
        );
        if (idx >= 0 && flashListRef.current) {
          flashListRef.current.scrollToIndex({ index: idx, animated: true });
        }
      } else if (viewMode === "page") {
        const ayahItem = items.find(
          (item) => item.type === "ayah" && item.surah === surah && item.ayah === ayah
        );
        if (ayahItem && ayahItem.type === "ayah" && goToPageRef.current) {
          goToPageRef.current(ayahItem.v2Page);
        }
      }
    });
  }, [items, viewMode, flashListRef, goToPageRef, setNavigateToAyah, closeDetail]);

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
  const { fontSize, lineHeight, viewMode, setViewMode, isDark } = useSettings();
  const s = useStrings();
  const { width: windowWidth } = useWindowDimensions();
  // Compact layout under ~480px — phones. Drops labels and tightens gaps.
  const isNarrow = windowWidth < 480;
  const { selection, toastMessage, dismissToast } = useSelection();
  const { navigateToAyah } = useWordInteraction();
  const { visible: chromeVisible } = useChrome();
  const onScrollHide = useHideChromeOnScroll();

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
  const goToPageRef = useRef<((page: number) => void) | null>(null);
  const flashListRef = useRef<FlashListRef<MushafItem>>(null);

  const [surahHeaderIndices, setSurahHeaderIndices] = useState<
    Map<number, number>
  >(new Map());

  // Deep link highlight: "surah:ayah" key that triggers pulse animation
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);

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

  // Consume pending deep link on tab focus (supports both hafiz:// links and search navigation)
  useFocusEffect(
    useCallback(() => {
      if (loading || items.length === 0) return;
      const target = consumePendingDeepLink();
      if (!target) return;

      const key = `${target.surah}:${target.ayah}`;
      setHighlightedKey(key);

      // Clear highlight after animation completes
      const timer = setTimeout(() => setHighlightedKey(null), 2000);

      // Scroll to the target ayah
      if (viewMode === "verse") {
        const idx = items.findIndex(
          (item) => item.type === "ayah" && item.surah === target.surah && item.ayah === target.ayah
        );
        if (idx >= 0) {
          setTimeout(() => {
            flashListRef.current?.scrollToIndex({ index: idx, animated: true });
          }, 100);
        }
      } else if (viewMode === "page") {
        const ayahItem = items.find(
          (item) => item.type === "ayah" && item.surah === target.surah && item.ayah === target.ayah
        );
        if (ayahItem && ayahItem.type === "ayah" && goToPageRef.current) {
          setTimeout(() => {
            goToPageRef.current?.(ayahItem.v2Page);
          }, 100);
        }
      }

      return () => clearTimeout(timer);
    }, [loading, items, viewMode])
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
        />
      );
    },
    [fontSize, lineHeight, hideMode, highlightedKey]
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
    (surah: number, ayah: number) => {
      navigateToAyah(surah, ayah);
    },
    [navigateToAyah]
  );

  const isPageMode = viewMode === "page";

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
        items={items}
        flashListRef={flashListRef}
        goToPageRef={goToPageRef}
        viewMode={viewMode}
      />
      <SafeAreaView
        className="flex-1 bg-surface dark:bg-surface-dark"
        edges={["top"]}
      >
        {/* Header — tonal background, no border. Hides on scroll down.
            NativeWind's className doesn't flow into Animated.View, so we
            keep the animated wrapper style-only and put layout classes on
            the inner View. */}
        <Animated.View
          pointerEvents={chromeVisible ? "auto" : "none"}
          style={headerAnimStyle}
        >
        <View
          onLayout={onHeaderLayout}
          className={`flex-row items-center justify-between bg-surface dark:bg-surface-dark ${
            isNarrow ? "px-2 py-2" : "px-4 py-3"
          }`}
        >
          {/* Left: View toggle + Go-to */}
          <View className={`flex-row items-center ${isNarrow ? "gap-1.5" : "gap-2.5"}`}>
            {/* View mode toggle — pill group */}
            <View className="flex-row bg-surface-high dark:bg-surface-dark-high rounded-full p-1">
              <Pressable
                onPress={() => setViewMode("verse")}
                className={`rounded-full ${isNarrow ? "px-2 py-1" : "px-3 py-1.5"} ${
                  !isPageMode ? "bg-surface-bright dark:bg-surface-dark-bright" : ""
                }`}
                style={({ pressed }) => ({
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <AlignJustify
                  size={16}
                  color={!isPageMode ? "#0d9488" : (isDark ? "#737373" : "#8B8178")}
                />
              </Pressable>
              <Pressable
                onPress={() => setViewMode("page")}
                className={`rounded-full ${isNarrow ? "px-2 py-1" : "px-3 py-1.5"} ${
                  isPageMode ? "bg-surface-bright dark:bg-surface-dark-bright" : ""
                }`}
                style={({ pressed }) => ({
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <BookOpen
                  size={16}
                  color={isPageMode ? "#0d9488" : (isDark ? "#737373" : "#8B8178")}
                />
              </Pressable>
            </View>

            {/* Go-to navigator — pill button. Drops label on narrow. */}
            <Pressable
              onPress={() => setShowNavigator(true)}
              className={`flex-row items-center rounded-full bg-surface-high dark:bg-surface-dark-high ${
                isNarrow ? "px-2 py-2" : "gap-1.5 px-3.5 py-2"
              }`}
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Navigation size={13} color="#0d9488" />
              {!isNarrow && (
                <Text
                  className="text-charcoal dark:text-neutral-300"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                >
                  {isPageMode ? interpolate(s.pageN, { n: currentPage }) : s.goTo}
                </Text>
              )}
            </Pressable>
          </View>

          {/* Right: Bookmarks + Hide mode + Search + Font size */}
          <View className={`flex-row items-center ${isNarrow ? "gap-1" : "gap-2.5"}`}>
            {/* Bookmarks button */}
            <Pressable
              onPress={() => setShowBookmarks(true)}
              className={`rounded-full bg-surface-high dark:bg-surface-dark-high ${
                isNarrow ? "px-2 py-2" : "px-3 py-2"
              }`}
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <BookMarked size={16} color={isDark ? "#737373" : "#8B8178"} />
            </Pressable>
            {/* Hide-mode toggle only makes sense in verse-by-verse view —
                page view renders whole pages with no per-ayah blur target. */}
            {viewMode === "verse" && (
              <Pressable
                onPress={() => setHideMode((prev) => !prev)}
                className={`rounded-full ${isNarrow ? "px-2 py-2" : "px-3 py-2"} ${
                  hideMode
                    ? "bg-primary-accent/15 dark:bg-primary-bright/15"
                    : "bg-surface-high dark:bg-surface-dark-high"
                }`}
                style={({ pressed }) => ({
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                {hideMode ? (
                  <EyeOff size={16} color="#0d9488" />
                ) : (
                  <Eye size={16} color={isDark ? "#737373" : "#8B8178"} />
                )}
              </Pressable>
            )}
            {/* Search — open search modal */}
            <Pressable
              onPress={() => setShowSearch(true)}
              className={`rounded-full bg-surface-high dark:bg-surface-dark-high ${
                isNarrow ? "px-2 py-2" : "px-3 py-2"
              }`}
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Search size={16} color={isDark ? "#737373" : "#8B8178"} />
            </Pressable>
            {/* Font size adjuster lives in Settings on narrow viewports to
                keep the top bar fitting on phone widths. */}
            {!isNarrow && <FontSizeControl />}
          </View>
        </View>
        </Animated.View>

        {/* Content */}
        {isPageMode ? (
          <View className="flex-1">
            <PageMushaf
              onPageChange={setCurrentPage}
              goToPageRef={goToPageRef}
              onScroll={onScrollHide}
            />
          </View>
        ) : (
          <FlashList
            ref={flashListRef}
            data={items}
            renderItem={renderItem}
            getItemType={getItemType}
            keyExtractor={keyExtractor}
            extraData={{ fontSize, hideMode, highlightedKey }}
            contentContainerStyle={{ paddingBottom: 40 }}
            onScroll={onScrollHide}
            scrollEventThrottle={16}
          />
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
        <SearchCommand visible={showSearch} onClose={() => setShowSearch(false)} />

        {/* Word detail sheet */}
        <WordDetailSheet />

        {/* Selection action bar */}
        <SelectionActionBar />

        {/* Toast notifications */}
        <Toast message={toastMessage} onDismiss={dismissToast} />
      </SafeAreaView>
    </>
  );
}
