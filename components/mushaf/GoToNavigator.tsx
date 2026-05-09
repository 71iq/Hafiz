import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, TextInput, Platform } from "react-native";
import { X, Search } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { toArabicNumber } from "@/lib/arabic";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { ResponsiveOverlay, OverlayHeader, OverlayBody } from "@/components/ui/ResponsiveOverlay";

type SurahRow = {
  number: number;
  name_arabic: string;
  name_english: string;
};

type JuzInfo = {
  juz: number;
  startSurah: number;
  startAyah: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  page: number;
};

type TabKey = "surah" | "juz";

type Props = {
  visible: boolean;
  onClose: () => void;
  onGoToPage: (page: number) => void;
  mode: "verse" | "page";
  currentPage?: number;
  onGoToSurahVerse?: (surahNumber: number) => void;
};

export function GoToNavigator({
  visible,
  onClose,
  onGoToPage,
  mode,
  onGoToSurahVerse,
}: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const [surahs, setSurahs] = useState<SurahRow[]>([]);
  const [juzList, setJuzList] = useState<JuzInfo[]>([]);
  const [surahPageMap, setSurahPageMap] = useState<Map<number, number>>(new Map());
  const [searchText, setSearchText] = useState("");
  const [tab, setTab] = useState<TabKey>("surah");

  useEffect(() => {
    if (!visible) return;
    setSearchText("");
    setTab("surah");

    async function load() {
      try {
        const [surahRows, surahPages, juzRows] = await Promise.all([
          db.getAllAsync<SurahRow>(
            "SELECT number, name_arabic, name_english FROM surahs ORDER BY number"
          ),
          db.getAllAsync<{ page: number; surah: number }>(
            `SELECT surah, MIN(v2_page) as page
             FROM quran_text
             GROUP BY surah
             ORDER BY surah`
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
               CAST(j_start.sk / 10000 AS INTEGER) as start_surah,
               (j_start.sk % 10000) as start_ayah,
               s.name_arabic as surah_name_arabic,
               s.name_english as surah_name_english,
               qt.v2_page as page
             FROM (
               SELECT juz, MIN(surah * 10000 + ayah_start) as sk
               FROM juz_map GROUP BY juz
             ) j_start
             JOIN surahs s ON s.number = CAST(j_start.sk / 10000 AS INTEGER)
             JOIN quran_text qt ON
               qt.surah = CAST(j_start.sk / 10000 AS INTEGER)
               AND qt.ayah = (j_start.sk % 10000)
             ORDER BY j_start.juz`
          ),
        ]);

        setSurahs(surahRows);
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
  }, [db, visible]);

  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
  }, []);

  const handleTabChange = useCallback((newTab: TabKey) => {
    setTab(newTab);
    setSearchText("");
  }, []);

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
    ? surahs.filter((surah) =>
        isNumeric
          ? String(surah.number).startsWith(searchText)
          : surah.name_english.toLowerCase().includes(searchText.toLowerCase()) ||
            surah.name_arabic.includes(searchText)
      )
    : surahs;

  const filteredJuz = searchText
    ? juzList.filter((juz) =>
        isNumeric
          ? String(juz.juz).startsWith(searchText)
          : juz.surahNameEnglish.toLowerCase().includes(searchText.toLowerCase()) ||
            juz.surahNameArabic.includes(searchText)
      )
    : juzList;

  const searchPlaceholder = tab === "surah" ? s.searchByName : s.searchByJuz;
  const tabItems = [
    { value: "surah" as TabKey, label: s.tabSurah },
    { value: "juz" as TabKey, label: s.tabJuz },
  ];

  const renderSurahList = () => (
    <>
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
            className={`items-center py-3 px-3 rounded-2xl ${isRTL ? "flex-row-reverse" : "flex-row"}`}
            style={({ pressed }) => ({
              backgroundColor: pressed
                ? isDark
                  ? "rgba(45,212,191,0.08)"
                  : "rgba(13,148,136,0.06)"
                : "transparent",
            })}
          >
            <View
              className={`w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center ${isRTL ? "ml-3.5" : "mr-3.5"}`}
            >
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
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 15,
                  textAlign: isRTL ? "right" : "left",
                }}
              >
                {surah.name_english}
              </Text>
            </View>
            <Text
              className="text-charcoal dark:text-neutral-300"
              style={{ fontSize: 20, lineHeight: 36, writingDirection: "rtl", paddingHorizontal: 6, textAlign: "right" }}
            >
              {surah.name_arabic}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );

  const renderJuzList = () => (
    <>
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
            className={`items-center py-3 px-3 rounded-2xl ${isRTL ? "flex-row-reverse" : "flex-row"}`}
            style={({ pressed }) => ({
              backgroundColor: pressed
                ? isDark
                  ? "rgba(45,212,191,0.08)"
                  : "rgba(13,148,136,0.06)"
                : "transparent",
            })}
          >
            <View
              className={`w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center ${isRTL ? "ml-3.5" : "mr-3.5"}`}
            >
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
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 15,
                  textAlign: isRTL ? "right" : "left",
                }}
              >
                {isRTL ? `${s.tabJuz} ${toArabicNumber(juz.juz)}` : `Juz ${juz.juz}`}
              </Text>
              <Text
                className="text-warm-400 dark:text-neutral-500 mt-0.5"
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 12,
                  textAlign: isRTL ? "right" : "left",
                }}
              >
                {juz.surahNameEnglish} {juz.startSurah}:{juz.startAyah}
              </Text>
            </View>
            <Text
              className="text-charcoal dark:text-neutral-300"
              style={{ fontSize: 20, lineHeight: 36, writingDirection: "rtl", paddingHorizontal: 6, textAlign: "right" }}
            >
              {juz.surahNameArabic}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );

  return (
    <ResponsiveOverlay
      open={visible}
      onClose={onClose}
      phonePresentation="dialog"
      desktopPresentation="dialog"
      maxWidth={520}
      maxHeight="88%"
      dismissOnBackdrop
      surfaceColor={isDark ? "#1C1917" : "#FFF8F1"}
    >
      <OverlayHeader title={s.goToTitle} onClose={onClose} isRTL={isRTL} />

      <View className="bg-surface dark:bg-surface-dark px-5 pt-4">
        <View
          className={`items-center bg-surface-low dark:bg-surface-dark-mid rounded-2xl px-4 py-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
        >
          <Search size={16} color={isDark ? "#525252" : "#DFD9D1"} />
          <TextInput
            className={`flex-1 text-charcoal dark:text-neutral-100 ${isRTL ? "mr-2.5" : "ml-2.5"}`}
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 15,
              textAlign: isRTL ? "right" : "left",
              writingDirection: isRTL ? "rtl" : "ltr",
              ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
            }}
            placeholder={searchPlaceholder}
            placeholderTextColor={isDark ? "#525252" : "#b9a085"}
            value={searchText}
            onChangeText={handleSearchChange}
            returnKeyType="done"
            keyboardType={tab === "surah" ? "default" : "number-pad"}
            autoCorrect={false}
          />
          {searchText.length > 0 && (
            <Pressable onPress={() => handleSearchChange("")}>
              <X size={14} color={isDark ? "#525252" : "#DFD9D1"} />
            </Pressable>
          )}
        </View>

        <View className={`mt-4 mb-3 bg-surface-high dark:bg-surface-dark-high rounded-full p-1 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
          {tabItems.map((item) => {
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
      </View>

      <OverlayBody
        className="bg-surface dark:bg-surface-dark px-5"
        contentContainerClassName="bg-surface dark:bg-surface-dark pb-6"
      >
        <View className="bg-surface dark:bg-surface-dark">
          {tab === "surah" ? renderSurahList() : renderJuzList()}
        </View>
      </OverlayBody>
    </ResponsiveOverlay>
  );
}
