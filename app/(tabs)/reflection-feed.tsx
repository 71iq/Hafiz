import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronDown, MessageSquare } from "lucide-react-native";
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

type PickerMode = "surah" | "juz" | null;

type FilterOptions = {
  surahs: SurahOption[];
  juz: JuzOption[];
};

const defaultFilter: ReflectionFeedFilter = { type: "all" };
const REFLECTION_FEED_MAX_WIDTH = 640;

export default function ReflectionFeedScreen() {
  const db = useDatabase();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { width } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const { contentContainerStyle, railStyle, isLaptop } = useScreenContentLayout({
    maxWidth: REFLECTION_FEED_MAX_WIDTH,
  });
  const s = useStrings();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();
  const [filter, setFilter] = useState<ReflectionFeedFilter>(defaultFilter);
  const [sort, setSort] = useState<ReflectionFeedSort>("newest");
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [commentsReflectionId, setCommentsReflectionId] = useState<string | null>(null);
  const [commentDeltas, setCommentDeltas] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<string | null>(null);

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

  const selectedJuzRanges = useMemo(
    () => (filter.type === "juz" ? options.juz.find((juz) => juz.juz === filter.juz)?.ranges : undefined),
    [filter, options.juz]
  );

  const feedQuery = useInfiniteQuery({
    queryKey: ["reflectionFeed", filter, sort, user?.id, selectedJuzRanges],
    queryFn: ({ pageParam }) =>
      fetchReflectionFeed({
        filter,
        sort,
        page: pageParam,
        userId: user?.id,
        juzRanges: selectedJuzRanges,
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
    if (filter.type === "surah") {
      const surah = surahByNumber.get(filter.surah);
      const name = uiLanguage === "ar" ? surah?.nameArabic : surah?.nameEnglish;
      return name ? `${s.tabSurah} ${name}` : `${s.tabSurah} ${filter.surah}`;
    }
    return s.reflectionFeedFilterSurah;
  }, [filter, s.reflectionFeedFilterSurah, s.tabSurah, surahByNumber, uiLanguage]);

  const selectedJuzLabel = useMemo(() => {
    if (filter.type === "juz") {
      return `${s.tabJuz} ${uiLanguage === "ar" ? toArabicNumber(filter.juz) : filter.juz}`;
    }
    return s.reflectionFeedFilterJuz;
  }, [filter, s.reflectionFeedFilterJuz, s.tabJuz, uiLanguage]);

  const sortOptions: { value: ReflectionFeedSort; label: string }[] = [
    { value: "newest", label: s.reflectionFeedSortNewest },
    { value: "oldest", label: s.reflectionFeedSortOldest },
    { value: "popular", label: s.reflectionFeedSortPopular },
    { value: "less", label: s.reflectionFeedSortLessPopular },
  ];

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
        onCommentsPress={setCommentsReflectionId}
        onLikeToggled={() => {}}
        onAuthRequired={showAuthRequired}
      />
    ),
    [formatReference, handleReferencePress, showAuthRequired]
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
          <View
            className="mt-4 mb-4 border px-4 py-4"
            style={{
              borderRadius: 28,
              backgroundColor: isDark ? "#151515" : "#FAF8F4",
              borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,54,56,0.08)",
              shadowColor: "#003638",
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: isDark ? 0 : 0.06,
              shadowRadius: 28,
              elevation: 2,
            }}
          >
            <View className={`items-center gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
              <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
                <MessageSquare size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
              </View>
              <View className={`flex-1 ${isRTL ? "items-end" : "items-start"}`}>
                <Text
                  className="text-primary dark:text-gold-light"
                  style={{
                    fontFamily: "NotoSerif_700Bold",
                    fontSize: isLaptop ? 34 : 30,
                    lineHeight: isLaptop ? 40 : 36,
                    textAlign: isRTL ? "right" : "left",
                  }}
                >
                  {s.reflectionFeedTitle}
                </Text>
                <Text
                  className="mt-1 text-warm-500 dark:text-neutral-400"
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 13,
                    lineHeight: 21,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {s.reflectionFeedSubtitle}
                </Text>
              </View>
            </View>

            <View className={`mt-4 gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
              <FilterSelect
                label={selectedSurahLabel}
                active={filter.type === "surah"}
                isRTL={isRTL}
                onPress={() => setPickerMode("surah")}
              />
              <FilterSelect
                label={selectedJuzLabel}
                active={filter.type === "juz"}
                isRTL={isRTL}
                onPress={() => setPickerMode("juz")}
              />
            </View>

            <View className={`mt-3 flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
              {sortOptions.map((option) => (
                <FilterButton
                  key={option.value}
                  label={option.label}
                  active={sort === option.value}
                  onPress={() => setSort(option.value)}
                />
              ))}
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
                subtitle={(feedQuery.error as Error).message}
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
        filter={filter}
        isDark={isDark}
        isRTL={isRTL}
        uiLanguage={uiLanguage}
        onSelect={(nextFilter) => {
          setFilter(nextFilter);
          setPickerMode(null);
        }}
        onClose={() => setPickerMode(null)}
      />

      <CommentsSheet
        reflectionId={commentsReflectionId}
        onClose={() => setCommentsReflectionId(null)}
        onCommentAdded={handleCommentAdded}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </SafeAreaView>
  );
}

function FilterSelect({
  label,
  active,
  isRTL,
  onPress,
}: {
  label: string;
  active: boolean;
  isRTL: boolean;
  onPress: () => void;
}) {
  const iconColor = active ? "#FFFFFF" : "#A77F5A";

  return (
    <Pressable
      onPress={onPress}
      className={`min-w-[132px] flex-1 items-center gap-2 rounded-full px-4 py-2.5 ${
        isRTL ? "flex-row-reverse" : "flex-row"
      } ${active ? "bg-primary-accent dark:bg-primary-bright" : "bg-surface-low dark:bg-surface-dark-low"}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <Text
        numberOfLines={1}
        className={active ? "flex-1 text-white" : "flex-1 text-warm-500 dark:text-neutral-400"}
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
      >
        {label}
      </Text>
      <ChevronDown size={14} color={iconColor} />
    </Pressable>
  );
}

function FilterButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-3.5 py-2 ${active ? "bg-primary-accent dark:bg-primary-bright" : "bg-surface-low dark:bg-surface-dark-low"}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <Text
        className={active ? "text-white" : "text-warm-500 dark:text-neutral-400"}
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function FilterPicker({
  mode,
  options,
  filter,
  isDark,
  isRTL,
  uiLanguage,
  onSelect,
  onClose,
}: {
  mode: PickerMode;
  options: FilterOptions;
  filter: ReflectionFeedFilter;
  isDark: boolean;
  isRTL: boolean;
  uiLanguage: "en" | "ar";
  onSelect: (filter: ReflectionFeedFilter) => void;
  onClose: () => void;
}) {
  const s = useStrings();
  const { width, height } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxHeight = Math.min(height - (isPhone ? 16 : 48), 680);
  const title = mode === "surah" ? s.reflectionFeedSelectSurah : s.reflectionFeedSelectJuz;

  return (
    <ResponsiveSheet open={mode !== null} onClose={onClose} maxWidth={560} maxHeight={maxHeight}>
      <OverlayHeader title={title} onClose={onClose} showHandle={isPhone} isRTL={isRTL} />
      <OverlayBody contentContainerClassName="px-5 pt-3 pb-6">
        {mode === "surah" ? (
          <>
            <PickerRow
              active={filter.type === "all"}
              isDark={isDark}
              isRTL={isRTL}
              leading="*"
              title={s.reflectionFeedAllSurahs}
              subtitle={s.reflectionFeedAll}
              onPress={() => onSelect(defaultFilter)}
            />
            {options.surahs.map((surah) => {
              const active = filter.type === "surah" && filter.surah === surah.number;
              return (
                <PickerRow
                  key={surah.number}
                  active={active}
                  isDark={isDark}
                  isRTL={isRTL}
                  leading={uiLanguage === "ar" ? toArabicNumber(surah.number) : String(surah.number)}
                  title={uiLanguage === "ar" ? surah.nameArabic : surah.nameEnglish}
                  subtitle={uiLanguage === "ar" ? surah.nameEnglish : surah.nameArabic}
                  onPress={() => onSelect({ type: "surah", surah: surah.number })}
                />
              );
            })}
          </>
        ) : (
          <>
            <PickerRow
              active={filter.type === "all"}
              isDark={isDark}
              isRTL={isRTL}
              leading="*"
              title={s.reflectionFeedAllJuz}
              subtitle={s.reflectionFeedAll}
              onPress={() => onSelect(defaultFilter)}
            />
            {options.juz.map((juz) => {
              const active = filter.type === "juz" && filter.juz === juz.juz;
              return (
                <PickerRow
                  key={juz.juz}
                  active={active}
                  isDark={isDark}
                  isRTL={isRTL}
                  leading={uiLanguage === "ar" ? toArabicNumber(juz.juz) : String(juz.juz)}
                  title={`${s.tabJuz} ${uiLanguage === "ar" ? toArabicNumber(juz.juz) : juz.juz}`}
                  subtitle={`${uiLanguage === "ar" ? juz.surahNameArabic : juz.surahNameEnglish} ${juz.startSurah}:${juz.startAyah}`}
                  onPress={() => onSelect({ type: "juz", juz: juz.juz })}
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
  subtitle: string;
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
      <View className="flex-1">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, textAlign: isRTL ? "right" : "left" }}
        >
          {title}
        </Text>
        <Text
          className="mt-0.5 text-warm-400 dark:text-neutral-500"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
        >
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
