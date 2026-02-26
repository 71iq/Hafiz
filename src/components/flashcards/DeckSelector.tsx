import { useState, useEffect, useCallback } from "react";
import { View, Pressable, FlatList } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import {
  getAllSurahs,
  getDueCountForSurah,
  getDueCountForJuz,
  type Surah,
} from "../../db/database";
import { getTodayDate } from "../../lib/sm2";
import { Text } from "../ui/text";
import { Badge } from "../ui/badge";
import { TabsList, TabsTrigger } from "../ui/tabs";

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
    (async () => {
    const allSurahs = await getAllSurahs(db);
    setSurahs(allSurahs);

    const today = getTodayDate();
    const surahCounts = new Map<number, number>();
    for (const s of allSurahs) {
      const count = await getDueCountForSurah(db, s.number, today);
      if (count > 0) surahCounts.set(s.number, count);
    }
    setSurahDueCounts(surahCounts);

    const juzCounts = new Map<number, number>();
    for (let j = 1; j <= 30; j++) {
      const count = await getDueCountForJuz(db, j, today);
      if (count > 0) juzCounts.set(j, count);
    }
    setJuzDueCounts(juzCounts);
    })();
  }, [db]);

  const juzList = Array.from({ length: 30 }, (_, i) => i + 1);

  const renderSurahRow = useCallback(
    ({ item }: { item: Surah }) => {
      const dueCount = surahDueCounts.get(item.number) ?? 0;
      return (
        <Pressable
          onPress={() => onStartSession("surah", item.number)}
          className="flex-row items-center justify-between px-5 py-3.5 border-b border-border active:bg-accent"
        >
          <View className="flex-row items-center gap-3 flex-1">
            <Text variant="muted" className="text-sm w-8">{item.number}</Text>
            <View className="flex-1">
              <Text className="text-base text-foreground">{item.name_english}</Text>
              <Text variant="muted" className="text-xs">{item.ayah_count} Ayahs</Text>
            </View>
          </View>
          <View className="flex-row items-center gap-3">
            {dueCount > 0 && <Badge>{dueCount}</Badge>}
            <Text className="text-lg text-foreground">{item.name_arabic}</Text>
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
          className="flex-row items-center justify-between px-5 py-3.5 border-b border-border active:bg-accent"
        >
          <Text className="text-base text-foreground">Juz {item}</Text>
          {dueCount > 0 && <Badge>{dueCount}</Badge>}
        </Pressable>
      );
    },
    [onStartSession, juzDueCounts]
  );

  return (
    <View className="flex-1 bg-background">
      <View className="px-5 pb-3">
        <Text className="text-xl font-semibold text-foreground mb-3">
          Study Deck
        </Text>
        <TabsList>
          <TabsTrigger active={tab === "surah"} onPress={() => setTab("surah")}>
            By Surah
          </TabsTrigger>
          <TabsTrigger active={tab === "juz"} onPress={() => setTab("juz")}>
            By Juz
          </TabsTrigger>
        </TabsList>
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
