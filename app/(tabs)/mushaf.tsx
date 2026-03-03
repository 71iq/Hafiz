import { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList, FlashListRef } from "@shopify/flash-list";
import { BookOpen, AlignJustify, Navigation } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { SurahHeader } from "@/components/mushaf/SurahHeader";
import { AyahBlock } from "@/components/mushaf/AyahBlock";
import { FontSizeControl } from "@/components/mushaf/FontSizeControl";
import { PageMushaf } from "@/components/mushaf/PageMushaf";
import { GoToNavigator } from "@/components/mushaf/GoToNavigator";

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
  const { fontSize, lineHeight, viewMode, setViewMode } = useSettings();
  const [items, setItems] = useState<MushafItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNavigator, setShowNavigator] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const goToPageRef = useRef<((page: number) => void) | null>(null);
  const flashListRef = useRef<FlashListRef<MushafItem>>(null);

  // Surah header indices for verse-view Go-to-Surah
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
        />
      );
    },
    [fontSize, lineHeight]
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
      <SafeAreaView className="flex-1 bg-warm-50 dark:bg-neutral-950 items-center justify-center">
        <ActivityIndicator size="large" color="#0d9488" />
        <Text className="text-warm-500 dark:text-neutral-400 mt-3 text-sm">
          Loading Quran...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-warm-50 dark:bg-neutral-950"
      edges={["top"]}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-2.5 border-b border-warm-100 dark:border-neutral-800 bg-warm-50 dark:bg-neutral-950">
        {/* Left: View toggle + Go-to */}
        <View className="flex-row items-center gap-2">
          {/* View mode toggle */}
          <View className="flex-row bg-warm-100 dark:bg-neutral-800 rounded-lg p-0.5">
            <Pressable
              onPress={() => setViewMode("verse")}
              className={`px-2.5 py-1.5 rounded-md ${
                !isPageMode ? "bg-white dark:bg-neutral-700" : ""
              }`}
            >
              <AlignJustify
                size={16}
                color={!isPageMode ? "#0d9488" : "#b9a085"}
              />
            </Pressable>
            <Pressable
              onPress={() => setViewMode("page")}
              className={`px-2.5 py-1.5 rounded-md ${
                isPageMode ? "bg-white dark:bg-neutral-700" : ""
              }`}
            >
              <BookOpen
                size={16}
                color={isPageMode ? "#0d9488" : "#b9a085"}
              />
            </Pressable>
          </View>

          {/* Go-to navigator button */}
          <Pressable
            onPress={() => setShowNavigator(true)}
            className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-warm-100 dark:bg-neutral-800"
          >
            <Navigation size={13} color="#0d9488" />
            <Text className="text-xs font-medium text-warm-600 dark:text-neutral-300">
              {isPageMode ? `Page ${currentPage}` : "Go to"}
            </Text>
          </Pressable>
        </View>

        {/* Right: Font size control */}
        <FontSizeControl />
      </View>

      {/* Content */}
      {isPageMode ? (
        <PageMushaf
          onPageChange={setCurrentPage}
          goToPageRef={goToPageRef}
        />
      ) : (
        <FlashList
          ref={flashListRef}
          data={items}
          renderItem={renderItem}
          getItemType={getItemType}
          keyExtractor={keyExtractor}
          extraData={fontSize}
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
    </SafeAreaView>
  );
}
