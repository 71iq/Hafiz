import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import {
  getAllSurahs,
  getDueCountForSurah,
  getDueCountForJuz,
  type Surah,
} from "../../db/database";
import { getTodayDate } from "../../lib/sm2";

interface DeckSelectorProps {
  onStartSession: (mode: "surah" | "juz", id: number) => void;
}

type Tab = "surah" | "juz";

export default function DeckSelector({ onStartSession }: DeckSelectorProps) {
  const db = useSQLiteContext();
  const [tab, setTab] = useState<Tab>("surah");
  const [surahs, setSurahs] = useState<Surah[]>([]);
  const [surahDueCounts, setSurahDueCounts] = useState<Map<number, number>>(new Map());
  const [juzDueCounts, setJuzDueCounts] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    const allSurahs = getAllSurahs(db);
    setSurahs(allSurahs);

    const today = getTodayDate();
    const surahCounts = new Map<number, number>();
    for (const s of allSurahs) {
      const count = getDueCountForSurah(db, s.number, today);
      if (count > 0) surahCounts.set(s.number, count);
    }
    setSurahDueCounts(surahCounts);

    const juzCounts = new Map<number, number>();
    for (let j = 1; j <= 30; j++) {
      const count = getDueCountForJuz(db, j, today);
      if (count > 0) juzCounts.set(j, count);
    }
    setJuzDueCounts(juzCounts);
  }, [db]);

  const juzList = Array.from({ length: 30 }, (_, i) => i + 1);

  const renderSurahRow = useCallback(
    ({ item }: { item: Surah }) => {
      const dueCount = surahDueCounts.get(item.number) ?? 0;
      return (
        <Pressable
          onPress={() => onStartSession("surah", item.number)}
          className="flex-row items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 active:bg-gray-50 dark:active:bg-gray-900"
        >
          <View className="flex-row items-center gap-3 flex-1">
            <Text className="text-sm text-gray-400 dark:text-gray-500 w-8">
              {item.number}
            </Text>
            <View className="flex-1">
              <Text className="text-base text-gray-900 dark:text-gray-100">
                {item.name_english}
              </Text>
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                {item.ayah_count} Ayahs
              </Text>
            </View>
          </View>
          <View className="flex-row items-center gap-3">
            {dueCount > 0 && (
              <View className="bg-blue-600 rounded-full px-2 py-0.5 min-w-[24px] items-center">
                <Text className="text-xs text-white font-semibold">{dueCount}</Text>
              </View>
            )}
            <Text className="text-lg text-gray-900 dark:text-gray-100">
              {item.name_arabic}
            </Text>
          </View>
        </Pressable>
      );
    },
    [onStartSession, surahDueCounts]
  );

  const renderJuzRow = useCallback(
    ({ item }: { item: number }) => {
      const dueCount = juzDueCounts.get(item) ?? 0;
      return (
        <Pressable
          onPress={() => onStartSession("juz", item)}
          className="flex-row items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 active:bg-gray-50 dark:active:bg-gray-900"
        >
          <Text className="text-base text-gray-900 dark:text-gray-100">
            Juz {item}
          </Text>
          {dueCount > 0 && (
            <View className="bg-blue-600 rounded-full px-2 py-0.5 min-w-[24px] items-center">
              <Text className="text-xs text-white font-semibold">{dueCount}</Text>
            </View>
          )}
        </Pressable>
      );
    },
    [onStartSession, juzDueCounts]
  );

  return (
    <View className="flex-1 bg-white dark:bg-gray-950">
      <View className="px-5 pb-3">
        <Text className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
          Study Deck
        </Text>
        <View className="flex-row bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          <Pressable
            onPress={() => setTab("surah")}
            className={`flex-1 py-2 rounded-md items-center ${
              tab === "surah" ? "bg-white dark:bg-gray-700" : ""
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                tab === "surah"
                  ? "text-gray-900 dark:text-gray-100"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              By Surah
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTab("juz")}
            className={`flex-1 py-2 rounded-md items-center ${
              tab === "juz" ? "bg-white dark:bg-gray-700" : ""
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                tab === "juz"
                  ? "text-gray-900 dark:text-gray-100"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              By Juz
            </Text>
          </Pressable>
        </View>
      </View>

      {tab === "surah" ? (
        <FlatList
          data={surahs}
          keyExtractor={(item) => String(item.number)}
          renderItem={renderSurahRow}
        />
      ) : (
        <FlatList
          data={juzList}
          keyExtractor={(item) => String(item)}
          renderItem={renderJuzRow}
        />
      )}
    </View>
  );
}
