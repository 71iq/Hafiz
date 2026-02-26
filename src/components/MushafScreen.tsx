import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { View } from "react-native";
import { FlashList, type FlashListRef, type ViewToken } from "@shopify/flash-list";
import { useSQLiteContext } from "expo-sqlite";
import { getAllAyahs, getAllSurahs, type Ayah, type Surah } from "../db/database";
import type { ListItem } from "../lib/types";
import { consumePendingScroll } from "../lib/deeplink";
import { Text } from "./ui/text";
import SurahHeader from "./SurahHeader";
import SurahTextBlock from "./SurahTextBlock";
import ControlBar from "./ControlBar";
import SurahPicker from "./SurahPicker";
import AyahContextMenu from "./AyahContextMenu";
import CreatePostModal from "./community/CreatePostModal";

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
  const [createPostData, setCreatePostData] = useState<{
    visible: boolean;
    surah: number;
    ayah: number;
    ayahText: string;
    surahName: string;
  }>({ visible: false, surah: 0, ayah: 0, ayahText: "", surahName: "" });

  // Build interleaved list on mount
  useEffect(() => {
    (async () => {
    const allSurahs = await getAllSurahs(db);
    const allAyahs = await getAllAyahs(db);
    setSurahs(allSurahs);

    const surahMap = new Map<number, Surah>();
    for (const s of allSurahs) surahMap.set(s.number, s);

    // Group ayahs by surah
    const ayahsBySurah = new Map<number, Ayah[]>();
    for (const ayah of allAyahs) {
      const list = ayahsBySurah.get(ayah.surah);
      if (list) list.push(ayah);
      else ayahsBySurah.set(ayah.surah, [ayah]);
    }

    const items: ListItem[] = [];
    const startIndices = new Map<number, number>();

    for (const surah of allSurahs) {
      startIndices.set(surah.number, items.length);
      items.push({ type: "surah-header", surah });
      const surahAyahs = ayahsBySurah.get(surah.number) ?? [];
      items.push({ type: "surah-text", surah, ayahs: surahAyahs });
    }

    setListData(items);
    setSurahStartIndices(startIndices);

    // Set initial surah name
    if (allSurahs.length > 0) {
      setCurrentSurah(allSurahs[0].name_arabic);
    }
    })();
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
      // If no header is visible, use the surah of the first visible text block
      if (viewableItems.length > 0) {
        const item = viewableItems[0].item;
        if (item.type === "surah-text") {
          setCurrentSurah(item.surah.name_arabic);
        }
      }
    },
    []
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

  const handleAskCommunity = useCallback(
    (ayah: Ayah, surahName: string) => {
      setCreatePostData({
        visible: true,
        surah: ayah.surah,
        ayah: ayah.ayah,
        ayahText: ayah.text_uthmani,
        surahName,
      });
    },
    []
  );

  const closeCreatePost = useCallback(() => {
    setCreatePostData((prev) => ({ ...prev, visible: false }));
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "surah-header") {
        return <SurahHeader surah={item.surah} />;
      }
      return (
        <SurahTextBlock
          ayahs={item.ayahs}
          surahName={item.surah.name_english}
          onLongPress={handleLongPress}
        />
      );
    },
    [handleLongPress]
  );

  const getItemType = useCallback((item: ListItem) => item.type, []);
  const keyExtractor = useCallback(
    (item: ListItem) =>
      item.type === "surah-header"
        ? `header-${item.surah.number}`
        : `text-${item.surah.number}`,
    []
  );

  if (listData.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text variant="muted">Loading Mushaf...</Text>
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
        onAskCommunity={handleAskCommunity}
      />
      <CreatePostModal
        visible={createPostData.visible}
        surah={createPostData.surah}
        ayah={createPostData.ayah}
        ayahText={createPostData.ayahText}
        surahName={createPostData.surahName}
        onClose={closeCreatePost}
        onPostCreated={closeCreatePost}
      />
    </View>
  );
}
