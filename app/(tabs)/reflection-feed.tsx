import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronDown, MessageSquare, Search, X } from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReflectionsSkeleton } from "@/components/ui/Skeleton";
import { Toast } from "@/components/ui/Toast";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { ReflectionCard } from "@/components/reflections/ReflectionCard";
import { CommentsSheet } from "@/components/reflections/CommentsSheet";
import { useScreenContentLayout } from "@/components/ui/ScreenContent";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { fetchReflectionFeed } from "@/lib/reflections/api";
import type { Reflection, ReflectionFeedFilter, ReflectionFeedSort, ReflectionJuzRange } from "@/lib/reflections/types";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { setPendingDeepLink } from "@/lib/deep-link";
import { toArabicNumber } from "@/lib/arabic";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";

type SurahOption = {
  number: number;
  nameArabic: string;
  nameEnglish: string;
};

type JuzOption = {
  juz: number;
  startSurah: number;
  startAyah: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  ranges: ReflectionJuzRange[];
};

type FilterKind = "none" | "surah" | "juz";
type PickerMode = "filter-kind" | "location" | "sort" | null;

type FilterOptions = {
  surahs: SurahOption[];
  juz: JuzOption[];
};

const REFLECTION_FEED_MAX_WIDTH = 640;

export default function ReflectionFeedScreen() {
  const db = useDatabase();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { width } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const { contentContainerStyle, railStyle } = useScreenContentLayout({
    maxWidth: REFLECTION_FEED_MAX_WIDTH,
  });
  const s = useStrings();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();
  const [filterKind, setFilterKind] = useState<FilterKind>("none");
  const [selectedSurah, setSelectedSurah] = useState<number | null>(null);
  const [selectedJuz, setSelectedJuz] = useState<number | null>(null);
  const [sort, setSort] = useState<ReflectionFeedSort>("newest");
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [commentsReflectionId, setCommentsReflectionId] = useState<string | null>(null);
  const [commentDeltas, setCommentDeltas] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<string | null>(null);
  const normalizedSearchQuery = searchQuery.trim().replace(/\s+/g, " ").slice(0, 120);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchText);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { data: options = { surahs: [], juz: [] } } = useQuery({
    queryKey: ["reflectionFeedOptions", uiLanguage],
    queryFn: async (): Promise<FilterOptions> => {
      const [surahs, juzRows, juzRanges] = await Promise.all([
        db.getAllAsync<{ number: number; name_arabic: string; name_english: string }>(
          "SELECT number, name_arabic, name_english FROM surahs ORDER BY number"
        ),
        db.getAllAsync<{
          juz: number;
          start_surah: number;
          start_ayah: number;
          surah_name_arabic: string;
          surah_name_english: string;
        }>(
          `SELECT
             j_start.juz,
             CAST(j_start.sk / 10000 AS INTEGER) as start_surah,
             (j_start.sk % 10000) as start_ayah,
             s.name_arabic as surah_name_arabic,
             s.name_english as surah_name_english
           FROM (
             SELECT juz, MIN(surah * 10000 + ayah_start) as sk
             FROM juz_map GROUP BY juz
           ) j_start
           JOIN surahs s ON s.number = CAST(j_start.sk / 10000 AS INTEGER)
           ORDER BY j_start.juz`
        ),
        db.getAllAsync<ReflectionJuzRange>(
          "SELECT juz, surah, ayah_start, ayah_end FROM juz_map ORDER BY juz, surah, ayah_start"
        ),
      ]);
      const rangesByJuz = new Map<number, ReflectionJuzRange[]>();
      for (const range of juzRanges) {
        const ranges = rangesByJuz.get(range.juz) ?? [];
        ranges.push(range);
        rangesByJuz.set(range.juz, ranges);
      }

      return {
        surahs: surahs.map((row) => ({
          number: row.number,
          nameArabic: row.name_arabic,
          nameEnglish: row.name_english,
        })),
        juz: juzRows.map((row) => ({
          juz: row.juz,
          startSurah: row.start_surah,
          startAyah: row.start_ayah,
          surahNameArabic: row.surah_name_arabic,
          surahNameEnglish: row.surah_name_english,
          ranges: rangesByJuz.get(row.juz) ?? [],
        })),
      };
    },
    staleTime: Infinity,
  });

  const filter = useMemo<ReflectionFeedFilter>(
    () => {
      if (filterKind === "surah" && selectedSurah !== null) return { type: "surah", surah: selectedSurah };
      if (filterKind === "juz" && selectedJuz !== null) return { type: "juz", juz: selectedJuz };
      return { type: "all" };
    },
    [filterKind, selectedJuz, selectedSurah]
  );

  const selectedJuzRanges = useMemo(
    () => (filterKind === "juz" && selectedJuz !== null ? options.juz.find((juz) => juz.juz === selectedJuz)?.ranges : undefined),
    [filterKind, options.juz, selectedJuz]
  );

  const feedQuery = useInfiniteQuery({
    queryKey: ["reflectionFeed", filter, sort, user?.id, selectedJuzRanges, normalizedSearchQuery],
    queryFn: ({ pageParam }) =>
      fetchReflectionFeed({
        filter,
        sort,
        page: pageParam,
        userId: user?.id,
        juzRanges: selectedJuzRanges,
        searchTerm: normalizedSearchQuery,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length : undefined),
    enabled: configured,
    staleTime: 1000 * 60 * 2,
  });

  const reflections = useMemo(() => {
    const rows = feedQuery.data?.pages.flatMap((page) => page.data) ?? [];
    return rows.map((reflection) => ({
      ...reflection,
      comments_count: reflection.comments_count + (commentDeltas[reflection.id] ?? 0),
    }));
  }, [commentDeltas, feedQuery.data]);

  const surahByNumber = useMemo(() => {
    const map = new Map<number, SurahOption>();
    for (const surah of options.surahs) map.set(surah.number, surah);
    return map;
  }, [options.surahs]);

  const findJuzForAyah = useCallback(
    (surah: number, ayah: number): number | null => {
      for (const juz of options.juz) {
        for (const range of juz.ranges) {
          if (range.surah === surah && ayah >= range.ayah_start && ayah <= range.ayah_end) return juz.juz;
        }
      }
      return null;
    },
    [options.juz]
  );

  const selectedSurahLabel = useMemo(() => {
    if (selectedSurah === null) return s.reflectionFeedFilterAll;
    const surah = surahByNumber.get(selectedSurah);
    const name = uiLanguage === "ar" ? surah?.nameArabic : surah?.nameEnglish;
    return name ?? `${s.tabSurah} ${uiLanguage === "ar" ? toArabicNumber(selectedSurah) : selectedSurah}`;
  }, [s.reflectionFeedFilterAll, s.tabSurah, selectedSurah, surahByNumber, uiLanguage]);

  const selectedJuzLabel = useMemo(
    () => (selectedJuz === null ? s.reflectionFeedFilterAll : `${s.tabJuz} ${uiLanguage === "ar" ? toArabicNumber(selectedJuz) : selectedJuz}`),
    [s.reflectionFeedFilterAll, s.tabJuz, selectedJuz, uiLanguage]
  );

  const selectedFilterKindLabel =
    filterKind === "surah"
      ? s.reflectionFeedFilterSurah
      : filterKind === "juz"
        ? s.reflectionFeedFilterJuz
        : s.reflectionFeedFilterNone;

  const sortOptions: { value: ReflectionFeedSort; label: string }[] = [
    { value: "newest", label: s.reflectionFeedSortNewest },
    { value: "oldest", label: s.reflectionFeedSortOldest },
    { value: "popular", label: s.reflectionFeedSortPopular },
    { value: "less", label: s.reflectionFeedSortLessPopular },
  ];
  const selectedSortLabel = `${s.reflectionFeedSortBy}: ${
    sortOptions.find((option) => option.value === sort)?.label ?? s.reflectionFeedSortNewest
  }`;

  const handleReferencePress = useCallback((reflection: Reflection) => {
    setPendingDeepLink({ surah: reflection.surah, ayah: reflection.ayah_start });
    router.push("/(tabs)/mushaf");
  }, []);

  const handleCommentAdded = useCallback(
    (reflectionId: string) => {
      setCommentDeltas((prev) => ({ ...prev, [reflectionId]: (prev[reflectionId] ?? 0) + 1 }));
      queryClient.invalidateQueries({ queryKey: ["reflectionFeed"] });
    },
    [queryClient]
  );

  const openPostModal = useCallback((reflectionId: string) => {
    setCommentsReflectionId(reflectionId);
  }, []);

  const showAuthRequired = useCallback(() => {
    setToast(s.reflectionFeedAuthRequired);
  }, [s.reflectionFeedAuthRequired]);

  const formatReference = useCallback(
    (reflection: Reflection) => {
      const surah = surahByNumber.get(reflection.surah);
      const surahName = uiLanguage === "ar" ? surah?.nameArabic : surah?.nameEnglish;
      const ayahPart =
        reflection.ayah_start === reflection.ayah_end
          ? `${reflection.surah}:${reflection.ayah_start}`
          : `${reflection.surah}:${reflection.ayah_start}-${reflection.ayah_end}`;
      const juzStart = Number.isFinite(reflection.juz_start)
        ? reflection.juz_start
        : findJuzForAyah(reflection.surah, reflection.ayah_start);
      const juzEnd = Number.isFinite(reflection.juz_end)
        ? reflection.juz_end
        : findJuzForAyah(reflection.surah, reflection.ayah_end);
      const juzPart =
        juzStart && juzEnd
          ? juzStart === juzEnd
            ? `${s.tabJuz} ${uiLanguage === "ar" ? toArabicNumber(juzStart) : juzStart}`
            : `${s.tabJuz} ${uiLanguage === "ar" ? `${toArabicNumber(juzStart)}-${toArabicNumber(juzEnd)}` : `${juzStart}-${juzEnd}`}`
          : null;

      return `${surahName ?? s.tabSurah} ${ayahPart}${juzPart ? ` · ${juzPart}` : ""}`;
    },
    [findJuzForAyah, s.tabJuz, s.tabSurah, surahByNumber, uiLanguage]
  );

  const renderReflection = useCallback(
    ({ item }: { item: Reflection }) => (
      <ReflectionCard
        reflection={item}
        variant="feed"
        showReference
        referenceLabel={formatReference(item)}
        onReferencePress={handleReferencePress}
        onCommentsPress={openPostModal}
        onPress={openPostModal}
        onLikeToggled={() => {}}
        onAuthRequired={showAuthRequired}
      />
    ),
    [formatReference, handleReferencePress, openPostModal, showAuthRequired]
  );

  const commentsReflection = useMemo(
    () => reflections.find((reflection) => reflection.id === commentsReflectionId) ?? null,
    [commentsReflectionId, reflections]
  );

  const listFooter = configured && feedQuery.hasNextPage ? (
    <Pressable
      onPress={() => feedQuery.fetchNextPage()}
      disabled={feedQuery.isFetchingNextPage}
      className="mb-10 mt-2 items-center rounded-full bg-primary-accent py-3 dark:bg-primary-bright"
      style={({ pressed }) => ({ opacity: pressed || feedQuery.isFetchingNextPage ? 0.65 : 1 })}
    >
      {feedQuery.isFetchingNextPage ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: "#FFFFFF" }}>
          {s.reflectionLoadMore}
        </Text>
      )}
    </Pressable>
  ) : (
    <View style={{ height: 36 }} />
  );

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="flex-1" style={contentContainerStyle}>
        <View className="flex-1" style={railStyle}>
          <View className="mt-4 mb-4 gap-2" style={{ direction: isRTL ? "rtl" : "ltr" }}>
            <ReflectionFeedSearch
              value={searchText}
              onChangeText={setSearchText}
              onClear={() => {
                setSearchText("");
                setSearchQuery("");
              }}
              placeholder={s.reflectionFeedSearchPlaceholder}
              clearLabel={s.reflectionFeedClearSearch}
              isDark={isDark}
              isRTL={isRTL}
            />
            <View
              className="flex-wrap gap-2"
              style={{
                direction: isRTL ? "rtl" : "ltr",
                flexDirection: "row",
                justifyContent: "flex-start",
              }}
            >
              <FilterSelect
                accessibilityLabel={s.reflectionFeedSelectFilterType}
                label={selectedFilterKindLabel}
                isDark={isDark}
                isRTL={isRTL}
                minWidth={112}
                flex={0.8}
                onPress={() => setPickerMode("filter-kind")}
              />
              <FilterSelect
                accessibilityLabel={filterKind === "juz" ? s.reflectionFeedSelectJuz : s.reflectionFeedSelectSurah}
                label={filterKind === "juz" ? selectedJuzLabel : filterKind === "surah" ? selectedSurahLabel : s.reflectionFeedFilterAll}
                isDark={isDark}
                isRTL={isRTL}
                minWidth={184}
                flex={1.55}
                onPress={() => setPickerMode("location")}
              />
              <FilterSelect
                accessibilityLabel={s.reflectionFeedSortBy}
                label={selectedSortLabel}
                isDark={isDark}
                isRTL={isRTL}
                minWidth={152}
                flex={1.15}
                onPress={() => setPickerMode("sort")}
              />
            </View>
          </View>

          {!configured ? (
            <View className="flex-1 items-center justify-center">
              <EmptyState
                icon={MessageSquare}
                title={s.reflections}
                subtitle={s.reflectionFeedNotConfigured}
                isDark={isDark}
              />
            </View>
          ) : feedQuery.isLoading ? (
            <ReflectionsSkeleton isDark={isDark} className="flex-1" />
          ) : feedQuery.error ? (
            <View className="flex-1 items-center justify-center">
              <EmptyState
                icon={MessageSquare}
                title={s.reflectionFeedTitle}
                subtitle={s.reflectionLoadFailed}
                actionLabel={s.reflectionFeedRetry}
                onAction={() => feedQuery.refetch()}
                isDark={isDark}
              />
            </View>
          ) : reflections.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <EmptyState
                icon={MessageSquare}
                title={s.reflectionFeedEmptyTitle}
                subtitle={normalizedSearchQuery ? s.reflectionFeedSearchEmptySubtitle : s.reflectionFeedEmptySubtitle}
                isDark={isDark}
              />
            </View>
          ) : (
            <FlashList
              data={reflections}
              keyExtractor={(item) => item.id}
              renderItem={renderReflection}
              contentContainerStyle={{
                paddingBottom: isPhone ? 112 : 48,
              }}
              refreshControl={
                <RefreshControl refreshing={feedQuery.isRefetching} onRefresh={() => feedQuery.refetch()} />
              }
              ListFooterComponent={listFooter}
            />
          )}
        </View>
      </View>

      <FilterPicker
        mode={pickerMode}
        options={options}
        filterKind={filterKind}
        selectedSurah={selectedSurah}
        selectedJuz={selectedJuz}
        sort={sort}
        sortOptions={sortOptions}
        isDark={isDark}
        isRTL={isRTL}
        uiLanguage={uiLanguage}
        onSelectKind={(kind) => {
          setFilterKind(kind);
          setSelectedSurah(null);
          setSelectedJuz(null);
          setPickerMode(null);
        }}
        onSelectSurah={(surah) => {
          setSelectedSurah(surah);
          setSelectedJuz(null);
          setFilterKind("surah");
          setPickerMode(null);
        }}
        onSelectJuz={(juz) => {
          setSelectedJuz(juz);
          setSelectedSurah(null);
          setFilterKind("juz");
          setPickerMode(null);
        }}
        onSelectSort={(nextSort) => {
          setSort(nextSort);
          setPickerMode(null);
        }}
        onClose={() => setPickerMode(null)}
      />

      <CommentsSheet
        reflectionId={commentsReflectionId}
        reflection={commentsReflection}
        showReference
        referenceLabel={commentsReflection ? formatReference(commentsReflection) : undefined}
        onReferencePress={handleReferencePress}
        onLikeToggled={() => {}}
        onAuthRequired={showAuthRequired}
        onClose={() => setCommentsReflectionId(null)}
        onCommentAdded={handleCommentAdded}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </SafeAreaView>
  );
}

function ReflectionFeedSearch({
  value,
  onChangeText,
  onClear,
  placeholder,
  clearLabel,
  isDark,
  isRTL,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onClear: () => void;
  placeholder: string;
  clearLabel: string;
  isDark: boolean;
  isRTL: boolean;
}) {
  const iconColor = isDark ? "#737373" : "#8B8178";

  return (
    <View
      className="min-h-11 items-center gap-2 rounded-2xl bg-surface-low px-4 dark:bg-surface-dark-low"
      style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Search size={17} color={iconColor} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={isDark ? "#737373" : "#b9a085"}
        returnKeyType="search"
        className="min-h-11 flex-1 py-2 text-charcoal dark:text-neutral-100"
        style={{
          fontFamily: "Manrope_400Regular",
          fontSize: 14,
          textAlign: isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      />
      {value.trim().length > 0 ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          hitSlop={8}
          className="h-8 w-8 items-center justify-center rounded-full"
          style={({ pressed }) => ({
            opacity: pressed ? 0.7 : 1,
            backgroundColor: pressed ? (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)") : "transparent",
          })}
        >
          <X size={15} color={iconColor} />
        </Pressable>
      ) : null}
    </View>
  );
}

function FilterSelect({
  accessibilityLabel,
  label,
  isDark,
  isRTL,
  minWidth,
  flex,
  onPress,
}: {
  accessibilityLabel: string;
  label: string;
  isDark: boolean;
  isRTL: boolean;
  minWidth: number;
  flex: number;
  onPress: () => void;
}) {
  const color = isDark ? "#2dd4bf" : "#0d9488";
  const textColor = isDark ? "#f5f5f5" : "#2f241c";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className={`${isRTL ? "flex-row-reverse" : "flex-row"} flex-nowrap items-center gap-1.5 rounded-full px-4 py-2.5`}
      style={({ pressed }) => ({
        opacity: pressed ? 0.75 : 1,
        minWidth,
        flex,
        direction: isRTL ? "rtl" : "ltr",
        flexDirection: isRTL ? "row-reverse" : "row",
        flexWrap: "nowrap",
        backgroundColor: pressed
          ? isDark
            ? "rgba(45, 212, 191, 0.12)"
            : "rgba(13, 148, 136, 0.08)"
          : "transparent",
        borderColor: isDark ? "rgba(45, 212, 191, 0.32)" : "rgba(13, 148, 136, 0.28)",
        borderWidth: 1,
        cursor: "pointer",
      })}
    >
      <Text
        numberOfLines={1}
        style={{
          color: textColor,
          flexShrink: 1,
          fontFamily: "Manrope_600SemiBold",
          fontSize: 12,
          minWidth: 0,
          textAlign: isRTL ? "right" : "left",
        }}
      >
        {label}
      </Text>
      <View style={{ flexShrink: 0 }}>
        <ChevronDown size={14} color={color} />
      </View>
    </Pressable>
  );
}

function FilterPicker({
  mode,
  options,
  filterKind,
  selectedSurah,
  selectedJuz,
  sort,
  sortOptions,
  isDark,
  isRTL,
  uiLanguage,
  onSelectKind,
  onSelectSurah,
  onSelectJuz,
  onSelectSort,
  onClose,
}: {
  mode: PickerMode;
  options: FilterOptions;
  filterKind: FilterKind;
  selectedSurah: number | null;
  selectedJuz: number | null;
  sort: ReflectionFeedSort;
  sortOptions: { value: ReflectionFeedSort; label: string }[];
  isDark: boolean;
  isRTL: boolean;
  uiLanguage: "en" | "ar";
  onSelectKind: (kind: FilterKind) => void;
  onSelectSurah: (surah: number | null) => void;
  onSelectJuz: (juz: number | null) => void;
  onSelectSort: (sort: ReflectionFeedSort) => void;
  onClose: () => void;
}) {
  const s = useStrings();
  const { width, height } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxHeight = Math.min(height - (isPhone ? 16 : 48), 680);
  const title =
    mode === "filter-kind"
      ? s.reflectionFeedSelectFilterType
      : mode === "sort"
        ? s.reflectionFeedSortBy
        : filterKind === "none"
          ? s.reflectionFeedFilterAll
          : filterKind === "surah"
          ? s.reflectionFeedSelectSurah
          : s.reflectionFeedSelectJuz;

  return (
    <ResponsiveSheet open={mode !== null} onClose={onClose} maxWidth={560} maxHeight={maxHeight}>
      <OverlayHeader title={title} onClose={onClose} showHandle={isPhone} isRTL={isRTL} />
      <OverlayBody contentContainerClassName="px-5 pt-3 pb-6">
        {mode === "filter-kind" ? (
          <>
            <PickerRow
              active={filterKind === "none"}
              isDark={isDark}
              isRTL={isRTL}
              leading=""
              title={s.reflectionFeedFilterNone}
              onPress={() => onSelectKind("none")}
            />
            <PickerRow
              active={filterKind === "surah"}
              isDark={isDark}
              isRTL={isRTL}
              leading=""
              title={s.reflectionFeedFilterSurah}
              onPress={() => onSelectKind("surah")}
            />
            <PickerRow
              active={filterKind === "juz"}
              isDark={isDark}
              isRTL={isRTL}
              leading=""
              title={s.reflectionFeedFilterJuz}
              onPress={() => onSelectKind("juz")}
            />
          </>
        ) : mode === "sort" ? (
          <>
            {sortOptions.map((option, index) => (
              <PickerRow
                key={option.value}
                active={sort === option.value}
                isDark={isDark}
                isRTL={isRTL}
                leading={uiLanguage === "ar" ? toArabicNumber(index + 1) : String(index + 1)}
                title={option.label}
                onPress={() => onSelectSort(option.value)}
              />
            ))}
          </>
        ) : filterKind === "none" ? (
          <PickerRow
            active
            isDark={isDark}
            isRTL={isRTL}
            leading=""
            title={s.reflectionFeedFilterAll}
            onPress={onClose}
          />
        ) : filterKind === "surah" ? (
          <>
            <PickerRow
              active={selectedSurah === null}
              isDark={isDark}
              isRTL={isRTL}
              leading=""
              title={s.reflectionFeedFilterAll}
              onPress={() => onSelectSurah(null)}
            />
            {options.surahs.map((surah) => {
              const active = selectedSurah === surah.number;
              return (
                <PickerRow
                  key={surah.number}
                  active={active}
                  isDark={isDark}
                  isRTL={isRTL}
                  leading={uiLanguage === "ar" ? toArabicNumber(surah.number) : String(surah.number)}
                  title={uiLanguage === "ar" ? surah.nameArabic : surah.nameEnglish}
                  subtitle={uiLanguage === "ar" ? surah.nameEnglish : surah.nameArabic}
                  onPress={() => onSelectSurah(surah.number)}
                />
              );
            })}
          </>
        ) : (
          <>
            <PickerRow
              active={selectedJuz === null}
              isDark={isDark}
              isRTL={isRTL}
              leading=""
              title={s.reflectionFeedFilterAll}
              onPress={() => onSelectJuz(null)}
            />
            {options.juz.map((juz) => {
              const active = selectedJuz === juz.juz;
              return (
                <PickerRow
                  key={juz.juz}
                  active={active}
                  isDark={isDark}
                  isRTL={isRTL}
                  leading={uiLanguage === "ar" ? toArabicNumber(juz.juz) : String(juz.juz)}
                  title={`${s.tabJuz} ${uiLanguage === "ar" ? toArabicNumber(juz.juz) : juz.juz}`}
                  subtitle={`${uiLanguage === "ar" ? juz.surahNameArabic : juz.surahNameEnglish} ${juz.startSurah}:${juz.startAyah}`}
                  onPress={() => onSelectJuz(juz.juz)}
                />
              );
            })}
          </>
        )}
      </OverlayBody>
    </ResponsiveSheet>
  );
}

function PickerRow({
  active,
  isDark,
  isRTL,
  leading,
  title,
  subtitle,
  onPress,
}: {
  active: boolean;
  isDark: boolean;
  isRTL: boolean;
  leading: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`mb-1.5 items-center rounded-2xl px-3 py-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
      style={({ pressed }) => ({
        backgroundColor: active
          ? isDark
            ? "rgba(45, 212, 191, 0.14)"
            : "rgba(13, 148, 136, 0.1)"
          : pressed
            ? isDark
              ? "rgba(255,255,255,0.04)"
              : "rgba(0,0,0,0.03)"
            : "transparent",
      })}
    >
      {!!leading && (
        <View
          className={`h-10 w-10 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 ${
            isRTL ? "ml-3" : "mr-3"
          }`}
        >
          <Text
            className="text-primary-accent dark:text-primary-bright"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 12 }}
          >
            {leading}
          </Text>
        </View>
      )}
      <View className="flex-1">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, textAlign: isRTL ? "right" : "left" }}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text
            className="mt-0.5 text-warm-400 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
          >
            {subtitle}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
