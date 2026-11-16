import { useState, useEffect, useCallback, useMemo } from "react";
import { View, Text, Pressable, TextInput, Platform, useWindowDimensions } from "react-native";
import { X, Search, CornerDownLeft } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { formatAyahRef, toArabicNumber } from "@/lib/arabic";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { parseReference } from "@/lib/search/reference";
import { useSettings } from "@/lib/settings/context";
import { ResponsiveOverlay, OverlayHeader, OverlayBody } from "@/components/ui/ResponsiveOverlay";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { matchesSurahQuery } from "@/lib/search/surah-match";
import { textStartStyle, inputTextStartStyle } from "@/lib/ui/direction";

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

export type GoToTab = "surah" | "juz";

export type GoToTarget = { kind: "ayah"; surah: number; ayah: number } | { kind: "page"; page: number };

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelectTarget: (target: GoToTarget) => void;
  initialTab?: GoToTab;
};

export function GoToNavigator({
  visible,
  onClose,
  onSelectTarget,
  initialTab = "surah",
}: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const { width, height } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const overlayMaxHeight = isPhone ? "88%" : Math.min(Math.floor(height * 0.88), 820);
  const [surahs, setSurahs] = useState<SurahRow[]>([]);
  const [juzList, setJuzList] = useState<JuzInfo[]>([]);
  const [searchText, setSearchText] = useState("");
  const [tab, setTab] = useState<GoToTab>(initialTab);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const isArabicUI = isRTL;
  const digits = (value: number) => (isArabicUI ? toArabicNumber(value) : String(value));

  useEffect(() => {
    if (!visible) return;
    setSearchText("");
    setTab(initialTab);
  }, [initialTab, visible]);

  useEffect(() => {
    if (!visible) return;
    setLoadError(null);
    let cancelled = false;

    async function load() {
      try {
        const [surahRows, juzRows] = await Promise.all([
          db.getAllAsync<SurahRow>(
            "SELECT number, name_arabic, name_english FROM surahs ORDER BY number"
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

        if (cancelled) return;
        setSurahs(surahRows);
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
        if (!cancelled) setLoadError(s.goToLoadFailed);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [db, visible, s.goToLoadFailed, loadAttempt]);

  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
  }, []);

  const handleTabChange = useCallback((newTab: GoToTab) => {
    setTab(newTab);
    setSearchText("");
  }, []);

  const handleSelectSurah = (surahNumber: number) => {
    onSelectTarget({ kind: "ayah", surah: surahNumber, ayah: 1 });
  };

  const handleSelectJuz = (juz: JuzInfo) => {
    onSelectTarget({ kind: "ayah", surah: juz.startSurah, ayah: juz.startAyah });
  };

  const reference = useMemo(() => {
    const parsed = parseReference(searchText, { context: "goto" });
    if (parsed.kind === "ayah") {
      return {
        target: { kind: "ayah", surah: parsed.surah, ayah: parsed.ayah } as GoToTarget,
        label: interpolate(s.goToAyahRow, { ref: formatAyahRef(isArabicUI, parsed.surah, parsed.ayah) }),
      };
    }
    if (parsed.kind === "page") {
      return {
        target: { kind: "page", page: parsed.page } as GoToTarget,
        label: interpolate(s.goToPageRow, { page: digits(parsed.page) }),
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArabicUI, s.goToAyahRow, s.goToPageRow, searchText]);

  const filteredSurahs = searchText ? surahs.filter((surah) => matchesSurahQuery(surah, searchText)) : surahs;

  const juzNumberQuery = /^[\d٠-٩]+$/.test(searchText.trim());
  const filteredJuz = searchText
    ? juzList.filter((juz) =>
        juzNumberQuery
          ? matchesSurahQuery({ number: juz.juz, name_arabic: "", name_english: "" }, searchText)
          : matchesSurahQuery(
              { number: juz.startSurah, name_arabic: juz.surahNameArabic, name_english: juz.surahNameEnglish },
              searchText,
            ),
      )
    : juzList;

  const searchPlaceholder = tab === "surah" ? s.searchByName : s.searchByJuz;
  const tabItems = [
    { value: "surah" as GoToTab, label: s.tabSurah },
    { value: "juz" as GoToTab, label: s.tabJuz },
  ];

  const renderReferenceRow = () =>
    reference ? (
      <Pressable
        onPress={() => onSelectTarget(reference.target)}
        accessibilityRole="button"
        accessibilityLabel={reference.label}
        className={`mb-2 min-h-[44px] items-center gap-3 rounded-2xl bg-primary-accent/10 dark:bg-primary-bright/10 px-4 py-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
      >
        <CornerDownLeft size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />
        <Text
          className="flex-1 text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {reference.label}
        </Text>
      </Pressable>
    ) : null;

  const renderSurahList = () => (
    <>
      {renderReferenceRow()}
      {filteredSurahs.length === 0 && !reference && (
        <View className="items-center gap-1 py-8">
          <Text
            className="text-warm-500 dark:text-neutral-400 text-center"
            style={{ fontFamily: "Manrope_500Medium" }}
          >
            {s.noSurahsFound}
          </Text>
          <Text
            className="text-warm-500 dark:text-neutral-400 text-center"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 13, writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {s.goToNoSurahsHint}
          </Text>
        </View>
      )}
      <View className="gap-1.5">
        {filteredSurahs.map((surah) => (
          <Pressable
            key={surah.number}
            onPress={() => handleSelectSurah(surah.number)}
            accessibilityRole="button"
            accessibilityLabel={`${digits(surah.number)} ${isArabicUI ? surah.name_arabic : surah.name_english}`}
            className={`min-h-[44px] items-center gap-3.5 py-3 px-3 rounded-2xl ${isRTL ? "flex-row-reverse" : "flex-row"}`}
            style={({ pressed }) => ({
              backgroundColor: pressed
                ? isDark
                  ? "rgba(45,212,191,0.08)"
                  : "rgba(13,148,136,0.06)"
                : "transparent",
            })}
          >
            <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
              >
                {digits(surah.number)}
              </Text>
            </View>
            <View className="flex-1">
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: isArabicUI ? 18 : 15,
                  lineHeight: isArabicUI ? 32 : 22,
                  paddingHorizontal: isArabicUI ? 4 : 0,
                  ...textStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {isArabicUI ? surah.name_arabic : surah.name_english}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </>
  );

  const renderJuzList = () => (
    <>
      {renderReferenceRow()}
      {filteredJuz.length === 0 && !reference && (
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
            accessibilityRole="button"
            accessibilityLabel={`${s.tabJuz} ${digits(juz.juz)}`}
            className={`min-h-[44px] items-center gap-3.5 py-3 px-3 rounded-2xl ${isRTL ? "flex-row-reverse" : "flex-row"}`}
            style={({ pressed }) => ({
              backgroundColor: pressed
                ? isDark
                  ? "rgba(45,212,191,0.08)"
                  : "rgba(13,148,136,0.06)"
                : "transparent",
            })}
          >
            <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
              >
                {digits(juz.juz)}
              </Text>
            </View>
            <View className="flex-1">
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 15,
                  ...textStartStyle(isRTL),
                }}
              >
                {`${s.tabJuz} ${digits(juz.juz)}`}
              </Text>
              <Text
                className="text-warm-400 dark:text-neutral-500 mt-0.5"
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 12,
                  ...textStartStyle(isRTL),
                }}
              >
                {isArabicUI ? juz.surahNameArabic : juz.surahNameEnglish} {formatAyahRef(isArabicUI, juz.startSurah, juz.startAyah)}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </>
  );

  return (
    <ResponsiveOverlay
      open={visible}
      onClose={onClose}
      phonePresentation="sheet"
      desktopPresentation="dialog"
      maxWidth={560}
      maxHeight={overlayMaxHeight}
      dismissOnBackdrop
      dismissOnEscape
    >
      <OverlayHeader title={s.goToTitle} onClose={onClose} showHandle={isPhone} isRTL={isRTL} />

      <View className="bg-surface dark:bg-surface-dark px-5 pt-4">
        <View
          className={`items-center gap-2.5 bg-surface-low dark:bg-surface-dark-mid rounded-2xl px-4 py-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
        >
          <Search size={16} color={isDark ? "#525252" : "#DFD9D1"} />
          <TextInput
            className="flex-1 text-charcoal dark:text-neutral-100"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 15,
              ...inputTextStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
              ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
            }}
            placeholder={searchPlaceholder}
            placeholderTextColor={isDark ? "#525252" : "#b9a085"}
            value={searchText}
            onChangeText={handleSearchChange}
            returnKeyType="go"
            onSubmitEditing={() => {
              if (reference) onSelectTarget(reference.target);
            }}
            accessibilityLabel={searchPlaceholder}
            autoCorrect={false}
          />
          {searchText.length > 0 && (
            <Pressable
              onPress={() => handleSearchChange("")}
              accessibilityRole="button"
              accessibilityLabel={s.readerClearSearch}
              className="h-11 w-11 items-center justify-center"
            >
              <X size={14} color={isDark ? "#a3a3a3" : "#8B7563"} />
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
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                className={`flex-1 min-h-[44px] justify-center py-2.5 rounded-full items-center ${
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
          {loadError ? (
            <View className="items-center gap-3 py-8">
              <Text
                className="text-center text-red-600 dark:text-red-400"
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 13,
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {loadError}
              </Text>
              <Pressable
                onPress={() => setLoadAttempt((attempt) => attempt + 1)}
                accessibilityRole="button"
                className="min-h-[44px] justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-5"
              >
                <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                  {s.errorTryAgain}
                </Text>
              </Pressable>
            </View>
          ) : tab === "surah" ? renderSurahList() : renderJuzList()}
        </View>
      </OverlayBody>
    </ResponsiveOverlay>
  );
}
