import { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList, FlashListRef } from "@shopify/flash-list";
import { BookOpen, AlignJustify, Navigation, Eye, EyeOff } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { WordInteractionProvider } from "@/lib/word/context";
import { SurahHeader } from "@/components/mushaf/SurahHeader";
import { AyahBlock } from "@/components/mushaf/AyahBlock";
import { FontSizeControl } from "@/components/mushaf/FontSizeControl";
import { PageMushaf } from "@/components/mushaf/PageMushaf";
import { GoToNavigator } from "@/components/mushaf/GoToNavigator";
import { WordDetailSheet } from "@/components/mushaf/WordDetailSheet";
import { FloatingWordTooltip } from "@/components/mushaf/WordTooltip";
import { useWordInteraction } from "@/lib/word/context";

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
  const db = useDatabase();
  const { fontSize, lineHeight, viewMode, setViewMode, isDark } = useSettings();
  const s = useStrings();
  const [items, setItems] = useState<MushafItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNavigator, setShowNavigator] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hideMode, setHideMode] = useState(false);
  const goToPageRef = useRef<((page: number) => void) | null>(null);
  const flashListRef = useRef<FlashListRef<MushafItem>>(null);

  const [surahHeaderIndices, setSurahHeaderIndices] = useState<
    Map<number, number>
  >(new Map());

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
        />
      );
    },
    [fontSize, lineHeight, hideMode]
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
    <WordInteractionProvider>
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
        {/* Header — tonal background, no border */}
        <View className="flex-row items-center justify-between px-4 py-3 bg-surface dark:bg-surface-dark">
          {/* Left: View toggle + Go-to */}
          <View className="flex-row items-center gap-2.5">
            {/* View mode toggle — pill group */}
            <View className="flex-row bg-surface-high dark:bg-surface-dark-high rounded-full p-1">
              <Pressable
                onPress={() => setViewMode("verse")}
                className={`px-3 py-1.5 rounded-full ${
                  !isPageMode ? "bg-surface-bright dark:bg-surface-dark-bright" : ""
                }`}
                style={({ pressed }) => ({
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <AlignJustify
                  size={16}
                  color={!isPageMode ? "#0d9488" : (isDark ? "#525252" : "#DFD9D1")}
                />
              </Pressable>
              <Pressable
                onPress={() => setViewMode("page")}
                className={`px-3 py-1.5 rounded-full ${
                  isPageMode ? "bg-surface-bright dark:bg-surface-dark-bright" : ""
                }`}
                style={({ pressed }) => ({
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <BookOpen
                  size={16}
                  color={isPageMode ? "#0d9488" : (isDark ? "#525252" : "#DFD9D1")}
                />
              </Pressable>
            </View>

            {/* Go-to navigator — pill button */}
            <Pressable
              onPress={() => setShowNavigator(true)}
              className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-full bg-surface-high dark:bg-surface-dark-high"
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Navigation size={13} color="#0d9488" />
              <Text
                className="text-charcoal dark:text-neutral-300"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
              >
                {isPageMode ? interpolate(s.pageN, { n: currentPage }) : s.goTo}
              </Text>
            </Pressable>
          </View>

          {/* Right: Hide mode + Font size control */}
          <View className="flex-row items-center gap-2.5">
            <Pressable
              onPress={() => setHideMode((prev) => !prev)}
              className={`px-3 py-2 rounded-full ${
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
                <Eye size={16} color={isDark ? "#525252" : "#DFD9D1"} />
              )}
            </Pressable>
            <FontSizeControl />
          </View>
        </View>

        {/* Content */}
        {isPageMode ? (
          <View className="flex-1">
            <PageMushaf
              onPageChange={setCurrentPage}
              goToPageRef={goToPageRef}
            />
          </View>
        ) : (
          <FlashList
            ref={flashListRef}
            data={items}
            renderItem={renderItem}
            getItemType={getItemType}
            keyExtractor={keyExtractor}
            extraData={{ fontSize, hideMode }}
            contentContainerStyle={{ paddingBottom: 40 }}
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

        {/* Floating word tooltip (portal-based, web only) */}
        <FloatingWordTooltip />

        {/* Word detail sheet */}
        <WordDetailSheet />
      </SafeAreaView>
    </WordInteractionProvider>
  );
}
