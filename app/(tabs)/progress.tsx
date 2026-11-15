import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { captureAuthReturn } from "@/lib/auth/return-origin";
import { AlertCircle, BarChart3, BookOpen, ChevronLeft, ChevronRight, Trophy } from "lucide-react-native";
import { AccountSyncPrompt, type AccountSyncPromptProps } from "@/components/auth/AccountSyncPrompt";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Screen,
  ScreenScrollView,
  TAB_SCREEN_BOTTOM_INSET,
  useScreenContentLayout,
} from "@/components/ui/ScreenContent";
import { OverlayBody, OverlayHeader, ResponsiveModal } from "@/components/ui/ResponsiveOverlay";
import { ActivityHeatmap } from "@/components/progress/ActivityHeatmap";
import { DefaultDeckProgressChart } from "@/components/progress/DefaultDeckProgressChart";
import { ProgressStats, type ProgressStatItem } from "@/components/progress/ProgressStats";
import { SurahProgressBrowser, SurahProgressList } from "@/components/progress/SurahProgressList";
import { AchievementBadge } from "@/components/achievements/AchievementBadge";
import { AchievementGrid } from "@/components/achievements/AchievementGrid";
import { DeckCardsSheet } from "@/components/flashcards/DeckCardsSheet";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { useDatabase } from "@/lib/database/provider";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { consistencyFromHabit, loadStudyMetrics, type StudyMetrics } from "@/lib/progress/metrics";
import { useHabitOverview } from "@/lib/habit/use-habit-overview";
import { nextLocalMidnight, useDayBoundaryRefresh } from "@/lib/habit/use-day-boundary";
import { HifzProgressCard } from "@/components/hifz/HifzProgressCard";
import { loadHifzProgress, type HifzProgress } from "@/lib/hifz/progress";
import { effectiveWeekStart } from "@/lib/habit/settings";
import { formatNumber } from "@/lib/i18n/count";
import type { DayStatus } from "@/lib/habit/types";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { getAchievementDashboard, type AchievementDashboard } from "@/lib/achievements/queries";
import { getAchievementDefinition } from "@/lib/achievements/catalog";
import { getReflectionJourneySummary } from "@/lib/reflection-journey/queries";
import type { ReflectionJourneySummary } from "@/lib/reflection-journey/types";
import { DESKTOP_CONTENT_MAX_WIDTH } from "@/lib/ui/viewport";
import {
  getDefaultDeckProgress,
  getLocalSurahProgress,
  type DefaultDeckProgressItem,
  type ProfileSurahProgress,
} from "@/lib/profile/progress";
import { subscribeSyncCompleted } from "@/lib/sync/events";
import { textStartStyle } from "@/lib/ui/direction";
import { errorIconColor } from "@/lib/ui/theme-icons";
import { SecondaryDestinations } from "@/components/ui/SecondaryDestinations";

export default function ProgressScreen() {
  const s = useStrings();
  const { isDark, isRTL, uiLanguage, effectiveTheme } = useSettings();
  const db = useDatabase();
  const user = useAuthStore((state) => state.user);
  const authLoading = useAuthStore((state) => state.isLoading);
  const authInitialized = useAuthStore((state) => state.isInitialized);
  const { isLaptop } = useScreenContentLayout({ maxWidth: DESKTOP_CONTENT_MAX_WIDTH });

  const { overview: habit, failed: habitFailed } = useHabitOverview(db);
  const [metrics, setMetrics] = useState<StudyMetrics | null>(null);
  const [metricsStatus, setMetricsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [surahProgress, setSurahProgress] = useState<ProfileSurahProgress[]>([]);
  const [defaultDeckProgress, setDefaultDeckProgress] = useState<DefaultDeckProgressItem[]>([]);
  const [achievementDashboard, setAchievementDashboard] = useState<AchievementDashboard | null>(null);
  const [journeySummary, setJourneySummary] = useState<ReflectionJourneySummary | null>(null);
  const [hifzProgress, setHifzProgress] = useState<HifzProgress | null>(null);
  const [surahProgressModalOpen, setSurahProgressModalOpen] = useState(false);
  const [achievementsModalOpen, setAchievementsModalOpen] = useState(false);
  const [deckCardsTarget, setDeckCardsTarget] = useState<{ id: string; title: string } | null>(null);
  const [boundary, setBoundary] = useState<number | null>(null);
  const latestLoad = useRef(0);
  const focused = useRef(false);

  // Each section keeps its last valid value when its query fails; the figures never fall to zero
  // for a failure. Only the latest load may publish.
  const loadData = useCallback(async () => {
    const request = ++latestLoad.current;
    const [metricsResult, achievements, decks, surahs, hifz, journey] = await Promise.allSettled([
      loadStudyMetrics(db),
      getAchievementDashboard(db),
      getDefaultDeckProgress(db),
      getLocalSurahProgress(db),
      loadHifzProgress(db),
      getReflectionJourneySummary(db),
    ]);
    if (request !== latestLoad.current) return;
    setBoundary(nextLocalMidnight(new Date()).getTime());

    let failed = false;
    const apply = <T,>(result: PromiseSettledResult<T>, label: string, set: (value: T) => void) => {
      if (result.status === "fulfilled") set(result.value);
      else {
        failed = true;
        console.warn(`[Progress] Failed to load ${label}:`, result.reason);
      }
    };
    apply(metricsResult, "study metrics", (value) => {
      setMetrics(value);
      setMetricsStatus("ready");
    });
    if (metricsResult.status === "rejected") {
      setMetricsStatus((current) => (current === "ready" ? current : "error"));
    }
    apply(achievements, "achievements", setAchievementDashboard);
    apply(decks, "default deck progress", setDefaultDeckProgress);
    apply(surahs, "surah progress", setSurahProgress);
    apply(hifz, "hifz progress", setHifzProgress);
    apply(journey, "journey summary", setJourneySummary);
    setRefreshFailed(failed);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void loadData();
      return () => {
        focused.current = false;
      };
    }, [loadData]),
  );
  // Focus always reloads, so events that arrive while another screen is in front can wait for it.
  const reloadIfFocused = useCallback(() => {
    if (focused.current) void loadData();
  }, [loadData]);
  useEffect(() => subscribeReviewActivity(reloadIfFocused), [reloadIfFocused]);
  useEffect(
    () =>
      subscribeSyncCompleted(({ pulled }) => {
        if (pulled > 0) reloadIfFocused();
      }),
    [reloadIfFocused],
  );
  // A return to the foreground and local midnight reload, so the day rolls over while Progress is open.
  useDayBoundaryRefresh(boundary, reloadIfFocused);

  const showSyncPrompt = isSupabaseConfigured() && authInitialized && !authLoading && !user;
  // The interface language picks the digits; toLocaleString would follow the device locale.
  const formatStat = (val: number) => formatNumber(val, uiLanguage);
  const percent = (val: number) => `${formatStat(val)}${uiLanguage === "ar" ? "٪" : "%"}`;
  const dayStatuses = useMemo(() => {
    const map = new Map<string, DayStatus>();
    for (const day of habit?.days ?? []) map.set(day.localDate, day.status);
    return map;
  }, [habit?.days]);
  // STR-28: the heatmap columns and "Steady weeks" both follow the week start chosen in Settings.
  const weekStart = effectiveWeekStart(habit?.settings ?? { weekStart: null }, uiLanguage);
  const consistency = useMemo(() => consistencyFromHabit(habit, weekStart), [habit, weekStart]);
  const unknown = "—";
  const primaryStats: ProgressStatItem[] = [
    {
      key: "memorizedShare",
      value: metrics ? percent(metrics.memorizedSharePercent) : unknown,
      label: s.progressRetention,
      help: s.progressHelpMemorizedShare,
    },
    {
      key: "totalMemorized",
      value: metrics ? formatStat(metrics.memorizedAyahCards) : unknown,
      label: s.progressTotalMemorized,
      help: s.progressHelpTotalMemorized,
    },
    {
      key: "currentConsistency",
      value: consistency ? formatStat(consistency.current) : unknown,
      label: s.progressCurrentConsistency,
      help: s.progressHelpCurrentConsistency,
    },
    {
      key: "totalReviews",
      value: metrics ? formatStat(metrics.totalReviews) : unknown,
      label: s.heatmapTotalReviews,
      help: s.progressHelpTotalReviews,
    },
  ];
  const moreStats: ProgressStatItem[] = [
    {
      key: "longestConsistency",
      value: consistency ? formatStat(consistency.longest) : unknown,
      label: s.progressLongestStreak,
      help: s.progressHelpLongestConsistency,
    },
    {
      key: "averageReviewsPerActiveDay",
      value: metrics ? formatStat(metrics.averageReviewsPerActiveDay) : unknown,
      label: s.progressAvgDaily,
      help: s.progressHelpAverage,
    },
    {
      key: "steadyWeeks",
      value: consistency ? formatStat(consistency.steadyWeeks) : unknown,
      label: s.habitSteadyWeeksLabel,
      help: s.progressHelpSteadyWeeks,
    },
    {
      key: "activeDays",
      value: metrics ? formatStat(metrics.activeDays) : unknown,
      label: s.heatmapActiveDays,
      help: s.progressHelpActiveDays,
    },
  ];
  const noReviewsYet = metricsStatus === "ready" && metrics !== null && metrics.totalReviews === 0;
  const showRefreshWarning = (refreshFailed && metrics !== null) || (habitFailed && habit !== null);
  const mirroredRowStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? ("row-reverse" as const) : ("row" as const),
  };
  const ReadingEndChevron = isRTL ? ChevronLeft : ChevronRight;
  // A bidi isolate keeps Arabic "٥ / ٥٣" in order instead of "٥٣ / ٥".
  const achievementCount = achievementDashboard
    ? `⁦${formatStat(achievementDashboard.unlockedCount)} / ${formatStat(achievementDashboard.totalCount)}⁩`
    : "";
  const recentAchievementItems: AchievementDashboard["items"] = [];
  if (achievementDashboard) {
    for (const unlock of achievementDashboard.recentUnlocks) {
      const definition = getAchievementDefinition(unlock.achievementId);
      if (!definition) continue;
      recentAchievementItems.push({
        ...definition,
        unlockedAt: unlock.unlockedAt,
        seenAt: unlock.seenAt,
        localPayload: unlock.localPayload,
        publicPayload: unlock.publicPayload,
        progress: { achievementId: definition.id, currentValue: definition.target, targetValue: definition.target },
      });
      if (recentAchievementItems.length === 3) break;
    }
  }
  const journeyDetail =
    journeySummary && journeySummary.totalLevels > 0
      ? interpolate(s.reflectionJourneyProgress, {
          completed: formatStat(journeySummary.completedLevels),
          total: formatStat(journeySummary.totalLevels),
        })
      : undefined;

  return (
    <Screen>
      <ScreenScrollView maxWidth={DESKTOP_CONTENT_MAX_WIDTH} bottomInset={TAB_SCREEN_BOTTOM_INSET}>
        {/* Activity and stats come first: the figures people open Progress for. */}
        <Card elevation="low" className="mt-8 p-5 mb-6">
          {metricsStatus === "error" && metrics === null ? (
            <EmptyState
              icon={AlertCircle}
              title={s.progressLoadFailed}
              actionLabel={s.progressRetry}
              onAction={() => void loadData()}
              isDark={isDark}
              tone="error"
            />
          ) : (
            <View
              className="gap-5"
              style={{
                flexDirection: isLaptop ? (isRTL ? "row-reverse" : "row") : "column",
                direction: "ltr",
                alignItems: "stretch",
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  accessibilityRole="header"
                  className="mb-4 text-charcoal dark:text-neutral-200"
                  style={{
                    fontFamily: "Manrope_700Bold",
                    fontSize: 16,
                    ...textStartStyle(isRTL),
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {s.progressActivity}
                </Text>
                <ActivityHeatmap
                  data={metrics?.activity ?? []}
                  isDark={isDark}
                  s={s}
                  isRTL={isRTL}
                  activeDays={metrics?.activeDays ?? 0}
                  totalReviews={metrics?.totalReviews ?? 0}
                  showSummaryStats={false}
                  size="expanded"
                  dayStatuses={dayStatuses}
                  weekStart={weekStart}
                />
              </View>
              {noReviewsYet ? (
                <View
                  className="items-center justify-center gap-3 rounded-2xl bg-surface-bright px-4 py-5 dark:bg-surface-dark-low"
                  style={{ width: isLaptop ? 360 : "100%" }}
                >
                  <BarChart3 size={22} color={isDark ? "#2dd4bf" : "#0d9488"} />
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, lineHeight: 21, textAlign: "center" }}
                  >
                    {s.progressEmptyTitle}
                  </Text>
                  <Button onPress={() => router.push({ pathname: "/flashcards/session" })}>
                    <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                      {s.progressStartReviewing}
                    </Text>
                  </Button>
                </View>
              ) : (
                <ProgressStats primary={primaryStats} more={moreStats} isLaptop={isLaptop} />
              )}
            </View>
          )}
          {showRefreshWarning ? (
            <View className="mt-3 items-center gap-1.5" style={mirroredRowStyle} accessibilityRole="alert">
              <AlertCircle size={13} color={errorIconColor(effectiveTheme)} />
              <Text
                style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: errorIconColor(effectiveTheme) }}
              >
                {s.progressRefreshFailed}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadData()}
                className="rounded-full px-3"
                style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
              >
                <Text className="text-primary dark:text-primary-bright" style={{ fontFamily: "Manrope_700Bold", fontSize: 12 }}>
                  {s.progressRetry}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </Card>

        {showSyncPrompt && (
          <ProgressSignInPrompt
            label={s.progressSignInPrompt}
            buttonLabel={s.authLogin}
            isDark={isDark}
            isRTL={isRTL}
            // Names Progress as the origin so a successful sign-in can return here (W13 allowlist).
            onPress={() => {
              // W13: the allowlisted return origin brings the guest back to Progress after sign-in.
              captureAuthReturn({ route: "progress" });
              router.push("/auth/login");
            }}
          />
        )}

        {hifzProgress && hifzProgress.memorizedPages > 0 ? (
          <HifzProgressCard progress={hifzProgress} language={uiLanguage} isDark={isDark} s={s} />
        ) : null}

        <DefaultDeckProgressChart
          items={defaultDeckProgress}
          isDark={isDark}
          isRTL={isRTL}
          s={s}
          onOpenDeck={(item, title) => setDeckCardsTarget({ id: item.deckId, title })}
        />

        <SecondaryDestinations destinations={["halaqa", "leaderboard"]} />

        {/* Surah progress */}
        <Text
          accessibilityRole="header"
          className="text-charcoal dark:text-neutral-200 mb-4"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, ...textStartStyle(isRTL) }}
        >
          {s.progressSurahProgress}
        </Text>
        <SurahProgressList
          data={surahProgress}
          isDark={isDark}
          isRTL={isRTL}
          previewLimit={10}
          onViewAll={() => setSurahProgressModalOpen(true)}
          onSetUpPlan={() => router.push("/hifz/setup" as Href)}
          s={s}
        />

        {/* Achievements */}
        {achievementDashboard && (
          <Card elevation="low" className="p-5 mt-6 mb-6">
            <View
              className={`flex-row items-center justify-between gap-3 ${isRTL ? "flex-row-reverse" : ""}`}
              style={mirroredRowStyle}
            >
              <View
                className={`min-w-0 flex-1 flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}
                style={mirroredRowStyle}
              >
                <View
                  className="h-11 w-11 items-center justify-center rounded-full"
                  style={{ backgroundColor: isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.10)" }}
                >
                  <Trophy size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
                </View>
                <View className={`min-w-0 flex-1 ${isRTL ? "items-end" : "items-start"}`}>
                  <Text
                    accessibilityRole="header"
                    className="text-charcoal dark:text-neutral-200"
                    style={{ fontFamily: "Manrope_700Bold", fontSize: 16, ...textStartStyle(isRTL)}}
                  >
                    {s.achievementsTitle}
                  </Text>
                  <Text
                    className="mt-1 text-warm-400 dark:text-neutral-400"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL)}}
                  >
                    {achievementCount}
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.achievementsViewAll}
                onPress={() => setAchievementsModalOpen(true)}
                className="rounded-full px-3 py-2"
                style={({ pressed }) => ({
                  minHeight: 44,
                  justifyContent: "center",
                  backgroundColor: isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.10)",
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <View
                  className={`flex-row items-center gap-1.5 ${isRTL ? "flex-row-reverse" : ""}`}
                  style={mirroredRowStyle}
                >
                  <Text
                    className="text-primary dark:text-primary-bright"
                    style={{ fontFamily: "Manrope_700Bold", fontSize: 12 }}
                  >
                    {s.achievementsViewAll}
                  </Text>
                  <ReadingEndChevron size={15} color={isDark ? "#2dd4bf" : "#0d9488"} />
                </View>
              </Pressable>
            </View>

            {recentAchievementItems.length > 0 && (
              <View className="mt-4">
                <Text
                  className="mb-2 text-warm-500 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 12, ...textStartStyle(isRTL)}}
                >
                  {s.achievementRecentUnlocks}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{
                    gap: 8,
                    direction: "ltr",
                    flexDirection: isRTL ? "row-reverse" : "row",
                    paddingHorizontal: 1,
                  }}
                >
                  {recentAchievementItems.map((item) => (
                    <AchievementBadge key={item.id} compact item={item} />
                  ))}
                </ScrollView>
              </View>
            )}
          </Card>
        )}

        {/* The Journey row sits under Achievements with its completed count. */}
        <SecondaryDestinations
          destinations={["reflection-journey"]}
          details={journeyDetail ? { "reflection-journey": journeyDetail } : undefined}
          className={achievementDashboard ? "mb-6" : "mt-6 mb-6"}
        />

        {/* Hadith banner, after the figures. Arabic shows the hadith once; English adds its translation. */}
        <Card elevation="low" className="mb-6 bg-primary-soft dark:bg-primary-soft px-6 py-7">
          <View style={{ alignSelf: "center", maxWidth: isLaptop ? 720 : "100%", width: "100%" }}>
            <Text
              className="text-neutral-200"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: isLaptop ? 22 : 16,
                lineHeight: isLaptop ? 38 : 26,
                writingDirection: "rtl",
                textAlign: "center",
              }}
            >
              {s.progressHadith}
            </Text>
            {!isRTL && (
              <Text
                className="text-neutral-200 mt-2"
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: isLaptop ? 15 : 14,
                  lineHeight: isLaptop ? 24 : 22,
                  textAlign: "center",
                }}
              >
                {s.progressHadithTranslation}
              </Text>
            )}
          </View>
        </Card>
      </ScreenScrollView>

      {achievementDashboard && (
        <ResponsiveModal open={achievementsModalOpen} onClose={() => setAchievementsModalOpen(false)} maxWidth={760}>
          <OverlayHeader
            title={s.achievementsTitle}
            subtitle={achievementCount}
            isRTL={isRTL}
            onClose={() => setAchievementsModalOpen(false)}
            leading={
              <View
                className="h-11 w-11 items-center justify-center rounded-full"
                style={{ backgroundColor: isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.10)" }}
              >
                <Trophy size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
              </View>
            }
          />
          <OverlayBody contentContainerClassName="px-5 py-5">
            <AchievementGrid items={achievementDashboard.items} />
          </OverlayBody>
        </ResponsiveModal>
      )}

      <ResponsiveModal open={surahProgressModalOpen} onClose={() => setSurahProgressModalOpen(false)} maxWidth={760}>
        <OverlayHeader
          title={s.progressSurahProgress}
          isRTL={isRTL}
          onClose={() => setSurahProgressModalOpen(false)}
          leading={
            <View
              className="h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.10)" }}
            >
              <BookOpen size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
            </View>
          }
        />
        <OverlayBody contentContainerClassName="px-5 py-5">
          <SurahProgressBrowser
            data={surahProgress}
            isDark={isDark}
            isRTL={isRTL}
            isCompact={isLaptop}
            onItemPress={() => setSurahProgressModalOpen(false)}
            s={s}
          />
        </OverlayBody>
      </ResponsiveModal>

      <DeckCardsSheet
        visible={!!deckCardsTarget}
        deckId={deckCardsTarget?.id ?? null}
        deckTitle={deckCardsTarget?.title ?? ""}
        onClose={() => setDeckCardsTarget(null)}
        onChanged={() => void loadData()}
      />
    </Screen>
  );
}

/** The guest prompt sits on a light teal card so it reads as secondary to the figures. */
function ProgressSignInPrompt(props: AccountSyncPromptProps) {
  return (
    <Card elevation="low" className="mb-6 px-5 py-4 bg-primary-accent/10 dark:bg-primary-bright/10">
      <AccountSyncPrompt {...props} />
    </Card>
  );
}
