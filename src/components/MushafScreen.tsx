import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { View, Text } from "react-native";
import { FlashList, type FlashListRef, type ViewToken } from "@shopify/flash-list";
import { useSQLiteContext } from "expo-sqlite";
import { getAllAyahs, getAllSurahs, type Ayah, type Surah } from "../db/database";
import type { ListItem } from "../lib/types";
import { consumePendingScroll } from "../lib/deeplink";
import AyahItemComponent from "./AyahItem";
import SurahHeader from "./SurahHeader";
import ControlBar from "./ControlBar";
import SurahPicker from "./SurahPicker";
import AyahContextMenu from "./AyahContextMenu";

export default function MushafScreen() {
  const db = useSQLiteContext();
  const listRef = useRef<FlashListRef<ListItem>>(null);

  const [surahs, setSurahs] = useState<Surah[]>([]);
  const [listData, setListData] = useState<ListItem[]>([]);
  const [surahStartIndices, setSurahStartIndices] = useState<Map<number, number>>(new Map());
  const [currentSurah, setCurrentSurah] = useState<string>("");
  const [pickerVisible, setPickerVisible] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    ayah: Ayah | null;
    surahName: string;
    y: number;
  }>({ visible: false, ayah: null, surahName: "", y: 0 });

  // Build interleaved list on mount
  useEffect(() => {
    const allSurahs = getAllSurahs(db);
    const allAyahs = getAllAyahs(db);
    setSurahs(allSurahs);

    const surahMap = new Map<number, Surah>();
    for (const s of allSurahs) surahMap.set(s.number, s);

    const items: ListItem[] = [];
    const startIndices = new Map<number, number>();
    let currentSurahNum = 0;

    for (const ayah of allAyahs) {
      if (ayah.surah !== currentSurahNum) {
        currentSurahNum = ayah.surah;
        const surah = surahMap.get(currentSurahNum)!;
        startIndices.set(currentSurahNum, items.length);
        items.push({ type: "surah-header", surah });
      }
      const surah = surahMap.get(ayah.surah)!;
      items.push({ type: "ayah", ayah, surahName: surah.name_english });
    }

    setListData(items);
    setSurahStartIndices(startIndices);

    // Set initial surah name
    if (allSurahs.length > 0) {
      setCurrentSurah(allSurahs[0].name_arabic);
    }
  }, [db]);

  // Handle pending deep-link scroll after data loads
  useEffect(() => {
    if (listData.length === 0) return;
    const pending = consumePendingScroll();
    if (pending) {
      scrollToSurah(pending.surah);
    }
  }, [listData]);

  const scrollToSurah = useCallback(
    (surahNumber: number) => {
      const index = surahStartIndices.get(surahNumber);
      if (index != null && listRef.current) {
        listRef.current.scrollToIndex({ index, animated: true });
      }
    },
    [surahStartIndices]
  );

  const handleSurahSelect = useCallback(
    (surahNumber: number) => {
      scrollToSurah(surahNumber);
    },
    [scrollToSurah]
  );

  // Track current surah from viewable items
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ListItem>[] }) => {
      for (const token of viewableItems) {
        if (token.item.type === "surah-header") {
          setCurrentSurah(token.item.surah.name_arabic);
          return;
        }
      }
      // If no header is visible, use the surah of the first visible ayah
      if (viewableItems.length > 0) {
        const item = viewableItems[0].item;
        if (item.type === "ayah") {
          const surah = surahs.find((s) => s.number === item.ayah.surah);
          if (surah) setCurrentSurah(surah.name_arabic);
        }
      }
    },
    [surahs]
  );

  const viewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 50 }),
    []
  );

  const handleLongPress = useCallback(
    (ayah: Ayah, surahName: string, y: number) => {
      setContextMenu({ visible: true, ayah, surahName, y });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu({ visible: false, ayah: null, surahName: "", y: 0 });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "surah-header") {
        return <SurahHeader surah={item.surah} />;
      }
      return (
        <AyahItemComponent
          ayah={item.ayah}
          surahName={item.surahName}
          onLongPress={handleLongPress}
        />
      );
    },
    [handleLongPress]
  );

  const getItemType = useCallback((item: ListItem) => item.type, []);
  const keyExtractor = useCallback(
    (item: ListItem, index: number) =>
      item.type === "surah-header"
        ? `header-${item.surah.number}`
        : `ayah-${item.ayah.surah}-${item.ayah.ayah}`,
    []
  );

  if (listData.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-gray-500 dark:text-gray-400">Loading Mushaf...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1">
      <ControlBar
        currentSurahName={currentSurah}
        onSurahPickerOpen={() => setPickerVisible(true)}
      />
      <FlashList
        ref={listRef}
        data={listData}
        renderItem={renderItem}
        getItemType={getItemType}
        keyExtractor={keyExtractor}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />
      <SurahPicker
        visible={pickerVisible}
        surahs={surahs}
        onSelect={handleSurahSelect}
        onClose={() => setPickerVisible(false)}
      />
      <AyahContextMenu
        visible={contextMenu.visible}
        ayah={contextMenu.ayah}
        surahName={contextMenu.surahName}
        y={contextMenu.y}
        onClose={closeContextMenu}
      />
    </View>
  );
}
