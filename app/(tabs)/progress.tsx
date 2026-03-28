import { useState, useCallback } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Card } from "@/components/ui/Card";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { useDatabase } from "@/lib/database/provider";
import { getTotalCardCount, getStudyStreak } from "@/lib/fsrs/queries";

export default function ProgressScreen() {
  const s = useStrings();
  const { isDark } = useSettings();
  const db = useDatabase();

  const [totalCards, setTotalCards] = useState(0);
  const [streak, setStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);

  const loadData = useCallback(async () => {
    const [cards, currentStreak, reviewCount] = await Promise.all([
      getTotalCardCount(db),
      getStudyStreak(db),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_log"),
    ]);
    setTotalCards(cards);
    setStreak(currentStreak);
    setTotalReviews(reviewCount?.count ?? 0);

    // Compute longest streak from study_log
    const rows = await db.getAllAsync<{ review_date: string }>(
      "SELECT DISTINCT DATE(reviewed_at) as review_date FROM study_log ORDER BY review_date ASC"
    );
    let maxStreak = 0;
    let runStreak = 0;
    let prev: Date | null = null;
    for (const row of rows) {
      const d = new Date(row.review_date);
      d.setHours(0, 0, 0, 0);
      if (prev) {
        const diff = (d.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        runStreak = diff === 1 ? runStreak + 1 : 1;
      } else {
        runStreak = 1;
      }
      if (runStreak > maxStreak) maxStreak = runStreak;
      prev = d;
    }
    setLongestStreak(maxStreak);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const formatStat = (val: number) => val > 0 ? val.toLocaleString() : "—";

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header */}
        <View className="pt-8 pb-6">
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
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 18, letterSpacing: 0.5 }}
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
        </Card>

        {/* Stats grid — real data */}
        <View className="flex-row gap-3 mb-3">
          <Card elevation="low" className="flex-1 p-5 items-center">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 24 }}
            >
              {formatStat(totalCards)}
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.progressTotalMemorized}
            </Text>
          </Card>
          <Card elevation="low" className="flex-1 p-5 items-center">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 24 }}
            >
              {formatStat(totalReviews)}
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.progressRetention}
            </Text>
          </Card>
        </View>
        <View className="flex-row gap-3 mb-6">
          <Card elevation="low" className="flex-1 p-5 items-center">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 24 }}
            >
              {formatStat(streak)}
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.progressAvgDaily}
            </Text>
          </Card>
          <Card elevation="low" className="flex-1 p-5 items-center">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 24 }}
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
        </View>

        {/* Activity heatmap placeholder */}
        <Card elevation="low" className="p-6 mb-6">
          <Text
            className="text-charcoal dark:text-neutral-200 mb-4"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
          >
            {s.progressActivity}
          </Text>
          <View className="h-32 rounded-2xl bg-surface-low dark:bg-surface-dark-low items-center justify-center">
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
            >
              {s.comingSoon}
            </Text>
          </View>
        </Card>

        {/* Surah progress placeholder */}
        <Text
          className="text-charcoal dark:text-neutral-200 mb-4"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
        >
          {s.progressSurahProgress}
        </Text>
        <Card elevation="low" className="p-5 mb-3">
          <View className="h-16 items-center justify-center">
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
            >
              {s.comingSoon}
            </Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
