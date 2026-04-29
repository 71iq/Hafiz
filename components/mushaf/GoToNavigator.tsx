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
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";

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
  const s = useStrings();
  const { isDark } = useSettings();
  const [surahs, setSurahs] = useState<SurahRow[]>([]);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [juzList, setJuzList] = useState<JuzInfo[]>([]);
  const [surahPageMap, setSurahPageMap] = useState<Map<number, number>>(
    new Map()
  );
  const [selectedPage, setSelectedPage] = useState(currentPage);
  const [searchText, setSearchText] = useState("");
  // Default to Surah tab regardless of view mode — easier to find a destination
  // by surah name than by raw page number.
  const [tab, setTab] = useState<TabKey>("surah");
  const pickerRef = useRef<FlatList>(null);
  const selectedPageRef = useRef(currentPage);
  const searchTextRef = useRef("");
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const initialScrollDone = useRef(false);
  const suppressPickerScroll = useRef(false);

  useEffect(() => {
    if (!visible) {
      initialScrollDone.current = false;
      suppressPickerScroll.current = false;
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
          db.getAllAsync<{ page: number; surah: number }>(
            `SELECT s.number as surah, MIN(pm.page) as page
             FROM surahs s
             JOIN page_map pm ON pm.surah_start <= s.number AND pm.surah_end >= s.number
             GROUP BY s.number
             ORDER BY s.number`
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
        for (const r of surahPages) map.set(r.surah, r.page);
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

  useEffect(() => {
    if (
      visible &&
      pages.length > 0 &&
      tab === "page" &&
      !initialScrollDone.current
    ) {
      initialScrollDone.current = true;
      suppressPickerScroll.current = true;
      setTimeout(() => {
        pickerRef.current?.scrollToOffset({
          offset: (currentPage - 1) * ITEM_HEIGHT,
          animated: false,
        });
        setTimeout(() => {
          suppressPickerScroll.current = false;
        }, 100);
      }, 100);
    }
  }, [visible, pages.length, tab, currentPage]);

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

      if (suppressPickerScroll.current) return;

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
        <Text
          className="text-warm-400 dark:text-neutral-500"
          style={{ fontSize: 18, fontFamily: "Manrope_500Medium" }}
        >
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
      onGoToSurahVerse(juz.startSurah);
      onClose();
      return;
    }
    onGoToPage(juz.page);
    onClose();
  };

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
      ? s.enterPageNumber
      : tab === "surah"
        ? s.searchByName
        : s.searchByJuz;

  const TAB_ITEMS = [
    ...(showPageTab ? [{ value: "page" as TabKey, label: s.tabPage }] : []),
    { value: "surah" as TabKey, label: s.tabSurah },
    { value: "juz" as TabKey, label: s.tabJuz },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable className="flex-1" style={{ backgroundColor: "rgba(0,0,0,0.3)" }} onPress={onClose}>
        <View className="flex-1" />
        <Pressable
          className="bg-surface dark:bg-surface-dark-low rounded-t-4xl"
          onPress={() => {}}
        >
          {/* Drag handle */}
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 rounded-full bg-surface-high dark:bg-surface-dark-high" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-6 pt-3 pb-4">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 20 }}
            >
              {s.goToTitle}
            </Text>
            <Pressable
              onPress={onClose}
              className="w-9 h-9 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.95 : 1 }],
              })}
            >
              <X size={16} color={isDark ? "#a3a3a3" : "#6e5a47"} />
            </Pressable>
          </View>

          {/* Search bar — no border, tonal background */}
          <View className="mx-6 mb-4">
            <View className="flex-row items-center bg-surface-low dark:bg-surface-dark-mid rounded-2xl px-4 py-3">
              <Search size={16} color={isDark ? "#525252" : "#DFD9D1"} />
              <TextInput
                className="flex-1 ml-2.5 text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
                placeholder={searchPlaceholder}
                placeholderTextColor={isDark ? "#525252" : "#b9a085"}
                value={searchText}
                onChangeText={handleSearchChange}
                onSubmitEditing={handleSearchSubmit}
                returnKeyType={tab === "page" ? "go" : "done"}
                keyboardType={tab === "surah" ? "default" : "number-pad"}
                autoCorrect={false}
              />
              {searchText.length > 0 && (
                <Pressable onPress={() => handleSearchChange("")}>
                  <X size={14} color={isDark ? "#525252" : "#DFD9D1"} />
                </Pressable>
              )}
            </View>
          </View>

          {/* Tab selector — pill toggle group */}
          <View className="flex-row mx-6 mb-5 bg-surface-high dark:bg-surface-dark-high rounded-full p-1">
            {TAB_ITEMS.map((item) => {
              const active = tab === item.value;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => handleTabChange(item.value)}
                  className={`flex-1 py-2.5 rounded-full items-center ${
                    active ? "bg-surface-bright dark:bg-surface-dark-bright" : ""
                  }`}
                  style={({ pressed }) => ({
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  })}
                >
                  <Text
                    className={active
                      ? "text-primary-accent dark:text-primary-bright"
                      : "text-warm-400 dark:text-neutral-500"
                    }
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Page picker wheel */}
          {tab === "page" && pages.length > 0 && (
            <View className="px-6 pb-6">
              <View className="items-center mb-3">
                <Text
                  className="text-primary-accent dark:text-primary-bright"
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 28 }}
                >
                  {toArabicNumber(selectedPage)}
                </Text>
                <Text
                  className="text-charcoal dark:text-neutral-300 mt-1"
                  style={{ fontSize: 22, lineHeight: 36 }}
                >
                  {selectedSurahName}
                </Text>
              </View>

              <View style={{ height: PICKER_HEIGHT, overflow: "hidden" }}>
                {/* Center highlight band — tonal, no border */}
                <View
                  style={{
                    position: "absolute",
                    top: CENTER_OFFSET,
                    left: 0,
                    right: 0,
                    height: ITEM_HEIGHT,
                    zIndex: 1,
                  }}
                  className="bg-primary-accent/8 dark:bg-primary-bright/8 rounded-2xl"
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
                    backgroundColor: isDark ? "rgba(20,20,20,0.6)" : "rgba(255,248,241,0.6)",
                  }}
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
                    backgroundColor: isDark ? "rgba(20,20,20,0.6)" : "rgba(255,248,241,0.6)",
                  }}
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

          {/* Surah list — no borders, use spacing between items */}
          {tab === "surah" && (
            <ScrollView className="px-6 pb-6" style={{ maxHeight: 400 }}>
              {filteredSurahs.length === 0 && (
                <Text
                  className="text-warm-400 dark:text-neutral-500 text-center py-8"
                  style={{ fontFamily: "Manrope_400Regular" }}
                >
                  {s.noSurahsFound}
                </Text>
              )}
              <View className="gap-1.5">
                {filteredSurahs.map((surah) => (
                  <Pressable
                    key={surah.number}
                    onPress={() => handleSelectSurah(surah.number)}
                    className="flex-row items-center py-3 px-3 rounded-2xl"
                    style={({ pressed }) => ({
                      backgroundColor: pressed
                        ? (isDark ? "rgba(45,212,191,0.08)" : "rgba(13,148,136,0.06)")
                        : "transparent",
                    })}
                  >
                    <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center mr-3.5">
                      <Text
                        className="text-primary-accent dark:text-primary-bright"
                        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
                      >
                        {surah.number}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text
                        className="text-charcoal dark:text-neutral-100"
                        style={{ fontFamily: "Manrope_500Medium", fontSize: 15 }}
                      >
                        {surah.name_english}
                      </Text>
                    </View>
                    <Text
                      className="text-charcoal dark:text-neutral-300 text-right"
                      style={{ fontSize: 20, lineHeight: 36 }}
                    >
                      {surah.name_arabic}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}

          {/* Juz' list */}
          {tab === "juz" && (
            <ScrollView className="px-6 pb-6" style={{ maxHeight: 400 }}>
              {filteredJuz.length === 0 && (
                <Text
                  className="text-warm-400 dark:text-neutral-500 text-center py-8"
                  style={{ fontFamily: "Manrope_400Regular" }}
                >
                  {s.noJuzFound}
                </Text>
              )}
              <View className="gap-1.5">
                {filteredJuz.map((juz) => (
                  <Pressable
                    key={juz.juz}
                    onPress={() => handleSelectJuz(juz)}
                    className="flex-row items-center py-3 px-3 rounded-2xl"
                    style={({ pressed }) => ({
                      backgroundColor: pressed
                        ? (isDark ? "rgba(45,212,191,0.08)" : "rgba(13,148,136,0.06)")
                        : "transparent",
                    })}
                  >
                    <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center mr-3.5">
                      <Text
                        className="text-primary-accent dark:text-primary-bright"
                        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
                      >
                        {toArabicNumber(juz.juz)}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text
                        className="text-charcoal dark:text-neutral-100"
                        style={{ fontFamily: "Manrope_500Medium", fontSize: 15 }}
                      >
                        Juz {juz.juz}
                      </Text>
                      <Text
                        className="text-warm-400 dark:text-neutral-500 mt-0.5"
                        style={{ fontFamily: "Manrope_400Regular", fontSize: 12 }}
                      >
                        {juz.surahNameEnglish} {juz.startSurah}:{juz.startAyah}
                      </Text>
                    </View>
                    <Text
                      className="text-charcoal dark:text-neutral-300 text-right"
                      style={{ fontSize: 20, lineHeight: 36 }}
                    >
                      {juz.surahNameArabic}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
