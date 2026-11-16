import { reflectionQueryKeys } from "@/lib/reflections/query-keys";
import { AuthReopenSurfaces } from "@/components/auth/AuthReopenSurfaces";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CloudOff, MessageSquare, Search, X } from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReflectionsSkeleton } from "@/components/ui/Skeleton";
import { Toast } from "@/components/ui/Toast";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { ReflectionCard } from "@/components/reflections/ReflectionCard";
import { CommentsSheet } from "@/components/reflections/CommentsSheet";
import { useScreenContentLayout } from "@/components/ui/ScreenContent";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { fetchReflectionFeed } from "@/lib/reflections/api";
import {
  normalizeFeedSort,
  type Reflection,
  type ReflectionFeedFilter,
  type ReflectionFeedSort,
  type ReflectionJuzRange,
} from "@/lib/reflections/types";
import { formatAyahReference, isolateReference } from "@/lib/reflections/format";
import { markCommentCountStale } from "@/lib/reflections/cache";
import { useIsOffline } from "@/lib/social/use-social-query";
import { useOpenMushaf } from "@/lib/navigation/open-mushaf";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { toArabicNumber } from "@/lib/arabic";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { findJuzRangeForAyah } from "@/lib/mushaf/position";
import { textStartStyle, inputTextStartStyle } from "@/lib/ui/direction";

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
type PickerMode = "location" | "sort" | null;

type FilterOptions = {
  surahs: SurahOption[];
  juz: JuzOption[];
};

const REFLECTION_FEED_MAX_WIDTH = 640;
const REFLECTION_SEARCH_DEBOUNCE_MS = 500;

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
  const [sortState, setSortState] = useState<ReflectionFeedSort>("newest");
  const sort = normalizeFeedSort(sortState);
  const setSort = (value: unknown) => setSortState(normalizeFeedSort(value));
  const offline = useIsOffline();
  const openMushaf = useOpenMushaf();
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [commentsReflectionId, setCommentsReflectionId] = useState<string | null>(null);
  const [commentDeltas, setCommentDeltas] = useState<
    Record<string, { viewerId: string | undefined; base: number; count: number; revision: number; scope: string }>
  >({});
  const [toast, setToast] = useState<string | null>(null);
  const normalizedSearchQuery = searchQuery.trim().replace(/\s+/g, " ").slice(0, 120);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchText);
    }, REFLECTION_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { data: options = { surahs: [], juz: [] } } = useQuery({
    queryKey: ["reflectionFeedOptions", uiLanguage],
    queryFn: async (): Promise<FilterOptions> => {
      const [surahs, juzRows, juzRanges] = await Promise.all([
        db.getAllAsync<{ number: number; name_arabic: string; name_english: string }>(
          "SELECT number, name_arabic, name_english FROM surahs ORDER BY number",
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
           ORDER BY j_start.juz`,
        ),
        db.getAllAsync<ReflectionJuzRange>(
          "SELECT juz, surah, ayah_start, ayah_end FROM juz_map ORDER BY juz, surah, ayah_start",
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

  const filter = useMemo<ReflectionFeedFilter>(() => {
    if (filterKind === "surah" && selectedSurah !== null) return { type: "surah", surah: selectedSurah };
    if (filterKind === "juz" && selectedJuz !== null) return { type: "juz", juz: selectedJuz };
    return { type: "all" };
  }, [filterKind, selectedJuz, selectedSurah]);

  const selectedJuzRanges = useMemo(
    () =>
      filterKind === "juz" && selectedJuz !== null
        ? options.juz.find((juz) => juz.juz === selectedJuz)?.ranges
        : undefined,
    [filterKind, options.juz, selectedJuz],
  );

  const feedKey = useMemo(
    () =>
      reflectionQueryKeys.feed.list({
        filter,
        sort,
        viewerId: user?.id,
        juzRanges: selectedJuzRanges,
        searchTerm: normalizedSearchQuery,
      }),
    [filter, sort, user?.id, selectedJuzRanges, normalizedSearchQuery],
  );
  const feedScope = JSON.stringify(feedKey);
  const feedQuery = useInfiniteQuery({
    queryKey: feedKey,
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

  const feedRevision = queryClient.getQueryState(feedKey)?.dataUpdateCount ?? 0;
  const rawReflections = useMemo(() => feedQuery.data?.pages.flatMap((page) => page.data) ?? [], [feedQuery.data]);
  useLayoutEffect(() => {
    setCommentDeltas((previous) => {
      const entries = Object.entries(previous);
      const retained = entries.filter(
        ([, overlay]) =>
          overlay.viewerId === user?.id && overlay.revision === feedRevision && overlay.scope === feedScope,
      );
      return retained.length === entries.length ? previous : Object.fromEntries(retained);
    });
  }, [feedRevision, user?.id, feedScope]);
  const reflections = useMemo(
    () =>
      rawReflections.map((reflection) => {
        const overlay = commentDeltas[reflection.id];
        return {
          ...reflection,
          comments_count: Math.max(
            0,
            reflection.comments_count +
            (overlay?.viewerId === user?.id &&
            overlay?.revision === feedRevision &&
            overlay?.scope === feedScope &&
            overlay?.base === reflection.comments_count
              ? overlay.count
              : 0),
          ),
        };
      }),
    [commentDeltas, rawReflections, user?.id, feedRevision, feedScope],
  );
  useLayoutEffect(() => {
    setCommentDeltas({});
    setCommentsReflectionId(null);
  }, [user?.id]);

  const surahByNumber = useMemo(() => {
    const map = new Map<number, SurahOption>();
    for (const surah of options.surahs) map.set(surah.number, surah);
    return map;
  }, [options.surahs]);

  const findJuzForAyah = useCallback(
    (surah: number, ayah: number): number | null => {
      for (const juz of options.juz) {
        if (findJuzRangeForAyah(juz.ranges, surah, ayah)) return juz.juz;
      }
      return null;
    },
    [options.juz],
  );

  const selectedSurahLabel = useMemo(() => {
    if (selectedSurah === null) return s.reflectionFeedFilterAll;
    const surah = surahByNumber.get(selectedSurah);
    const name = uiLanguage === "ar" ? surah?.nameArabic : surah?.nameEnglish;
    return name ?? `${s.tabSurah} ${uiLanguage === "ar" ? toArabicNumber(selectedSurah) : selectedSurah}`;
  }, [s.reflectionFeedFilterAll, s.tabSurah, selectedSurah, surahByNumber, uiLanguage]);

  const selectedJuzLabel = useMemo(
    () =>
      selectedJuz === null
        ? s.reflectionFeedFilterAll
        : `${s.tabJuz} ${uiLanguage === "ar" ? toArabicNumber(selectedJuz) : selectedJuz}`,
    [s.reflectionFeedFilterAll, s.tabJuz, selectedJuz, uiLanguage],
  );

  const locationLabel =
    filterKind === "juz" && selectedJuz !== null
      ? selectedJuzLabel
      : filterKind === "surah" && selectedSurah !== null
        ? selectedSurahLabel
        : s.reflectionFeedAllReflections;

  const sortOptions: { value: ReflectionFeedSort; label: string }[] = [
    { value: "newest", label: s.reflectionFeedSortNewest },
    { value: "popular", label: s.reflectionFeedSortPopular },
  ];
  const selectedSortLabel = `${s.reflectionFeedSortBy}: ${
    sortOptions.find((option) => option.value === sort)?.label ?? s.reflectionFeedSortNewest
  }`;

  const handleReferencePress = useCallback(
    (reflection: Reflection) => {
      openMushaf({ surah: reflection.surah, ayah: reflection.ayah_start });
    },
    [openMushaf],
  );

  const adjustCommentCount = useCallback(
    (reflectionId: string, step: 1 | -1) => {
      const base = rawReflections.find((row) => row.id === reflectionId)?.comments_count;
      if (base !== undefined && queryClient.getQueryState(feedKey)?.dataUpdateCount === feedRevision)
        setCommentDeltas((prev) => {
          const previous = prev[reflectionId];
          return {
            ...prev,
            [reflectionId]: {
              viewerId: user?.id,
              base,
              revision: feedRevision,
              scope: feedScope,
              count:
                previous?.base === base &&
                previous.viewerId === user?.id &&
                previous.revision === feedRevision &&
                previous.scope === feedScope
                  ? previous.count + step
                  : step,
            },
          };
        });
      markCommentCountStale(queryClient, reflectionId);
    },
    [rawReflections, user?.id, queryClient, feedKey, feedRevision, feedScope],
  );
  const handleCommentAdded = useCallback((reflectionId: string) => adjustCommentCount(reflectionId, 1), [adjustCommentCount]);
  const handleCommentRemoved = useCallback(
    (reflectionId: string) => adjustCommentCount(reflectionId, -1),
    [adjustCommentCount],
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
      const ayahPart = formatAyahReference(reflection.surah, reflection.ayah_start, reflection.ayah_end, uiLanguage);
      const juzStart = Number.isFinite(reflection.juz_start)
        ? reflection.juz_start
        : findJuzForAyah(reflection.surah, reflection.ayah_start);
      const juzEnd = Number.isFinite(reflection.juz_end)
        ? reflection.juz_end
        : findJuzForAyah(reflection.surah, reflection.ayah_end);
      const digits = (n: number) => (uiLanguage === "ar" ? toArabicNumber(n) : String(n));
      const juzPart =
        juzStart && juzEnd
          ? `${s.tabJuz} ${juzStart === juzEnd ? digits(juzStart) : isolateReference(`${digits(juzStart)}-${digits(juzEnd)}`)}`
          : null;

      return `${surahName ?? s.tabSurah} ${ayahPart}${juzPart ? ` · ${juzPart}` : ""}`;
    },
    [findJuzForAyah, s.tabJuz, s.tabSurah, surahByNumber, uiLanguage],
  );

  const closePost = useCallback(() => setCommentsReflectionId(null), []);

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
        clamp
      />
    ),
    [formatReference, handleReferencePress, openPostModal, showAuthRequired],
  );

  const commentsReflection = useMemo(
    () => reflections.find((reflection) => reflection.id === commentsReflectionId) ?? null,
    [commentsReflectionId, reflections],
  );

  const listFooter =
    configured && (feedQuery.hasNextPage || feedQuery.error) ? (
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          feedQuery.error && !feedQuery.isFetchNextPageError
            ? feedQuery.refetch({ cancelRefetch: false })
            : feedQuery.fetchNextPage({ cancelRefetch: false })
        }
        disabled={feedQuery.isFetching}
        className="mb-10 mt-2 min-h-11 items-center justify-center rounded-full bg-primary-accent py-3 dark:bg-primary-bright"
        style={({ pressed }) => ({ opacity: pressed || feedQuery.isFetching ? 0.65 : 1 })}
      >
        {feedQuery.isFetching ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: "#FFFFFF" }}>
            {feedQuery.error ? s.reflectionFeedRetry : s.reflectionLoadMore}
          </Text>
        )}
      </Pressable>
    ) : configured && reflections.length > 0 ? (
      <Text
        className="mb-10 mt-2 text-center text-warm-500 dark:text-neutral-400"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 20 }}
      >
        {s.reflectionFeedEnd}
      </Text>
    ) : (
      <View style={{ height: 36 }} />
    );

  const staleNotice =
    configured && reflections.length > 0 && !feedQuery.isFetching
      ? offline
        ? s.reflectionFeedStaleOffline
        : feedQuery.isRefetchError
          ? s.reflectionFeedStaleFailed
          : null
      : null;
  const clearSearch = () => {
    setSearchText("");
    setSearchQuery("");
  };

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="flex-1" style={contentContainerStyle}>
        <View className="flex-1" style={railStyle}>
          <View className="mt-4 mb-4 gap-2" style={{ direction: isRTL ? "rtl" : "ltr" }}>
            <Text
              accessibilityRole="header"
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 22, lineHeight: 30, ...textStartStyle(isRTL) }}
            >
              {s.reflectionFeedTitle}
            </Text>
            <ReflectionFeedSearch
              value={searchText}
              onChangeText={setSearchText}
              onSubmitSearch={() => setSearchQuery(searchText)}
              onClear={clearSearch}
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
                accessibilityLabel={`${s.reflectionFeedLocation}: ${locationLabel}`}
                label={locationLabel}
                isDark={isDark}
                isRTL={isRTL}
                minWidth={160}
                flex={1.4}
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

          {staleNotice ? (
            <View
              accessibilityLiveRegion="polite"
              className="mb-3 items-center gap-2 rounded-2xl bg-surface-low px-4 py-3 dark:bg-surface-dark-low"
              style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              <CloudOff size={16} color={isDark ? "#a3a3a3" : "#6E5A47"} />
              <Text
                className="flex-1 text-warm-700 dark:text-neutral-300"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 20, ...textStartStyle(isRTL) }}
              >
                {staleNotice}
              </Text>
            </View>
          ) : null}
          {!configured ? (
            <View className="flex-1 items-center justify-center">
              <EmptyState
                icon={MessageSquare}
                title={s.reflections}
                subtitle={s.reflectionFeedNotConfigured}
                isDark={isDark}
              />
            </View>
          ) : feedQuery.isLoading && !offline ? (
            <ReflectionsSkeleton isDark={isDark} className="flex-1" />
          ) : reflections.length === 0 && offline ? (
            <View className="flex-1 items-center justify-center">
              <EmptyState
                icon={CloudOff}
                title={s.reflectionFeedOfflineTitle}
                subtitle={s.reflectionFeedOfflineBody}
                actionLabel={s.reflectionFeedRetry}
                onAction={() => feedQuery.refetch({ cancelRefetch: false })}
                isDark={isDark}
              />
            </View>
          ) : feedQuery.error && reflections.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <EmptyState
                icon={MessageSquare}
                title={s.reflectionFeedTitle}
                subtitle={s.reflectionLoadFailed}
                actionLabel={s.reflectionFeedRetry}
                onAction={() => feedQuery.refetch({ cancelRefetch: false })}
                isDark={isDark}
              />
            </View>
          ) : reflections.length === 0 && normalizedSearchQuery ? (
            <View className="flex-1 items-center justify-center">
              <EmptyState
                icon={Search}
                title={interpolate(s.reflectionFeedSearchNoMatch, { q: normalizedSearchQuery })}
                subtitle={s.reflectionFeedSearchEmptySubtitle}
                actionLabel={s.reflectionFeedClearSearchAction}
                onAction={clearSearch}
                isDark={isDark}
              />
            </View>
          ) : reflections.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <EmptyState
                icon={MessageSquare}
                title={s.reflectionFeedEmptyTitle}
                subtitle={s.reflectionFeedEmptySubtitle}
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
                <RefreshControl
                  refreshing={feedQuery.isRefetching}
                  onRefresh={() => feedQuery.refetch({ cancelRefetch: false })}
                />
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
        onSelectAll={() => {
          setFilterKind("none");
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
        onClose={closePost}
        onCommentAdded={handleCommentAdded}
        onCommentRemoved={handleCommentRemoved}
        onReflectionGone={closePost}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
      <AuthReopenSurfaces surface="feed" />
    </SafeAreaView>
  );
}

function ReflectionFeedSearch({
  value,
  onChangeText,
  onSubmitSearch,
  onClear,
  placeholder,
  clearLabel,
  isDark,
  isRTL,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSubmitSearch: () => void;
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
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Search size={17} color={iconColor} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={isDark ? "#737373" : "#b9a085"}
        returnKeyType="search"
        onSubmitEditing={onSubmitSearch}
        className="min-h-11 flex-1 py-2 text-charcoal dark:text-neutral-100"
        style={{
          fontFamily: "Manrope_400Regular",
          fontSize: 14,
          ...inputTextStartStyle(isRTL),
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
        backgroundColor: pressed ? (isDark ? "rgba(45, 212, 191, 0.12)" : "rgba(13, 148, 136, 0.08)") : "transparent",
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
          ...textStartStyle(isRTL),
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
  onSelectAll,
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
  onSelectAll: () => void;
  onSelectSurah: (surah: number) => void;
  onSelectJuz: (juz: number) => void;
  onSelectSort: (sort: ReflectionFeedSort) => void;
  onClose: () => void;
}) {
  const s = useStrings();
  const { width, height } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxHeight = Math.min(height - (isPhone ? 16 : 48), 680);
  const digits = (n: number) => (uiLanguage === "ar" ? toArabicNumber(n) : String(n));
  const [section, setSection] = useState<FilterKind>(filterKind);
  const [surahQuery, setSurahQuery] = useState("");
  const [openedFor, setOpenedFor] = useState<PickerMode>(null);
  if (openedFor !== mode) {
    setOpenedFor(mode);
    if (mode === "location") {
      setSection(filterKind);
      setSurahQuery("");
    }
  }
  const scrollRef = useRef<ScrollView>(null);
  const scrolledFor = useRef<string | null>(null);
  const activeKey =
    mode === "location" && section === filterKind
      ? section === "surah" && selectedSurah !== null
        ? `surah:${selectedSurah}`
        : section === "juz" && selectedJuz !== null
          ? `juz:${selectedJuz}`
          : null
      : null;
  if (mode !== "location") scrolledFor.current = null;
  const revealActive = (key: string, y: number) => {
    if (key !== activeKey || scrolledFor.current === key) return;
    scrolledFor.current = key;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: false });
  };

  const surahMatches = useMemo(() => {
    const query = surahQuery.trim().toLowerCase();
    if (!query) return options.surahs;
    const asciiQuery = query.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    return options.surahs.filter(
      (surah) =>
        surah.nameEnglish.toLowerCase().includes(query) ||
        surah.nameArabic.includes(surahQuery.trim()) ||
        String(surah.number) === asciiQuery,
    );
  }, [options.surahs, surahQuery]);

  const title = mode === "sort" ? s.reflectionFeedSortBy : s.reflectionFeedLocation;
  const sectionItems: { value: FilterKind; label: string }[] = [
    { value: "none", label: s.reflectionFeedFilterAll },
    { value: "surah", label: s.reflectionFeedFilterSurah },
    { value: "juz", label: s.reflectionFeedFilterJuz },
  ];

  return (
    <ResponsiveSheet open={mode !== null} onClose={onClose} maxWidth={560} maxHeight={maxHeight}>
      <OverlayHeader title={title} onClose={onClose} showHandle={isPhone} isRTL={isRTL} />
      {mode === "location" ? (
        <View className="gap-3 px-5 pt-3">
          <ToggleGroup<FilterKind>
            value={section}
            onValueChange={setSection}
            items={sectionItems}
            dir={isRTL ? "rtl" : "ltr"}
          />
          {section === "surah" ? (
            <View
              className="min-h-11 items-center gap-2 rounded-2xl bg-surface-low px-4 dark:bg-surface-dark-low"
              style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              <Search size={16} color={isDark ? "#737373" : "#8B8178"} />
              <TextInput
                value={surahQuery}
                onChangeText={setSurahQuery}
                placeholder={s.reflectionFeedSearchSurahs}
                accessibilityLabel={s.reflectionFeedSearchSurahs}
                placeholderTextColor={isDark ? "#737373" : "#8B8178"}
                autoCorrect={false}
                className="min-h-11 flex-1 py-2 text-charcoal dark:text-neutral-100"
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 14,
                  ...inputTextStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      <OverlayBody scrollRef={scrollRef} contentContainerClassName="px-5 pt-3 pb-6">
        {mode === "sort" ? (
          <>
            {sortOptions.map((option) => (
              <PickerRow
                key={option.value}
                active={sort === option.value}
                isDark={isDark}
                isRTL={isRTL}
                leading=""
                title={option.label}
                onPress={() => onSelectSort(option.value)}
              />
            ))}
          </>
        ) : section === "none" ? (
          <PickerRow
            active={filterKind === "none"}
            isDark={isDark}
            isRTL={isRTL}
            leading=""
            title={s.reflectionFeedAllReflections}
            onPress={onSelectAll}
          />
        ) : section === "surah" ? (
          <>
            {surahMatches.length === 0 ? (
              <Text
                className="py-6 text-center text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 13 }}
              >
                {s.reflectionFeedNoSurahMatch}
              </Text>
            ) : null}
            {surahMatches.map((surah) => {
              const active = filterKind === "surah" && selectedSurah === surah.number;
              return (
                <PickerRow
                  key={surah.number}
                  active={active}
                  isDark={isDark}
                  isRTL={isRTL}
                  leading={digits(surah.number)}
                  title={uiLanguage === "ar" ? surah.nameArabic : surah.nameEnglish}
                  subtitle={uiLanguage === "ar" ? surah.nameEnglish : surah.nameArabic}
                  onPress={() => onSelectSurah(surah.number)}
                  onLayoutY={active ? (y) => revealActive(`surah:${surah.number}`, y) : undefined}
                />
              );
            })}
          </>
        ) : (
          <>
            {options.juz.map((juz) => {
              const active = filterKind === "juz" && selectedJuz === juz.juz;
              return (
                <PickerRow
                  key={juz.juz}
                  active={active}
                  isDark={isDark}
                  isRTL={isRTL}
                  leading={digits(juz.juz)}
                  title={`${s.tabJuz} ${digits(juz.juz)}`}
                  subtitle={`${uiLanguage === "ar" ? juz.surahNameArabic : juz.surahNameEnglish} ${formatAyahReference(juz.startSurah, juz.startAyah, juz.startAyah, uiLanguage)}`}
                  onPress={() => onSelectJuz(juz.juz)}
                  onLayoutY={active ? (y) => revealActive(`juz:${juz.juz}`, y) : undefined}
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
  onLayoutY,
}: {
  active: boolean;
  isDark: boolean;
  isRTL: boolean;
  leading: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  onLayoutY?: (y: number) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onLayout={onLayoutY ? (event) => onLayoutY(event.nativeEvent.layout.y) : undefined}
      className={`mb-1.5 min-h-11 items-center rounded-2xl px-3 py-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
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
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textStartStyle(isRTL)}}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text
            className="mt-0.5 text-warm-400 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 12, ...textStartStyle(isRTL)}}
          >
            {subtitle}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
