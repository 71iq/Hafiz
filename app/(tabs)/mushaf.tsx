import { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { SurahHeader } from "@/components/mushaf/SurahHeader";
import { AyahBlock } from "@/components/mushaf/AyahBlock";
import { FontSizeControl } from "@/components/mushaf/FontSizeControl";

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
  text_uthmani: string;
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
    };

export default function MushafScreen() {
  const db = useDatabase();
  const { fontSize, lineHeight } = useSettings();
  const [items, setItems] = useState<MushafItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadQuran() {
      try {
        // Load surah metadata
        const surahs = await db.getAllAsync<SurahRow>(
          "SELECT number, name_arabic, name_english, ayah_count, revelation_type FROM surahs ORDER BY number"
        );
        const surahMap = new Map<number, SurahRow>();
        for (const s of surahs) {
          surahMap.set(s.number, s);
        }

        // Load all ayahs
        const ayahs = await db.getAllAsync<AyahRow>(
          "SELECT surah, ayah, text_uthmani FROM quran_text ORDER BY surah, ayah"
        );

        // Build flat list
        const flatItems: MushafItem[] = [];
        let currentSurah = 0;

        // End marker of the Bismillah: "ٱلرَّحِيمِ" in Unicode escapes
        const raheemEnd = "\u0671\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u0650";

        for (const row of ayahs) {
          if (row.surah !== currentSurah) {
            currentSurah = row.surah;
            const surah = surahMap.get(currentSurah);
            if (surah) {
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

          // Strip Bismillah from first ayah of surahs 2-114 (except 9)
          // since it's shown as a decorative element in the SurahHeader
          let text = row.text_uthmani;
          if (row.ayah === 1 && row.surah !== 1 && row.surah !== 9) {
            const idx = text.indexOf(raheemEnd);
            if (idx !== -1) {
              text = text.substring(idx + raheemEnd.length).trimStart();
            }
          }

          flatItems.push({
            type: "ayah",
            surah: row.surah,
            ayah: row.ayah,
            text,
          });
        }

        setItems(flatItems);
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
          fontSize={fontSize}
          lineHeight={lineHeight}
        />
      );
    },
    [fontSize, lineHeight]
  );

  const getItemType = useCallback((item: MushafItem) => item.type, []);

  const keyExtractor = useCallback(
    (item: MushafItem, index: number) =>
      item.type === "surah-header"
        ? `header-${item.surahNumber}`
        : `ayah-${item.surah}-${item.ayah}`,
    []
  );

  if (loading) {
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
    <SafeAreaView className="flex-1 bg-warm-50 dark:bg-neutral-950" edges={["top"]}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-3 border-b border-warm-100 dark:border-neutral-800 bg-warm-50 dark:bg-neutral-950">
        <Text className="text-lg font-bold text-warm-800 dark:text-neutral-100">
          Mushaf
        </Text>
        <FontSizeControl />
      </View>

      {/* Quran content */}
      <FlashList
        data={items}
        renderItem={renderItem}
        getItemType={getItemType}
        keyExtractor={keyExtractor}
        estimatedItemSize={150}
        extraData={fontSize}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}
