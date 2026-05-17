import { useState, useCallback, useEffect } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { ChevronDown, ChevronUp, Trophy } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { ScreenScrollView, useScreenContentLayout } from "@/components/ui/ScreenContent";
import { ActivityHeatmap } from "@/components/progress/ActivityHeatmap";
import { SurahProgressList } from "@/components/progress/SurahProgressList";
import { AchievementBadge } from "@/components/achievements/AchievementBadge";
import { AchievementGrid } from "@/components/achievements/AchievementGrid";
import { AuthGate } from "@/components/ui/AuthGate";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { useDatabase } from "@/lib/database/provider";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getMemorizedAyahCardCount,
  getReviewStats,
  getTotalAyahCardCount,
} from "@/lib/fsrs/queries";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { getAchievementDashboard, type AchievementDashboard } from "@/lib/achievements/queries";
import { getAchievementDefinition } from "@/lib/achievements/catalog";
import { DESKTOP_CONTENT_MAX_WIDTH } from "@/lib/ui/viewport";

type HeatmapDay = { date: string; count: number };
type SurahProgress = {
  surah: number;
  nameArabic: string;
  nameEnglish: string;
  totalCards: number;
  memorized: number;
};

export default function ProgressScreen() {
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const db = useDatabase();
  const user = useAuthStore((state) => state.user);
  const { isLaptop } = useScreenContentLayout({ maxWidth: DESKTOP_CONTENT_MAX_WIDTH });

  if (isSupabaseConfigured() && !user) {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <AuthGate
          title={s.authGateProgressTitle}
          subtitle={s.authGateProgressSubtitle}
        />
      </SafeAreaView>
    );
  }

  const [totalAyahCards, setTotalAyahCards] = useState(0);
  const [memorizedAyahCards, setMemorizedAyahCards] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [avgDailyReviews, setAvgDailyReviews] = useState(0);
  const [activeReviewDays, setActiveReviewDays] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [heatmapData, setHeatmapData] = useState<HeatmapDay[]>([]);
  const [surahProgress, setSurahProgress] = useState<SurahProgress[]>([]);
  const [achievementDashboard, setAchievementDashboard] = useState<AchievementDashboard | null>(null);
  const [achievementsExpanded, setAchievementsExpanded] = useState(false);

  const loadData = useCallback(async () => {
    const [cards, memorized, reviewStats, achievements] = await Promise.all([
      getTotalAyahCardCount(db),
      getMemorizedAyahCardCount(db),
      getReviewStats(db),
      getAchievementDashboard(db),
    ]);
    setTotalAyahCards(cards);
    setMemorizedAyahCards(memorized);
    setLongestStreak(reviewStats.longestStreak);
    setAvgDailyReviews(reviewStats.averageDailyReviews);
    setActiveReviewDays(reviewStats.activeDays);
    setTotalReviews(reviewStats.totalReviews);
    setHeatmapData(reviewStats.activity);
    setAchievementDashboard(achievements);

    // Surah progress: per-surah card counts with memorization state
    const surahRows = await db.getAllAsync<{
      surah: number;
      total: number;
      memorized: number;
    }>(
      `SELECT
         CAST(SUBSTR(sc.id, 1, INSTR(sc.id, ':') - 1) AS INTEGER) as surah,
         COUNT(*) as total,
         SUM(CASE WHEN sc.state = 2 THEN 1 ELSE 0 END) as memorized
       FROM study_cards sc
       WHERE sc.id NOT LIKE 'word:%'
       GROUP BY surah
       ORDER BY surah`
    );

    if (surahRows.length > 0) {
      const surahNums = surahRows.map((r) => r.surah);
      const placeholders = surahNums.map(() => "?").join(",");
      const nameRows = await db.getAllAsync<{ number: number; name_arabic: string; name_english: string }>(
        `SELECT number, name_arabic, name_english FROM surahs WHERE number IN (${placeholders})`,
        surahNums
      );
      const nameMap = new Map(nameRows.map((r) => [r.number, r]));

      setSurahProgress(
        surahRows.map((r) => ({
          surah: r.surah,
          nameArabic: nameMap.get(r.surah)?.name_arabic ?? `Surah ${r.surah}`,
          nameEnglish: nameMap.get(r.surah)?.name_english ?? "",
          totalCards: r.total,
          memorized: r.memorized,
        }))
      );
    } else {
      setSurahProgress([]);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => subscribeReviewActivity(loadData), [loadData]);

  const formatStat = (val: number) => val > 0 ? val.toLocaleString() : "—";
  const masteryPct = totalAyahCards > 0 ? Math.round((memorizedAyahCards / totalAyahCards) * 100) : 0;
  const statItems = [
    { value: `${masteryPct}%`, label: s.progressRetention },
    { value: formatStat(memorizedAyahCards), label: s.progressTotalMemorized },
    { value: formatStat(longestStreak), label: s.progressLongestStreak },
    { value: formatStat(avgDailyReviews), label: s.progressAvgDaily },
  ];
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
        {/* Header */}
        <View className="pt-8 pb-5">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: isLaptop ? 32 : 28 }}
          >
            {s.progressTitle}
          </Text>
        </View>

        {/* Daily reminder card */}
        <Card elevation="low" className="mb-6 bg-primary-soft dark:bg-primary-soft px-6 py-7">
          <Text
            className="text-gold mb-2"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, letterSpacing: 0.5 }}
          >
            {s.progressDailyReminder}
          </Text>
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

        {/* Stats grid — real data */}
        <View
          className="mb-6 gap-3"
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
          }}
        >
          {statItems.map((item) => (
            <ProgressStatCard
              key={item.label}
              value={item.value}
              label={item.label}
              isLaptop={isLaptop}
              isRTL={isRTL}
            />
          ))}
        </View>

        {/* Activity heatmap */}
        <Card elevation="low" className="p-6 mb-6">
          <Text
            className="text-charcoal dark:text-neutral-200 mb-4"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
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
          />
        </Card>

        {/* Surah progress */}
        <Text
          className="text-charcoal dark:text-neutral-200 mb-4"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
        >
          {s.progressSurahProgress}
        </Text>
        <SurahProgressList data={surahProgress} isDark={isDark} isRTL={isRTL} isCompact={isLaptop} s={s} />

        {/* Achievements */}
        {achievementDashboard && (
          <Card elevation="low" className="p-5 mt-6 mb-6">
            <View className={`flex-row items-center justify-between gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
              <View className={`min-w-0 flex-1 flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
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
                accessibilityLabel={achievementsExpanded ? s.achievementsHideAll : s.achievementsViewAll}
                onPress={() => setAchievementsExpanded((expanded) => !expanded)}
                className="rounded-full px-3 py-2"
                style={({ pressed }) => ({
                  backgroundColor: isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.10)",
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <View className={`flex-row items-center gap-1.5 ${isRTL ? "flex-row-reverse" : ""}`}>
                  <Text
                    className="text-primary dark:text-primary-bright"
                    style={{ fontFamily: "Manrope_700Bold", fontSize: 12 }}
                  >
                    {achievementsExpanded ? s.achievementsHideAll : s.achievementsViewAll}
                  </Text>
                  {achievementsExpanded ? (
                    <ChevronUp size={15} color={isDark ? "#2dd4bf" : "#0d9488"} />
                  ) : (
                    <ChevronDown size={15} color={isDark ? "#2dd4bf" : "#0d9488"} />
                  )}
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
                  contentContainerStyle={{ gap: 8, flexDirection: isRTL ? "row-reverse" : "row", paddingHorizontal: 1 }}
                >
                  {recentAchievementItems.map((item) => (
                    <AchievementBadge key={item.id} compact item={item} />
                  ))}
                </ScrollView>
              </View>
            )}

            {achievementsExpanded && (
              <View className="mt-5">
                <AchievementGrid items={achievementDashboard.items} />
              </View>
            )}
          </Card>
        )}
      </ScreenScrollView>
    </SafeAreaView>
  );
}

function ProgressStatCard({
  value,
  label,
  isLaptop,
  isRTL,
}: {
  value: string;
  label: string;
  isLaptop: boolean;
  isRTL: boolean;
}) {
  return (
    <Card
      elevation="low"
      className="p-5"
      style={{
        width: isLaptop ? undefined : "48%",
        flex: isLaptop ? 1 : undefined,
        minWidth: isLaptop ? 0 : undefined,
      }}
    >
      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{
          fontFamily: "NotoSerif_700Bold",
          fontSize: 26,
          textAlign: isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {value}
      </Text>
      <Text
        className="text-warm-400 dark:text-neutral-500 mt-1"
        style={{
          fontFamily: "Manrope_500Medium",
          fontSize: 11,
          textAlign: isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {label}
      </Text>
    </Card>
  );
}
