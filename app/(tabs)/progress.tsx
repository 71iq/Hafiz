import { useState, useCallback } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Card } from "@/components/ui/Card";
import { ActivityHeatmap } from "@/components/progress/ActivityHeatmap";
import { SurahProgressList } from "@/components/progress/SurahProgressList";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { useDatabase } from "@/lib/database/provider";
import { getTotalCardCount, getStudyStreak } from "@/lib/fsrs/queries";

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

  const [totalCards, setTotalCards] = useState(0);
  const [streak, setStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [heatmapData, setHeatmapData] = useState<HeatmapDay[]>([]);
  const [surahProgress, setSurahProgress] = useState<SurahProgress[]>([]);

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

    // Heatmap: reviews per day for the last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const heatRows = await db.getAllAsync<{ review_date: string; cnt: number }>(
      `SELECT DATE(reviewed_at) as review_date, COUNT(*) as cnt
       FROM study_log
       WHERE reviewed_at >= ?
       GROUP BY review_date
       ORDER BY review_date`,
      [ninetyDaysAgo.toISOString()]
    );
    setHeatmapData(heatRows.map((r) => ({ date: r.review_date, count: r.cnt })));

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

        {/* Activity heatmap */}
        <Card elevation="low" className="p-6 mb-6">
          <Text
            className="text-charcoal dark:text-neutral-200 mb-4"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
          >
            {s.progressActivity}
          </Text>
          <ActivityHeatmap data={heatmapData} isDark={isDark} s={s} isRTL={isRTL} />
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
