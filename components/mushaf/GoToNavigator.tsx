import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  ScrollView,
  TextInput,
} from "react-native";
import { X, Search } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { toArabicNumber } from "@/lib/arabic";

type SurahRow = {
  number: number;
  name_arabic: string;
  name_english: string;
};

type PageInfo = {
  page: number;
  surahName: string;
};

type JuzInfo = {
  juz: number;
  startSurah: number;
  startAyah: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  page: number;
};

type TabKey = "page" | "surah" | "juz";

type Props = {
  visible: boolean;
  onClose: () => void;
  onGoToPage: (page: number) => void;
  mode: "verse" | "page";
  currentPage?: number;
  onGoToSurahVerse?: (surahNumber: number) => void;
};

const ITEM_HEIGHT = 48;
const VISIBLE_ITEMS = 7;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const CENTER_OFFSET = ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2);



export function GoToNavigator({
  visible,
  onClose,
  onGoToPage,
  mode,
  currentPage = 1,
  onGoToSurahVerse,
}: Props) {
  const db = useDatabase();
  const [surahs, setSurahs] = useState<SurahRow[]>([]);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [juzList, setJuzList] = useState<JuzInfo[]>([]);
  const [surahPageMap, setSurahPageMap] = useState<Map<number, number>>(
    new Map()
  );
  const [selectedPage, setSelectedPage] = useState(currentPage);
  const [searchText, setSearchText] = useState("");
  const [tab, setTab] = useState<TabKey>(
    mode === "page" ? "page" : "surah"
  );
  const pickerRef = useRef<FlatList>(null);
  const selectedPageRef = useRef(currentPage);
  const searchTextRef = useRef("");
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const initialScrollDone = useRef(false);

  // Load data when modal opens
  useEffect(() => {
    if (!visible) {
      initialScrollDone.current = false;
      if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
      return;
    }
    setSelectedPage(currentPage);
    selectedPageRef.current = currentPage;
    setSearchText("");
    searchTextRef.current = "";
    setTab(mode === "page" ? "page" : "surah");

    async function load() {
      try {
        const [surahRows, pageRows, surahPages, juzRows] = await Promise.all([
          db.getAllAsync<SurahRow>(
            "SELECT number, name_arabic, name_english FROM surahs ORDER BY number"
          ),
          db.getAllAsync<{ page: number; name_arabic: string }>(
            `SELECT pm.page, s.name_arabic
             FROM page_map pm
             JOIN surahs s ON s.number = pm.surah_start
             ORDER BY pm.page`
          ),
          db.getAllAsync<{ page: number; surah_start: number }>(
            "SELECT MIN(page) as page, surah_start FROM page_map GROUP BY surah_start ORDER BY surah_start"
          ),
          db.getAllAsync<{
            juz: number;
            start_surah: number;
            start_ayah: number;
            surah_name_arabic: string;
            surah_name_english: string;
            page: number;
          }>(
            `SELECT
               j_start.juz,
               (j_start.sk / 10000) as start_surah,
               (j_start.sk % 10000) as start_ayah,
               s.name_arabic as surah_name_arabic,
               s.name_english as surah_name_english,
               pm.page
             FROM (
               SELECT juz, MIN(surah * 10000 + ayah_start) as sk
               FROM juz_map GROUP BY juz
             ) j_start
             JOIN surahs s ON s.number = (j_start.sk / 10000)
             JOIN page_map pm ON
               (pm.surah_start * 10000 + pm.ayah_start) <= j_start.sk
               AND (pm.surah_end * 10000 + pm.ayah_end) >= j_start.sk
             ORDER BY j_start.juz`
          ),
        ]);

        setSurahs(surahRows);
        setPages(
          pageRows.map((r) => ({ page: r.page, surahName: r.name_arabic }))
        );
        const map = new Map<number, number>();
        for (const r of surahPages) map.set(r.surah_start, r.page);
        setSurahPageMap(map);
        setJuzList(
          juzRows.map((r) => ({
            juz: r.juz,
            startSurah: r.start_surah,
            startAyah: r.start_ayah,
            surahNameArabic: r.surah_name_arabic,
            surahNameEnglish: r.surah_name_english,
            page: r.page,
          }))
        );
      } catch (err) {
        console.error("[GoToNavigator] Failed to load data:", err);
      }
    }
    load();
  }, [db, visible, currentPage, mode]);

  // Scroll picker to current page on first render
  useEffect(() => {
    if (
      visible &&
      pages.length > 0 &&
      tab === "page" &&
      !initialScrollDone.current
    ) {
      initialScrollDone.current = true;
      setTimeout(() => {
        pickerRef.current?.scrollToOffset({
          offset: (currentPage - 1) * ITEM_HEIGHT,
          animated: false,
        });
      }, 100);
    }
  }, [visible, pages.length, tab, currentPage]);

  // Search-driven scroll for page picker
  useEffect(() => {
    if (tab !== "page" || !searchText) return;
    const num = parseInt(searchText, 10);
    if (num >= 1 && num <= 604) {
      pickerRef.current?.scrollToOffset({
        offset: (num - 1) * ITEM_HEIGHT,
        animated: false,
      });
    }
  }, [searchText, tab]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    };
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
    searchTextRef.current = text;
  }, []);

  const handleTabChange = useCallback((newTab: TabKey) => {
    setTab(newTab);
    setSearchText("");
    searchTextRef.current = "";
  }, []);

  const handlePickerScroll = useCallback(
    (e: any) => {
      const y = e.nativeEvent.contentOffset.y;
      const index = Math.round(y / ITEM_HEIGHT);
      const page = Math.max(1, Math.min(604, index + 1));
      selectedPageRef.current = page;
      setSelectedPage(page);

      // Auto-navigate only for manual scrolling (no search text active)
      if (!searchTextRef.current) {
        if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
        scrollEndTimer.current = setTimeout(() => {
          onGoToPage(selectedPageRef.current);
        }, 500);
      }
    },
    [onGoToPage]
  );

  const handleSearchSubmit = useCallback(() => {
    if (tab === "page") {
      const num = parseInt(searchText, 10);
      if (num >= 1 && num <= 604) {
        onGoToPage(num);
        onClose();
      }
    }
  }, [tab, searchText, onGoToPage, onClose]);

  const getPickerItemLayout = useCallback(
    (_: any, index: number) => ({
      length: ITEM_HEIGHT,
      offset: ITEM_HEIGHT * index,
      index,
    }),
    []
  );

  const renderPickerItem = useCallback(
    ({ item }: { item: PageInfo }) => (
      <View
        style={{
          height: ITEM_HEIGHT,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "500", color: "#78716c" }}>
          {toArabicNumber(item.page)}
        </Text>
      </View>
    ),
    []
  );

  const pickerKeyExtractor = useCallback(
    (item: PageInfo) => `p-${item.page}`,
    []
  );

  const handleSelectSurah = (surahNumber: number) => {
    if (mode === "verse" && onGoToSurahVerse) {
      onGoToSurahVerse(surahNumber);
      onClose();
      return;
    }
    const page = surahPageMap.get(surahNumber);
    if (page) {
      onGoToPage(page);
      onClose();
    }
  };

  const handleSelectJuz = (juz: JuzInfo) => {
    if (mode === "verse" && onGoToSurahVerse) {
      // In verse mode, scroll to the surah containing juz start
      onGoToSurahVerse(juz.startSurah);
      onClose();
      return;
    }
    onGoToPage(juz.page);
    onClose();
  };

  // Filtered lists
  const isNumeric = /^\d+$/.test(searchText);

  const filteredSurahs = searchText
    ? surahs.filter((s) =>
        isNumeric
          ? String(s.number).startsWith(searchText)
          : s.name_english
              .toLowerCase()
              .includes(searchText.toLowerCase()) ||
            s.name_arabic.includes(searchText)
      )
    : surahs;

  const filteredJuz = searchText
    ? juzList.filter((j) =>
        isNumeric
          ? String(j.juz).startsWith(searchText)
          : j.surahNameEnglish
              .toLowerCase()
              .includes(searchText.toLowerCase()) ||
            j.surahNameArabic.includes(searchText)
      )
    : juzList;

  const selectedSurahName = pages[selectedPage - 1]?.surahName ?? "";

  const showPageTab = mode === "page";

  const searchPlaceholder =
    tab === "page"
      ? "Enter page number..."
      : tab === "surah"
        ? "Search by name or number..."
        : "Search by juz number...";

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable className="flex-1 bg-black/50" onPress={onClose}>
        <View className="flex-1" />
        <Pressable
          className="bg-warm-50 dark:bg-neutral-900 rounded-t-3xl"
          onPress={() => {}}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
            <Text className="text-lg font-bold text-warm-800 dark:text-neutral-100">
              Go To
            </Text>
            <Pressable
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-warm-100 dark:bg-neutral-800 items-center justify-center"
            >
              <X size={16} className="text-warm-600 dark:text-neutral-400" />
            </Pressable>
          </View>

          {/* Search bar */}
          <View className="mx-5 mb-3">
            <View className="flex-row items-center bg-white dark:bg-neutral-800 border border-warm-200 dark:border-neutral-700 rounded-xl px-3 py-2.5">
              <Search size={16} color="#b9a085" />
              <TextInput
                className="flex-1 ml-2 text-base text-warm-900 dark:text-neutral-100"
                placeholder={searchPlaceholder}
                placeholderTextColor="#b9a085"
                value={searchText}
                onChangeText={handleSearchChange}
                onSubmitEditing={handleSearchSubmit}
                returnKeyType={tab === "page" ? "go" : "done"}
                keyboardType={tab === "surah" ? "default" : "number-pad"}
                autoCorrect={false}
              />
              {searchText.length > 0 && (
                <Pressable onPress={() => handleSearchChange("")}>
                  <X size={14} color="#b9a085" />
                </Pressable>
              )}
            </View>
          </View>

          {/* Tab selector */}
          <View className="flex-row mx-5 mb-4 bg-warm-100 dark:bg-neutral-800 rounded-xl p-1">
            {showPageTab && (
              <Pressable
                onPress={() => handleTabChange("page")}
                className={`flex-1 py-2 rounded-lg items-center ${
                  tab === "page" ? "bg-white dark:bg-neutral-700" : ""
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    tab === "page"
                      ? "text-teal-600 dark:text-teal-400"
                      : "text-warm-400 dark:text-neutral-500"
                  }`}
                >
                  Page
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => handleTabChange("surah")}
              className={`flex-1 py-2 rounded-lg items-center ${
                tab === "surah" ? "bg-white dark:bg-neutral-700" : ""
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  tab === "surah"
                    ? "text-teal-600 dark:text-teal-400"
                    : "text-warm-400 dark:text-neutral-500"
                }`}
              >
                Surah
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleTabChange("juz")}
              className={`flex-1 py-2 rounded-lg items-center ${
                tab === "juz" ? "bg-white dark:bg-neutral-700" : ""
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  tab === "juz"
                    ? "text-teal-600 dark:text-teal-400"
                    : "text-warm-400 dark:text-neutral-500"
                }`}
              >
                Juz'
              </Text>
            </Pressable>
          </View>

          {/* Page picker wheel */}
          {tab === "page" && pages.length > 0 && (
            <View className="px-5 pb-6">
              {/* Selected page info */}
              <View className="items-center mb-3">
                <Text className="text-3xl font-bold text-teal-600 dark:text-teal-400">
                  {toArabicNumber(selectedPage)}
                </Text>
                <Text
                  className="text-warm-700 dark:text-neutral-300 mt-1"
                  style={{
                    fontFamily: "UthmanicHafs",
                    fontSize: 22,
                    lineHeight: 36,
                  }}
                >
                  {selectedSurahName}
                </Text>
              </View>

              {/* Wheel */}
              <View style={{ height: PICKER_HEIGHT, overflow: "hidden" }}>
                {/* Center highlight band */}
                <View
                  style={{
                    position: "absolute",
                    top: CENTER_OFFSET,
                    left: 0,
                    right: 0,
                    height: ITEM_HEIGHT,
                    zIndex: 1,
                  }}
                  className="bg-teal-50 dark:bg-teal-900/20 rounded-xl border border-teal-200 dark:border-teal-800"
                  pointerEvents="none"
                />

                {/* Top fade */}
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: CENTER_OFFSET,
                    zIndex: 2,
                  }}
                  className="bg-warm-50/60 dark:bg-neutral-900/60"
                  pointerEvents="none"
                />

                {/* Bottom fade */}
                <View
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: CENTER_OFFSET,
                    zIndex: 2,
                  }}
                  className="bg-warm-50/60 dark:bg-neutral-900/60"
                  pointerEvents="none"
                />

                <FlatList
                  ref={pickerRef}
                  data={pages}
                  renderItem={renderPickerItem}
                  keyExtractor={pickerKeyExtractor}
                  getItemLayout={getPickerItemLayout}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={ITEM_HEIGHT}
                  decelerationRate="fast"
                  onScroll={handlePickerScroll}
                  scrollEventThrottle={16}
                  contentContainerStyle={{
                    paddingTop: CENTER_OFFSET,
                    paddingBottom: CENTER_OFFSET,
                  }}
                  initialNumToRender={20}
                  maxToRenderPerBatch={20}
                  windowSize={11}
                />
              </View>
            </View>
          )}

          {/* Surah list */}
          {tab === "surah" && (
            <ScrollView className="px-5 pb-6" style={{ maxHeight: 400 }}>
              {filteredSurahs.length === 0 && (
                <Text className="text-warm-400 dark:text-neutral-500 text-center py-8">
                  No surahs found
                </Text>
              )}
              {filteredSurahs.map((surah) => (
                <Pressable
                  key={surah.number}
                  onPress={() => handleSelectSurah(surah.number)}
                  className="flex-row items-center py-3 border-b border-warm-100 dark:border-neutral-800"
                >
                  <View className="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-900/40 items-center justify-center border border-teal-200 dark:border-teal-700 mr-3">
                    <Text className="text-teal-700 dark:text-teal-300 text-xs font-semibold">
                      {surah.number}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-base text-warm-800 dark:text-neutral-100 font-medium">
                      {surah.name_english}
                    </Text>
                  </View>
                  <Text
                    className="text-warm-700 dark:text-neutral-300 text-right"
                    style={{
                      fontFamily: "UthmanicHafs",
                      fontSize: 20,
                      lineHeight: 36,
                    }}
                  >
                    {surah.name_arabic}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* Juz' list */}
          {tab === "juz" && (
            <ScrollView className="px-5 pb-6" style={{ maxHeight: 400 }}>
              {filteredJuz.length === 0 && (
                <Text className="text-warm-400 dark:text-neutral-500 text-center py-8">
                  No juz' found
                </Text>
              )}
              {filteredJuz.map((juz) => (
                <Pressable
                  key={juz.juz}
                  onPress={() => handleSelectJuz(juz)}
                  className="flex-row items-center py-3 border-b border-warm-100 dark:border-neutral-800"
                >
                  <View className="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-900/40 items-center justify-center border border-teal-200 dark:border-teal-700 mr-3">
                    <Text className="text-teal-700 dark:text-teal-300 text-xs font-semibold">
                      {toArabicNumber(juz.juz)}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-base text-warm-800 dark:text-neutral-100 font-medium">
                      Juz {juz.juz}
                    </Text>
                    <Text className="text-xs text-warm-400 dark:text-neutral-500 mt-0.5">
                      {juz.surahNameEnglish} {juz.startSurah}:{juz.startAyah}
                    </Text>
                  </View>
                  <Text
                    className="text-warm-700 dark:text-neutral-300 text-right"
                    style={{
                      fontFamily: "UthmanicHafs",
                      fontSize: 20,
                      lineHeight: 36,
                    }}
                  >
                    {juz.surahNameArabic}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
