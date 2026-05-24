import { useState, useCallback, useEffect } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { SQLiteDatabase } from "expo-sqlite";
import { BarChart3, BookOpen, ChevronDown, Trophy } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { ScreenScrollView, useScreenContentLayout } from "@/components/ui/ScreenContent";
import { OverlayBody, OverlayHeader, ResponsiveModal } from "@/components/ui/ResponsiveOverlay";
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
  getDueCount,
  getMemorizedAyahCardCount,
  getNewCount,
  getReviewStats,
  getTotalAyahCardCount,
  getTotalCardCount,
  MEANINGS_DECK_ID,
} from "@/lib/fsrs/queries";
import { getSmartDeckStats, SMART_DECK_IDS, type SmartDeckId } from "@/lib/fsrs/smart-decks";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { getAchievementDashboard, type AchievementDashboard } from "@/lib/achievements/queries";
import { getAchievementDefinition } from "@/lib/achievements/catalog";
import { DESKTOP_CONTENT_MAX_WIDTH } from "@/lib/ui/viewport";
import { getLocalSurahProgress, type ProfileSurahProgress } from "@/lib/profile/progress";

type HeatmapDay = { date: string; count: number };

type DefaultDeckProgressKey = "mutashabihat" | "similarTails" | "qiraat" | "reasonsOfRevelation" | "vocabulary";

type DefaultDeckProgressItem = {
  key: DefaultDeckProgressKey;
  deckId: string;
  isSmartDeck: boolean;
  total: number;
  newCount: number;
  startedCount: number;
  dueCount: number;
  color: string;
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
  const [surahProgress, setSurahProgress] = useState<ProfileSurahProgress[]>([]);
  const [defaultDeckProgress, setDefaultDeckProgress] = useState<DefaultDeckProgressItem[]>([]);
  const [achievementDashboard, setAchievementDashboard] = useState<AchievementDashboard | null>(null);
  const [surahProgressModalOpen, setSurahProgressModalOpen] = useState(false);
  const [achievementsModalOpen, setAchievementsModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    const [cards, memorized, reviewStats, achievements, defaultDecks] = await Promise.all([
      getTotalAyahCardCount(db),
      getMemorizedAyahCardCount(db),
      getReviewStats(db),
      getAchievementDashboard(db),
      getDefaultDeckProgress(db),
    ]);
    setTotalAyahCards(cards);
    setMemorizedAyahCards(memorized);
    setLongestStreak(reviewStats.longestStreak);
    setAvgDailyReviews(reviewStats.averageDailyReviews);
    setActiveReviewDays(reviewStats.activeDays);
    setTotalReviews(reviewStats.totalReviews);
    setHeatmapData(reviewStats.activity);
    setDefaultDeckProgress(defaultDecks);
    setAchievementDashboard(achievements);

    setSurahProgress(await getLocalSurahProgress(db));
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

        {/* Activity and stats */}
        <Card elevation="low" className="p-5 mb-6">
          <View
            className="gap-5"
            style={{
              flexDirection: isLaptop ? (isRTL ? "row-reverse" : "row") : "column",
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
                accessibilityLabel={s.achievementsViewAll}
                onPress={() => setAchievementsModalOpen(true)}
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
                  contentContainerStyle={{ gap: 8, flexDirection: isRTL ? "row-reverse" : "row", paddingHorizontal: 1 }}
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
          surfaceColor={isDark ? "#0A0A0A" : "#FFF8F1"}
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
        surfaceColor={isDark ? "#0A0A0A" : "#FFF8F1"}
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

async function getDefaultDeckProgress(db: SQLiteDatabase): Promise<DefaultDeckProgressItem[]> {
  const decks: Pick<DefaultDeckProgressItem, "key" | "deckId" | "isSmartDeck" | "color">[] = [
    { key: "mutashabihat", deckId: SMART_DECK_IDS.mutashabihat, isSmartDeck: true, color: "#0d9488" },
    { key: "similarTails", deckId: SMART_DECK_IDS.similarTails, isSmartDeck: true, color: "#ca8a04" },
    { key: "qiraat", deckId: SMART_DECK_IDS.qiraat, isSmartDeck: true, color: "#2563eb" },
    { key: "reasonsOfRevelation", deckId: SMART_DECK_IDS.reasonsOfRevelation, isSmartDeck: true, color: "#d97706" },
    { key: "vocabulary", deckId: MEANINGS_DECK_ID, isSmartDeck: false, color: "#be123c" },
  ];

  return Promise.all(decks.map(async (deck) => {
    if (deck.isSmartDeck) {
      const stats = await getSmartDeckStats(db, deck.deckId as SmartDeckId, { type: "all" });
      const newCount = Math.max(0, Math.min(stats.total, stats.newCount));
      return {
        ...deck,
        total: stats.total,
        newCount,
        startedCount: Math.max(0, stats.total - newCount),
        dueCount: Math.max(0, Math.min(stats.total, stats.due)),
      };
    }

    const [total, rawNewCount, rawDueCount] = await Promise.all([
      getTotalCardCount(db, deck.deckId),
      getNewCount(db, deck.deckId),
      getDueCount(db, deck.deckId),
    ]);
    const newCount = Math.max(0, Math.min(total, rawNewCount));
    return {
      ...deck,
      total,
      newCount,
      startedCount: Math.max(0, total - newCount),
      dueCount: Math.max(0, Math.min(total, rawDueCount)),
    };
  }));
}

function DefaultDeckProgressChart({
  items,
  isDark,
  isRTL,
  s,
}: {
  items: DefaultDeckProgressItem[];
  isDark: boolean;
  isRTL: boolean;
  s: any;
}) {
  const titles: Record<DefaultDeckProgressKey, string> = {
    mutashabihat: s.smartDeckMutashabihatTitle,
    similarTails: s.smartDeckSimilarTailsTitle,
    qiraat: s.smartDeckQiraatTitle,
    reasonsOfRevelation: s.smartDeckReasonsTitle,
    vocabulary: s["achievementCategory.vocab"] ?? s.vocabDeckTitle,
  };
  const totalCards = items.reduce((sum, item) => sum + item.total, 0);

  return (
    <Card elevation="low" className="p-5 mb-6">
      <View className={`flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.10)" }}
        >
          <BarChart3 size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
        </View>
        <View className={`min-w-0 flex-1 ${isRTL ? "items-end" : "items-start"}`}>
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 16, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {s.progressDefaultDecks}
          </Text>
          <Text
            className="mt-1 text-warm-400 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {`${s.flashcardsTotalCards}: ${totalCards.toLocaleString()}`}
          </Text>
        </View>
      </View>
      <View className={`mt-4 flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`} style={{ flexWrap: "wrap" }}>
        <DeckLegendDot label={s.progressDeckStarted} color={isDark ? "#2dd4bf" : "#0d9488"} isRTL={isRTL} />
        <DeckLegendDot label={s.flashcardsNewCards} color={isDark ? "#525252" : "#E5DDD4"} isRTL={isRTL} />
      </View>

      {totalCards > 0 ? (
        <View className="mt-5 gap-4">
          {items.map((item) => (
            <DefaultDeckProgressRow
              key={item.key}
              title={titles[item.key]}
              item={item}
              isDark={isDark}
              isRTL={isRTL}
              s={s}
            />
          ))}
        </View>
      ) : (
        <Text
          className="mt-5 text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 13, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {s.progressDefaultDecksEmpty}
        </Text>
      )}
    </Card>
  );
}

function DefaultDeckProgressRow({
  title,
  item,
  isDark,
  isRTL,
  s,
}: {
  title: string;
  item: DefaultDeckProgressItem;
  isDark: boolean;
  isRTL: boolean;
  s: any;
}) {
  const startedPct = item.total > 0 ? Math.round((item.startedCount / item.total) * 100) : 0;
  const barWidth = `${startedPct}%` as `${number}%`;
  return (
    <View>
      <View className={`mb-2 flex-row items-center justify-between gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
        <Text
          className="min-w-0 flex-1 text-charcoal dark:text-neutral-200"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 13, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          className="text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 12, fontVariant: ["tabular-nums"] }}
        >
          {`${item.startedCount.toLocaleString()} / ${item.total.toLocaleString()}`}
        </Text>
      </View>
      <View
        className="h-3 overflow-hidden rounded-full"
        style={{
          backgroundColor: isDark ? "#262626" : "#E9E1D8",
        }}
      >
        <View
          className="h-full rounded-full"
          style={{
            width: barWidth,
            alignSelf: isRTL ? "flex-end" : "flex-start",
            backgroundColor: item.color,
          }}
        />
      </View>
      <View className={`mt-2 flex-row flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
        <DeckMetric label={s.progressDeckStarted} value={item.startedCount} isDark={isDark} isRTL={isRTL} />
        <DeckMetric label={s.flashcardsNewCards} value={item.newCount} isDark={isDark} isRTL={isRTL} />
        <DeckMetric label={s.deckCardsFilterDue} value={item.dueCount} isDark={isDark} isRTL={isRTL} />
      </View>
    </View>
  );
}

function DeckMetric({
  label,
  value,
  isDark,
  isRTL,
}: {
  label: string;
  value: number;
  isDark: boolean;
  isRTL: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-1.5 rounded-full px-2.5 py-1 ${isRTL ? "flex-row-reverse" : ""}`}
      style={{ backgroundColor: isDark ? "#171717" : "#F5EEE7" }}
    >
      <Text
        className="text-charcoal dark:text-neutral-200"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 11, fontVariant: ["tabular-nums"] }}
      >
        {value.toLocaleString()}
      </Text>
      <Text
        className="text-warm-500 dark:text-neutral-500"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 10, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {label}
      </Text>
    </View>
  );
}

function DeckLegendDot({
  label,
  color,
  isRTL,
}: {
  label: string;
  color: string;
  isRTL: boolean;
}) {
  return (
    <View className={`flex-row items-center gap-1.5 ${isRTL ? "flex-row-reverse" : ""}`}>
      <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <Text
        className="text-warm-500 dark:text-neutral-500"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {label}
      </Text>
    </View>
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
      className="rounded-2xl px-4 py-3"
      style={{
        width: isLaptop ? 174 : "48%",
        minHeight: 74,
        justifyContent: "space-between",
        backgroundColor: isDark ? "#141414" : "#FFF8F1",
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
        className="text-warm-400 dark:text-neutral-500 mt-1"
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
