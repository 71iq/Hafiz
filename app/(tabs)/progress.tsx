import { useState, useCallback, useEffect } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Card } from "@/components/ui/Card";
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

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header */}
        <View className="pt-8 pb-5">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
          >
            {s.progressTitle}
          </Text>
        </View>

        {/* Daily reminder card */}
        <Card elevation="low" className="p-6 mb-6 bg-primary-soft dark:bg-primary-soft">
          <Text
            className="text-gold mb-2"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, letterSpacing: 0.5 }}
          >
            {s.progressDailyReminder}
          </Text>
          <Text
            className="text-neutral-200"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 16,
              lineHeight: 26,
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
                fontSize: 14,
                lineHeight: 22,
                textAlign: "center",
              }}
            >
              {s.progressHadithTranslation}
            </Text>
          )}
        </Card>

        {/* Stats grid — real data */}
        <View className="flex-row gap-3 mb-3">
          <Card elevation="low" className="flex-1 p-5">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 26 }}
            >
              {masteryPct}%
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.progressRetention}
            </Text>
          </Card>
          <Card elevation="low" className="flex-1 p-5">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 26 }}
            >
              {formatStat(memorizedAyahCards)}
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.progressTotalMemorized}
            </Text>
          </Card>
        </View>
        <View className="flex-row gap-3 mb-6">
          <Card elevation="low" className="flex-1 p-5">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 26 }}
            >
              {formatStat(longestStreak)}
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.progressLongestStreak}
            </Text>
          </Card>
          <Card elevation="low" className="flex-1 p-5">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 26 }}
            >
              {formatStat(avgDailyReviews)}
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.progressAvgDaily}
            </Text>
          </Card>
        </View>

        {/* Achievements */}
        {achievementDashboard && (
          <Card elevation="low" className="p-6 mb-6">
            <View className={`mb-4 flex-row items-start justify-between gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
              <View className={isRTL ? "items-end" : "items-start"}>
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

            {achievementDashboard.recentUnlocks.length > 0 && (
              <View className="mb-5">
                <Text
                  className="mb-2 text-warm-500 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
                >
                  {s.achievementRecentUnlocks}
                </Text>
                <View className={`flex-row flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
                  {achievementDashboard.recentUnlocks.map((unlock) => {
                    const definition = getAchievementDefinition(unlock.achievementId);
                    if (!definition) return null;
                    return (
                      <AchievementBadge
                        key={unlock.achievementId}
                        compact
                        item={{
                          ...definition,
                          unlockedAt: unlock.unlockedAt,
                          seenAt: unlock.seenAt,
                          localPayload: unlock.localPayload,
                          publicPayload: unlock.publicPayload,
                          progress: { achievementId: definition.id, currentValue: definition.target, targetValue: definition.target },
                        }}
                      />
                    );
                  })}
                </View>
              </View>
            )}

            <AchievementGrid items={achievementDashboard.items} />
          </Card>
        )}

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
        <SurahProgressList data={surahProgress} isDark={isDark} s={s} />
      </ScrollView>
    </SafeAreaView>
  );
}
