import { useState, useCallback, useEffect } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import { BookOpen, ChevronDown, LogIn, Trophy } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { ScreenScrollView, useScreenContentLayout } from "@/components/ui/ScreenContent";
import { OverlayBody, OverlayHeader, ResponsiveModal } from "@/components/ui/ResponsiveOverlay";
import { ActivityHeatmap } from "@/components/progress/ActivityHeatmap";
import { DefaultDeckProgressChart } from "@/components/progress/DefaultDeckProgressChart";
import { SurahProgressList } from "@/components/progress/SurahProgressList";
import { AchievementBadge } from "@/components/achievements/AchievementBadge";
import { AchievementGrid } from "@/components/achievements/AchievementGrid";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { useDatabase } from "@/lib/database/provider";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getMemorizedAyahCardCount,
  getReviewStats,
  getTotalAyahCardCount,
  getWirdStatus,
} from "@/lib/fsrs/queries";
import { getTotalScore } from "@/lib/fsrs/scoring";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { getAchievementDashboard, type AchievementDashboard } from "@/lib/achievements/queries";
import { getAchievementDefinition } from "@/lib/achievements/catalog";
import { DESKTOP_CONTENT_MAX_WIDTH } from "@/lib/ui/viewport";
import { getDefaultDeckProgress, getLocalSurahProgress, type DefaultDeckProgressItem, type ProfileSurahProgress } from "@/lib/profile/progress";
import { subscribeSyncCompleted } from "@/lib/sync/events";

type HeatmapDay = { date: string; count: number };

export default function ProgressScreen() {
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const db = useDatabase();
  const user = useAuthStore((state) => state.user);
  const authLoading = useAuthStore((state) => state.isLoading);
  const authInitialized = useAuthStore((state) => state.isInitialized);
  const { isLaptop } = useScreenContentLayout({ maxWidth: DESKTOP_CONTENT_MAX_WIDTH });

  const [totalAyahCards, setTotalAyahCards] = useState(0);
  const [memorizedAyahCards, setMemorizedAyahCards] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [avgDailyReviews, setAvgDailyReviews] = useState(0);
  const [activeReviewDays, setActiveReviewDays] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [heatmapData, setHeatmapData] = useState<HeatmapDay[]>([]);
  const [surahProgress, setSurahProgress] = useState<ProfileSurahProgress[]>([]);
  const [defaultDeckProgress, setDefaultDeckProgress] = useState<DefaultDeckProgressItem[]>([]);
  const [achievementDashboard, setAchievementDashboard] = useState<AchievementDashboard | null>(null);
  const [surahProgressModalOpen, setSurahProgressModalOpen] = useState(false);
  const [achievementsModalOpen, setAchievementsModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    const [
      cards,
      memorized,
      reviewStats,
      wirdStatus,
      score,
      achievements,
      defaultDecks,
      surahs,
    ] = await Promise.all([
      getTotalAyahCardCount(db).catch((error) => {
        console.warn("[Progress] Failed to load total ayah cards:", error);
        return 0;
      }),
      getMemorizedAyahCardCount(db).catch((error) => {
        console.warn("[Progress] Failed to load memorized ayah cards:", error);
        return 0;
      }),
      getReviewStats(db).catch((error) => {
        console.warn("[Progress] Failed to load review stats:", error);
        return { activity: [], activeDays: 0, totalReviews: 0, averageDailyReviews: 0, longestStreak: 0 };
      }),
      getWirdStatus(db).catch((error) => {
        console.warn("[Progress] Failed to load wird status:", error);
        return { currentDays: 0, longestDays: 0, maintainedToday: false, lastReviewDate: null, state: "empty" as const };
      }),
      getTotalScore(db).catch((error) => {
        console.warn("[Progress] Failed to load score:", error);
        return 0;
      }),
      getAchievementDashboard(db).catch((error) => {
        console.warn("[Progress] Failed to load achievements:", error);
        return null;
      }),
      getDefaultDeckProgress(db).catch((error) => {
        console.warn("[Progress] Failed to load default deck progress:", error);
        return [];
      }),
      getLocalSurahProgress(db).catch((error) => {
        console.warn("[Progress] Failed to load surah progress:", error);
        return [];
      }),
    ]);
    setTotalAyahCards(cards);
    setMemorizedAyahCards(memorized);
    setCurrentStreak(wirdStatus.currentDays);
    setLongestStreak(reviewStats.longestStreak);
    setAvgDailyReviews(reviewStats.averageDailyReviews);
    setActiveReviewDays(reviewStats.activeDays);
    setTotalReviews(reviewStats.totalReviews);
    setTotalScore(score);
    setHeatmapData(reviewStats.activity);
    setDefaultDeckProgress(defaultDecks);
    setAchievementDashboard(achievements);
    setSurahProgress(surahs);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      loadData().catch(console.warn);
    }, [loadData])
  );

  useEffect(() => subscribeReviewActivity(() => loadData().catch(console.warn)), [loadData]);
  useEffect(() => subscribeSyncCompleted(({ pulled }) => {
    if (pulled > 0) loadData().catch(console.warn);
  }), [loadData]);

  const showSyncPrompt = isSupabaseConfigured() && authInitialized && !authLoading && !user;
  const formatStat = (val: number) => val.toLocaleString();
  const masteryPct = totalAyahCards > 0 ? Math.round((memorizedAyahCards / totalAyahCards) * 100) : 0;
  const statItems = [
    { value: `${masteryPct}%`, label: s.progressRetention },
    { value: formatStat(memorizedAyahCards), label: s.progressTotalMemorized },
    { value: formatStat(currentStreak), label: s.wirdCurrent },
    { value: formatStat(longestStreak), label: s.progressLongestStreak },
    { value: formatStat(avgDailyReviews), label: s.progressAvgDaily },
    { value: formatStat(totalScore), label: s.leaderboardPoints },
  ];
  const mirroredRowStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? "row-reverse" as const : "row" as const,
  };
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

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScreenScrollView maxWidth={DESKTOP_CONTENT_MAX_WIDTH} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Daily reminder card */}
        <Card elevation="low" className="mt-8 mb-6 bg-primary-soft dark:bg-primary-soft px-6 py-7">
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

        {showSyncPrompt && (
          <ProgressSignInPrompt
            label={s.progressSignInPrompt}
            buttonLabel={s.authLogin}
            isDark={isDark}
            isRTL={isRTL}
            onPress={() => router.push("/auth/login" as any)}
          />
        )}

        {/* Activity and stats */}
        <Card elevation="low" className="p-5 mb-6">
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
                className="mb-4 text-charcoal dark:text-neutral-200"
                style={{
                  fontFamily: "Manrope_700Bold",
                  fontSize: 16,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.progressActivity}
              </Text>
              <ActivityHeatmap
                data={heatmapData}
                isDark={isDark}
                s={s}
                isRTL={isRTL}
                activeDays={activeReviewDays}
                totalReviews={totalReviews}
                showSummaryStats={false}
              />
            </View>
            <CompactProgressStats
              items={[
                ...statItems,
                { value: formatStat(activeReviewDays), label: s.heatmapActiveDays },
                { value: formatStat(totalReviews), label: s.heatmapTotalReviews },
              ]}
              isDark={isDark}
              isLaptop={isLaptop}
              isRTL={isRTL}
            />
          </View>
        </Card>

        <DefaultDeckProgressChart
          items={defaultDeckProgress}
          isDark={isDark}
          isRTL={isRTL}
          s={s}
        />

        {/* Surah progress */}
        <Text
          className="text-charcoal dark:text-neutral-200 mb-4"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
        >
          {s.progressSurahProgress}
        </Text>
        <SurahProgressList
          data={surahProgress}
          isDark={isDark}
          isRTL={isRTL}
          previewLimit={10}
          onViewAll={() => setSurahProgressModalOpen(true)}
          s={s}
        />

        {/* Achievements */}
        {achievementDashboard && (
          <Card elevation="low" className="p-5 mt-6 mb-6">
            <View className={`flex-row items-center justify-between gap-3 ${isRTL ? "flex-row-reverse" : ""}`} style={mirroredRowStyle}>
              <View className={`min-w-0 flex-1 flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`} style={mirroredRowStyle}>
                <View
                  className="h-11 w-11 items-center justify-center rounded-full"
                  style={{ backgroundColor: isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.10)" }}
                >
                  <Trophy size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
                </View>
                <View className={`min-w-0 flex-1 ${isRTL ? "items-end" : "items-start"}`}>
                  <Text
                    className="text-charcoal dark:text-neutral-200"
                    style={{ fontFamily: "Manrope_700Bold", fontSize: 16, textAlign: isRTL ? "right" : "left" }}
                  >
                    {s.achievementsTitle}
                  </Text>
                  <Text
                    className="mt-1 text-warm-400 dark:text-neutral-500"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
                  >
                    {`${achievementDashboard.unlockedCount} / ${achievementDashboard.totalCount}`}
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.achievementsViewAll}
                onPress={() => setAchievementsModalOpen(true)}
                className="rounded-full px-3 py-2"
                style={({ pressed }) => ({
                  backgroundColor: isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.10)",
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <View className={`flex-row items-center gap-1.5 ${isRTL ? "flex-row-reverse" : ""}`} style={mirroredRowStyle}>
                  <Text
                    className="text-primary dark:text-primary-bright"
                    style={{ fontFamily: "Manrope_700Bold", fontSize: 12 }}
                  >
                    {s.achievementsViewAll}
                  </Text>
                  <ChevronDown size={15} color={isDark ? "#2dd4bf" : "#0d9488"} />
                </View>
              </Pressable>
            </View>

            {recentAchievementItems.length > 0 && (
              <View className="mt-4">
                <Text
                  className="mb-2 text-warm-500 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
                >
                  {s.achievementRecentUnlocks}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row", paddingHorizontal: 1 }}
                >
                  {recentAchievementItems.map((item) => (
                    <AchievementBadge key={item.id} compact item={item} />
                  ))}
                </ScrollView>
              </View>
            )}
          </Card>
        )}
      </ScreenScrollView>

      {achievementDashboard && (
        <ResponsiveModal
          open={achievementsModalOpen}
          onClose={() => setAchievementsModalOpen(false)}
          maxWidth={760}
        >
          <OverlayHeader
            title={s.achievementsTitle}
            subtitle={`${achievementDashboard.unlockedCount} / ${achievementDashboard.totalCount}`}
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

      <ResponsiveModal
        open={surahProgressModalOpen}
        onClose={() => setSurahProgressModalOpen(false)}
        maxWidth={760}
      >
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
          <SurahProgressList
            data={surahProgress}
            isDark={isDark}
            isRTL={isRTL}
            isCompact={isLaptop}
            onItemPress={() => setSurahProgressModalOpen(false)}
            s={s}
          />
        </OverlayBody>
      </ResponsiveModal>
    </SafeAreaView>
  );
}

function ProgressSignInPrompt({
  label,
  buttonLabel,
  isDark,
  isRTL,
  onPress,
}: {
  label: string;
  buttonLabel: string;
  isDark: boolean;
  isRTL: boolean;
  onPress: () => void;
}) {
  return (
    <Card elevation="low" className="mb-6 px-5 py-4">
      <View
        className="items-center gap-3"
        style={{
          direction: "ltr",
          flexDirection: isRTL ? "row-reverse" : "row",
          justifyContent: "space-between",
        }}
      >
        <Text
          className="min-w-0 flex-1 text-charcoal dark:text-neutral-100"
          style={{
            fontFamily: "Manrope_700Bold",
            fontSize: 14,
            lineHeight: 20,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {label}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={buttonLabel}
          onPress={onPress}
          className="rounded-full px-4 py-2.5"
          style={({ pressed }) => ({
            backgroundColor: isDark ? "#1B4D4F" : "#003638",
            opacity: pressed ? 0.76 : 1,
          })}
        >
          <View className="flex-row items-center gap-2" style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}>
            <LogIn size={15} color="#FDDC91" />
            <Text style={{ color: "#FDDC91", fontFamily: "Manrope_700Bold", fontSize: 12 }}>
              {buttonLabel}
            </Text>
          </View>
        </Pressable>
      </View>
    </Card>
  );
}

function CompactProgressStats({
  items,
  isDark,
  isLaptop,
  isRTL,
}: {
  items: { value: string; label: string }[];
  isDark: boolean;
  isLaptop: boolean;
  isRTL: boolean;
}) {
  return (
    <View
      className="gap-3"
      style={{
        width: isLaptop ? 360 : "100%",
        direction: "ltr",
        flexDirection: isRTL ? "row-reverse" : "row",
        flexWrap: "wrap",
        alignContent: "flex-start",
        justifyContent: "space-between",
        paddingTop: isLaptop ? 34 : 0,
      }}
    >
      {items.map((item) => (
        <CompactProgressStat key={item.label} value={item.value} label={item.label} isDark={isDark} isLaptop={isLaptop} isRTL={isRTL} />
      ))}
    </View>
  );
}

function CompactProgressStat({
  value,
  label,
  isDark,
  isLaptop,
  isRTL,
}: {
  value: string;
  label: string;
  isDark: boolean;
  isLaptop: boolean;
  isRTL: boolean;
}) {
  return (
    <View
      className="rounded-2xl bg-surface-bright px-4 py-3 dark:bg-surface-dark-low"
      style={{
        width: isLaptop ? 174 : "47%",
        minHeight: 74,
        justifyContent: "space-between",
        borderColor: isDark ? "rgba(45, 212, 191, 0.16)" : "rgba(13, 148, 136, 0.16)",
        borderWidth: 1,
      }}
    >
      <View
        style={{
          alignSelf: isRTL ? "flex-end" : "flex-start",
          width: 24,
          height: 3,
          borderRadius: 999,
          backgroundColor: isDark ? "#2dd4bf" : "#0d9488",
          opacity: 0.82,
        }}
      />
      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{
          fontFamily: "NotoSerif_700Bold",
          fontSize: 18,
          textAlign: isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
      <Text
        className="mt-1 text-neutral-500 dark:text-neutral-500"
        style={{
          fontFamily: "Manrope_500Medium",
          fontSize: 10,
          lineHeight: 13,
          textAlign: isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
