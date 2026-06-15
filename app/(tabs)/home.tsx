import React, { useState, useCallback, useEffect } from "react";
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Play, Layers, CalendarCheck2, Search, Languages, UserPlus, BookMarked, X as XIcon, Settings2, Sparkles, BookOpenText, ListEnd, List } from "lucide-react-native";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { interpolate } from "@/lib/i18n/useStrings";
import type { UIStrings } from "@/lib/i18n/strings";
import { Card } from "@/components/ui/Card";
import { ScreenScrollView } from "@/components/ui/ScreenContent";
import { DeckReviewSettingsSheet } from "@/components/flashcards/DeckReviewSettingsSheet";
import { DeckCardsSheet } from "@/components/flashcards/DeckCardsSheet";
import { SmartDeckFilterSheet } from "@/components/flashcards/SmartDeckFilterSheet";
import { SearchCommand } from "@/components/SearchCommand";
import { Toast } from "@/components/ui/Toast";
import { AchievementUnlockToast } from "@/components/achievements/AchievementUnlockToast";
import {
  getDeckTodayStats,
  getMemorizedAyahCardCount,
  getTodayDueCount,
  getWirdStatus,
  readDeckReviewSettings,
  MEANINGS_DECK_ID,
} from "@/lib/fsrs/queries";
import type { WirdStatus } from "@/lib/fsrs/queries";
import {
  migrateLegacyRetentionDecks,
  readSmartDeckFilter,
  SMART_DECK_IDS,
  type BuiltInDeckFilter,
  type SmartDeckId,
} from "@/lib/fsrs/smart-decks";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { subscribeSyncCompleted } from "@/lib/sync/events";
import {
  getLatestUnseenUnlock,
  markAchievementSeen,
  subscribeAchievementUnlocks,
} from "@/lib/achievements/queries";
import type { AchievementUnlock } from "@/lib/achievements/types";
import { getReflectionJourneySummary } from "@/lib/reflection-journey/queries";
import { localizeReflectionJourneyText } from "@/lib/reflection-journey/schema";
import { DESKTOP_CONTENT_MAX_WIDTH, VIEWPORT_BREAKPOINTS } from "@/lib/ui/viewport";

type SmartDeckDisplay = {
  id: SmartDeckId;
  title: string;
  subtitle: string;
  icon: typeof Sparkles;
  filter: BuiltInDeckFilter;
  total: number;
  dueCount: number;
  newCount: number;
};

type DeckReviewSettingsTarget = {
  id: string;
  title: string;
  mode: "ayah" | "word";
};

type DeckCardsTarget = {
  id: string;
  title: string;
};

export default function HomeScreen() {
  const db = useDatabase();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const mirroredRowStyle = isRTL ? ({ direction: "ltr" } as const) : undefined;
  const compactDeckCards = width <= VIEWPORT_BREAKPOINTS.phoneLarge;
  const [smartDecks, setSmartDecks] = useState<SmartDeckDisplay[]>([]);
  const [vocabStats, setVocabStats] = useState<{ total: number; dueCount: number; newCount: number }>({ total: 0, dueCount: 0, newCount: 0 });
  const [authBannerDismissed, setAuthBannerDismissed] = useState(false);
  const user = useAuthStore((state) => state.user);
  const [totalDue, setTotalDue] = useState(0);
  const [memorizedCards, setMemorizedCards] = useState(0);
  const [wirdStatus, setWirdStatus] = useState<WirdStatus>({
    currentDays: 0,
    longestDays: 0,
    maintainedToday: false,
    lastReviewDate: null,
    state: "empty",
  });
  const [showSearch, setShowSearch] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [filterDeckId, setFilterDeckId] = useState<SmartDeckId | null>(null);
  const [reviewSettingsTarget, setReviewSettingsTarget] = useState<DeckReviewSettingsTarget | null>(null);
  const [deckCardsTarget, setDeckCardsTarget] = useState<DeckCardsTarget | null>(null);
  const [surahNames, setSurahNames] = useState<Record<number, string>>({});
  const [resume, setResume] = useState<{ surah: number; ayah: number; page: number } | null>(null);
  const [latestUnlock, setLatestUnlock] = useState<AchievementUnlock | null>(null);
  const [dismissingUnlockId, setDismissingUnlockId] = useState<string | null>(null);
  const [journeySummary, setJourneySummary] = useState<{ totalLevels: number; completedLevels: number; currentLevelTitle: string | null }>({
    totalLevels: 0,
    completedLevels: 0,
    currentLevelTitle: null,
  });

  const loadLatestUnlock = useCallback(async () => {
    try {
      setLatestUnlock(await getLatestUnseenUnlock(db));
    } catch (e) {
      console.warn(e);
    }
  }, [db]);

  const loadData = useCallback(async () => {
    const surahRows = await db.getAllAsync<{ number: number; name_arabic: string; name_english: string }>(
      "SELECT number, name_arabic, name_english FROM surahs"
    );
    const nameMap: Record<number, string> = {};
    for (const row of surahRows) {
      nameMap[row.number] = uiLanguage === "ar" ? row.name_arabic : row.name_english;
    }
    setSurahNames(nameMap);
    await migrateLegacyRetentionDecks(db);

    const smartDefinitions = [
      {
        id: SMART_DECK_IDS.retention,
        title: s.smartDeckRetentionTitle,
        subtitle: s.smartDeckRetentionSubtitle,
        icon: Layers,
      },
      {
        id: SMART_DECK_IDS.mutashabihat,
        title: s.smartDeckMutashabihatTitle,
        subtitle: s.smartDeckMutashabihatSubtitle,
        icon: Sparkles,
      },
      {
        id: SMART_DECK_IDS.similarTails,
        title: s.smartDeckSimilarTailsTitle,
        subtitle: s.smartDeckSimilarTailsSubtitle,
        icon: ListEnd,
      },
      {
        id: SMART_DECK_IDS.qiraat,
        title: s.smartDeckQiraatTitle,
        subtitle: s.smartDeckQiraatSubtitle,
        icon: BookOpenText,
      },
      {
        id: SMART_DECK_IDS.reasonsOfRevelation,
        title: s.smartDeckReasonsTitle,
        subtitle: s.smartDeckReasonsSubtitle,
        icon: BookMarked,
      },
    ] as const;

    const smartDisplays = await Promise.all(
      smartDefinitions.map(async (definition) => {
        const [settings, filter] = await Promise.all([
          readDeckReviewSettings(db, definition.id),
          readSmartDeckFilter(db, definition.id),
        ]);
        const stats = await getDeckTodayStats(db, definition.id, settings);
        return {
          ...definition,
          filter,
          total: stats.total,
          dueCount: stats.dueCount,
          newCount: stats.newCount,
        };
      })
    );
    setSmartDecks(smartDisplays);

    const [dashboardSettings, vocabSettings] = await Promise.all([
      readDeckReviewSettings(db, undefined),
      readDeckReviewSettings(db, MEANINGS_DECK_ID),
    ]);
    const [dashboardDue, memorizedTotal, nextWirdStatus, vocabTodayStats, reflectionJourneySummary] = await Promise.all([
      getTodayDueCount(db, undefined, dashboardSettings),
      getMemorizedAyahCardCount(db),
      getWirdStatus(db),
      getDeckTodayStats(db, MEANINGS_DECK_ID, vocabSettings),
      getReflectionJourneySummary(db),
    ]);
    setTotalDue(dashboardDue);
    setMemorizedCards(memorizedTotal);
    setWirdStatus(nextWirdStatus);
    setVocabStats(vocabTodayStats);
    loadLatestUnlock();
    setJourneySummary({
      totalLevels: reflectionJourneySummary.totalLevels,
      completedLevels: reflectionJourneySummary.completedLevels,
      currentLevelTitle: reflectionJourneySummary.currentLevelTitle
        ? localizeReflectionJourneyText(reflectionJourneySummary.currentLevelTitle, uiLanguage)
        : null,
    });

    try {
      const row = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM user_settings WHERE key = 'last_mushaf_position'"
      );
      if (!row?.value) {
        setResume(null);
        return;
      }
      const parsed = JSON.parse(row.value);
      if (parsed?.mode === "page" && typeof parsed.page === "number") {
        const pageMeta = await db.getFirstAsync<{ surah_start: number; ayah_start: number }>(
          "SELECT surah_start, ayah_start FROM page_map WHERE page = ?",
          [parsed.page]
        );
        if (pageMeta) {
          setResume({ surah: pageMeta.surah_start, ayah: pageMeta.ayah_start, page: parsed.page });
        } else {
          setResume(null);
        }
      } else if (
        parsed?.mode === "verse" &&
        typeof parsed.surah === "number" &&
        typeof parsed.ayah === "number"
      ) {
        const page = await db.getFirstAsync<{ v2_page: number }>(
          "SELECT v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
          [parsed.surah, parsed.ayah]
        );
        setResume({ surah: parsed.surah, ayah: parsed.ayah, page: page?.v2_page ?? 1 });
      } else {
        setResume(null);
      }
    } catch {
      setResume(null);
    }
  }, [db, loadLatestUnlock, s.smartDeckRetentionTitle, s.smartDeckRetentionSubtitle, s.smartDeckMutashabihatTitle, s.smartDeckMutashabihatSubtitle, s.smartDeckSimilarTailsTitle, s.smartDeckSimilarTailsSubtitle, s.smartDeckQiraatTitle, s.smartDeckQiraatSubtitle, s.smartDeckReasonsTitle, s.smartDeckReasonsSubtitle, uiLanguage]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => subscribeReviewActivity(loadData), [loadData]);
  useEffect(() => subscribeSyncCompleted(({ pulled }) => {
    if (pulled > 0) loadData();
  }), [loadData]);

  useEffect(() => subscribeAchievementUnlocks((unlock) => setLatestUnlock(unlock)), []);

  const dismissLatestUnlock = useCallback(() => {
    if (!latestUnlock || dismissingUnlockId === latestUnlock.achievementId) return;
    const achievementId = latestUnlock.achievementId;
    setDismissingUnlockId(achievementId);
    markAchievementSeen(db, achievementId)
      .then(() => getLatestUnseenUnlock(db))
      .then((nextUnlock) => {
        setLatestUnlock((current) => {
          if (!current || current.achievementId === achievementId) return nextUnlock;
          return current;
        });
      })
      .catch(console.warn)
      .finally(() => {
        setDismissingUnlockId((current) => (current === achievementId ? null : current));
      });
  }, [db, dismissingUnlockId, latestUnlock]);

  const handleStartReview = (deckId?: string) => {
    router.push({ pathname: "/flashcards/session", params: deckId ? { deckId } : {} });
  };

  const getSmartFilterLabel = (filter: BuiltInDeckFilter): string => {
    if (filter.type === "surah") {
      const ranges = filter.ranges ?? [];
      if (ranges.length === 1 && filter.surahs.length === 1) {
        const range = ranges[0];
        return `${s.flashcardsScopeBysurah}: ${surahNames[range.surah] ?? range.surah} ${range.ayahStart}-${range.ayahEnd}`;
      }
      if (ranges.length > 0) {
        return `${s.flashcardsScopeBysurah}: ${filter.surahs.length} ${s.flashcardsScopeCustom}`;
      }
      if (filter.surahs.length === 1) {
        const n = filter.surahs[0];
        return `${s.flashcardsScopeBysurah}: ${surahNames[n] ?? n}`;
      }
      return `${s.flashcardsScopeBysurah}: ${filter.surahs.length}`;
    }
    if (filter.type === "juz") {
      return `${s.flashcardsScopeByjuz}: ${filter.juzNumbers.join(", ")}`;
    }
    return s.smartDeckFilterAll;
  };

  const getWirdMessage = (): string => {
    if (wirdStatus.maintainedToday) return s.wirdMaintained;
    if (wirdStatus.state === "open_today") return s.wirdOpenToday;
    return s.wirdBeginToday;
  };

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScreenScrollView maxWidth={DESKTOP_CONTENT_MAX_WIDTH} contentContainerStyle={{ paddingBottom: 100 }}>
        <View className="pt-6 pb-3">
          <View className={`flex-row items-center justify-between ${isRTL ? "flex-row-reverse" : ""}`} style={mirroredRowStyle}>
            <Text
              className="text-warm-400 dark:text-neutral-500 uppercase"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: 1.8 }}
            >
              {new Date().toLocaleDateString()}
            </Text>
            <Pressable
              onPress={() => setShowSearch(true)}
              className="w-10 h-10 items-center justify-center"
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
            >
              <Search size={22} color={isDark ? "#d4d4d4" : "#5C554E"} />
            </Pressable>
          </View>
        </View>

        {latestUnlock && (
          <AchievementUnlockToast unlock={latestUnlock} onDismiss={dismissLatestUnlock} />
        )}

        <View className="mb-6">
          <View className={`flex-row items-end justify-between gap-3 ${isRTL ? "flex-row-reverse" : ""}`} style={mirroredRowStyle}>
            <View className={`flex-1 flex-row items-end gap-3 ${isRTL ? "flex-row-reverse" : ""}`} style={mirroredRowStyle}>
              <View className={isRTL ? "items-end" : "items-start"}>
                <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "NotoSerif_700Bold", fontSize: 68, lineHeight: 68 }}>
                  {totalDue}
                </Text>
                <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}>
                  {s.flashcardsDueToday}
                </Text>
              </View>
              <View className={`pb-1 ${isRTL ? "items-end" : "items-start"}`}>
                <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 24, lineHeight: 28, fontVariant: ["tabular-nums"] }}>
                  {memorizedCards.toLocaleString()}
                </Text>
                <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 11, textAlign: isRTL ? "right" : "left" }}>
                  {s.homeMemorized}
                </Text>
              </View>
            </View>
            {totalDue > 0 && (
              <Pressable
                onPress={() => handleStartReview()}
                className={`rounded-full bg-primary-accent px-4 py-3 flex-row items-center gap-2 ${isRTL ? "flex-row-reverse" : ""}`}
                accessibilityRole="button"
                style={({ pressed }) => ({ ...(mirroredRowStyle ?? {}), transform: [{ scale: pressed ? 0.97 : 1 }] })}
              >
                <Play size={15} color="#fff" />
                <Text className="text-white" style={{ fontFamily: "Manrope_700Bold", fontSize: 12 }} numberOfLines={1}>
                  {s.flashcardsStartReview}
                </Text>
              </Pressable>
            )}
          </View>
          <View className={`flex-row items-center justify-between mt-4 rounded-3xl bg-surface-low dark:bg-surface-dark-low px-4 py-3 ${isRTL ? "flex-row-reverse" : ""}`} style={mirroredRowStyle}>
            <View className={`flex-row items-center gap-1.5 ${isRTL ? "flex-row-reverse" : ""}`} style={mirroredRowStyle}>
              <CalendarCheck2 size={14} color={isDark ? "#2dd4bf" : "#0d9488"} />
              <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 16 }}>
                {wirdStatus.currentDays.toLocaleString()}
              </Text>
              <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                {s.homeStreak}
              </Text>
            </View>
            <Text
              className="text-warm-500 dark:text-neutral-400 flex-shrink"
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 12,
                textAlign: isRTL ? "left" : "right",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {getWirdMessage()}
            </Text>
          </View>
        </View>

        {resume && (
          <Pressable
            onPress={() => router.push("/(tabs)/mushaf")}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
            className="mb-6"
          >
            <Card elevation="low" className="p-4 rounded-3xl">
              <View className="flex-row items-center gap-3">
                <View className="w-11 h-11 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
                  <Play size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />
                </View>
                <View className="flex-1">
                  <Text className="text-warm-400 dark:text-neutral-500 uppercase" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: 1.5 }}>
                    {s.goTo}
                  </Text>
                  <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
                    {`${s.flashcardsScopeBysurah} ${surahNames[resume.surah] ?? resume.surah} · ${resume.surah}:${resume.ayah}`}
                  </Text>
                  <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
                    {interpolate(s.pageN, { n: resume.page })}
                  </Text>
                </View>
              </View>
            </Card>
          </Pressable>
        )}

        {!user && !authBannerDismissed && (
          <Card elevation="low" className="p-4 mb-6">
            <View className="flex-row items-start gap-3">
              <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/15 items-center justify-center">
                <UserPlus size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-charcoal dark:text-neutral-200"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
                  numberOfLines={1}
                >
                  {s.homeAuthCardTitle}
                </Text>
                <Text
                  className="text-warm-400 dark:text-neutral-500 mt-0.5 mb-3"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18 }}
                >
                  {s.homeAuthCardSubtitle}
                </Text>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => router.push("/auth/login")}
                    className="rounded-full bg-primary-accent px-4 py-1.5"
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
                  >
                    <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                      {s.homeAuthCardSignIn}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push("/auth/signup")}
                    className="rounded-full bg-surface-high dark:bg-surface-dark-high px-4 py-1.5"
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
                  >
                    <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                      {s.homeAuthCardSignUp}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <Pressable
                onPress={() => setAuthBannerDismissed(true)}
                hitSlop={8}
                className="w-7 h-7 items-center justify-center"
              >
                <XIcon size={14} color={isDark ? "#737373" : "#8B8178"} />
              </Pressable>
            </View>
          </Card>
        )}

        {journeySummary.totalLevels > 0 && (
          <Pressable
            onPress={() => router.push("/reflection-journey" as Href)}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
            className="mb-6"
          >
            <Card elevation="low" className="p-5 rounded-4xl">
              <View className={`items-start justify-between ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                <View className={`flex-1 ${isRTL ? "items-end" : "items-start"}`}>
                  <Text
                    className="text-warm-400 dark:text-neutral-500 uppercase"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: 1.6 }}
                  >
                    {interpolate(s.reflectionJourneyProgress, {
                      completed: journeySummary.completedLevels,
                      total: journeySummary.totalLevels,
                    })}
                  </Text>
                  <Text
                    className="text-charcoal dark:text-neutral-100 mt-1"
                    style={{ fontFamily: "NotoSerif_700Bold", fontSize: 22, textAlign: isRTL ? "right" : "left" }}
                  >
                    {s.reflectionJourneyTitle}
                  </Text>
                  <Text
                    className="text-warm-500 dark:text-neutral-400 mt-1"
                    style={{ fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 21, textAlign: isRTL ? "right" : "left" }}
                  >
                    {journeySummary.currentLevelTitle
                      ? interpolate(s.reflectionJourneyCurrentLevel, { title: journeySummary.currentLevelTitle })
                      : s.reflectionJourneySubtitle}
                  </Text>
                </View>
                <View className="h-12 w-12 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
                  <BookMarked size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
                </View>
              </View>
            </Card>
          </Pressable>
        )}

        <View className={`mb-3 ${isRTL ? "items-end" : "items-start"}`}>
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {s.flashcardsDecks}
          </Text>
        </View>

        <View className="gap-2 mb-3">
          {smartDecks.map((deck) => (
            <SmartDeckCard
              key={deck.id}
              deck={deck}
              filterLabel={getSmartFilterLabel(deck.filter)}
              onStartReview={() => handleStartReview(deck.id)}
              onConfigure={() => setFilterDeckId(deck.id)}
              onShowCards={() => setDeckCardsTarget({ id: deck.id, title: deck.title })}
              isDark={isDark}
              isRTL={isRTL}
              compact={compactDeckCards}
              s={s}
            />
          ))}
          {vocabStats.total > 0 && (
            <VocabularyDeckCard
              stats={vocabStats}
              onStartReview={() => handleStartReview(MEANINGS_DECK_ID)}
              onConfigure={() => setReviewSettingsTarget({ id: MEANINGS_DECK_ID, title: s.vocabDeckTitle, mode: "word" })}
              onShowCards={() => setDeckCardsTarget({ id: MEANINGS_DECK_ID, title: s.vocabDeckTitle })}
              isDark={isDark}
              isRTL={isRTL}
              compact={compactDeckCards}
              s={s}
            />
          )}
        </View>
      </ScreenScrollView>

      <SearchCommand visible={showSearch} onClose={() => setShowSearch(false)} />

      <SmartDeckFilterSheet
        visible={!!filterDeckId}
        deckId={filterDeckId}
        onClose={() => setFilterDeckId(null)}
        onSaved={loadData}
      />

      <DeckReviewSettingsSheet
        visible={!!reviewSettingsTarget}
        deckId={reviewSettingsTarget?.id ?? null}
        deckTitle={reviewSettingsTarget?.title ?? ""}
        mode={reviewSettingsTarget?.mode ?? "ayah"}
        onClose={() => setReviewSettingsTarget(null)}
        onSaved={() => {
          setToast(s.deckReviewSettingsSaved);
          loadData();
        }}
      />

      <DeckCardsSheet
        visible={!!deckCardsTarget}
        deckId={deckCardsTarget?.id ?? null}
        deckTitle={deckCardsTarget?.title ?? ""}
        onClose={() => setDeckCardsTarget(null)}
        onChanged={loadData}
      />

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </SafeAreaView>
  );
}

function SmartDeckCard({
  deck,
  filterLabel,
  onStartReview,
  onConfigure,
  onShowCards,
  isDark,
  isRTL,
  compact,
  s,
}: {
  deck: SmartDeckDisplay;
  filterLabel: string;
  onStartReview: () => void;
  onConfigure: () => void;
  onShowCards: () => void;
  isDark: boolean;
  isRTL: boolean;
  compact: boolean;
  s: UIStrings;
}) {
  const Icon = deck.icon;
  const canStart = deck.total > 0;
  const iconNode = (
    <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
      <Icon size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
    </View>
  );
  const textNode = (
    <View className={`flex-1 ${isRTL ? "items-end" : "items-start"}`} style={{ minWidth: 0 }}>
      <Text
        className="text-charcoal dark:text-neutral-200"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
        numberOfLines={compact ? undefined : 1}
      >
        {deck.title}
      </Text>
      <Text
        className="text-warm-400 dark:text-neutral-500 mt-0.5"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 11, lineHeight: 16, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
        numberOfLines={compact ? undefined : 1}
      >
        {deck.subtitle} · {filterLabel}
      </Text>
    </View>
  );
  const actionNodes = (
    <View
      className="flex-row items-center gap-1"
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Pressable
        onPress={(event) => {
          event.stopPropagation?.();
          onShowCards();
        }}
        accessibilityRole="button"
        accessibilityLabel={s.deckCardsTitle}
        className="w-8 h-8 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center"
        hitSlop={8}
      >
        <List size={14} color={isDark ? "#a3a3a3" : "#8B8178"} />
      </Pressable>
      <Pressable
        onPress={(event) => {
          event.stopPropagation?.();
          onConfigure();
        }}
        className="w-8 h-8 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center"
        hitSlop={8}
      >
        <Settings2 size={14} color={isDark ? "#a3a3a3" : "#8B8178"} />
      </Pressable>
    </View>
  );
  const statsNode = <DeckStats total={deck.total} newCount={deck.newCount} dueCount={deck.dueCount} isDark={isDark} isRTL={isRTL} />;

  return (
    <Pressable
      onPress={canStart ? onStartReview : undefined}
      accessibilityRole="button"
      style={({ pressed }) => ({
        opacity: canStart ? 1 : 0.55,
        transform: [{ scale: pressed && canStart ? 0.985 : 1 }],
      })}
    >
      <Card elevation="low" className="px-4 py-3 rounded-3xl">
        {compact ? (
          <View className="gap-3">
            <View
              className="items-center gap-3"
              style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              {iconNode}
              {textNode}
            </View>
            <View
              className="items-center justify-between gap-2"
              style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              {actionNodes}
              {statsNode}
            </View>
          </View>
        ) : (
          <View
            className="items-center gap-3"
            style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
          >
            {iconNode}
            {textNode}
            {actionNodes}
            {statsNode}
          </View>
        )}
      </Card>
    </Pressable>
  );
}

function VocabularyDeckCard({
  stats,
  onStartReview,
  onConfigure,
  onShowCards,
  isDark,
  isRTL,
  compact,
  s,
}: {
  stats: { total: number; dueCount: number; newCount: number };
  onStartReview: () => void;
  onConfigure: () => void;
  onShowCards: () => void;
  isDark: boolean;
  isRTL: boolean;
  compact: boolean;
  s: UIStrings;
}) {
  const canStart = stats.total > 0;
  const iconNode = (
    <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
      <Languages size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
    </View>
  );
  const textNode = (
    <View className={`flex-1 ${isRTL ? "items-end" : "items-start"}`} style={{ minWidth: 0 }}>
      <Text
        className="text-charcoal dark:text-neutral-200"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
        numberOfLines={compact ? undefined : 1}
      >
        {s.vocabDeckTitle}
      </Text>
      <Text
        className="text-warm-400 dark:text-neutral-500 mt-0.5"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 11, lineHeight: 16, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
        numberOfLines={compact ? undefined : 1}
      >
        {s.vocabDeckSubtitle}
      </Text>
    </View>
  );
  const actionNodes = (
    <View
      className="flex-row items-center gap-1"
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Pressable
        onPress={(event) => {
          event.stopPropagation?.();
          onShowCards();
        }}
        accessibilityRole="button"
        accessibilityLabel={s.deckCardsTitle}
        className="w-8 h-8 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center"
        hitSlop={8}
      >
        <List size={14} color={isDark ? "#a3a3a3" : "#8B8178"} />
      </Pressable>
      <Pressable
        onPress={(event) => {
          event.stopPropagation?.();
          onConfigure();
        }}
        accessibilityRole="button"
        accessibilityLabel={s.deckReviewSettingsTitle}
        className="w-8 h-8 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center"
        hitSlop={8}
      >
        <Settings2 size={14} color={isDark ? "#a3a3a3" : "#8B8178"} />
      </Pressable>
    </View>
  );
  const statsNode = <DeckStats total={stats.total} newCount={stats.newCount} dueCount={stats.dueCount} isDark={isDark} isRTL={isRTL} />;

  return (
    <Pressable
      onPress={canStart ? onStartReview : undefined}
      accessibilityRole="button"
      style={({ pressed }) => ({
        opacity: canStart ? 1 : 0.55,
        transform: [{ scale: pressed && canStart ? 0.985 : 1 }],
      })}
    >
      <Card elevation="low" className="px-4 py-3 rounded-3xl">
        {compact ? (
          <View className="gap-3">
            <View
              className="items-center gap-3"
              style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              {iconNode}
              {textNode}
            </View>
            <View
              className="items-center justify-between gap-2"
              style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              {actionNodes}
              {statsNode}
            </View>
          </View>
        ) : (
          <View
            className="items-center gap-3"
            style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
          >
            {iconNode}
            {textNode}
            {actionNodes}
            {statsNode}
          </View>
        )}
      </Card>
    </Pressable>
  );
}

function DeckStats({
  total,
  newCount,
  dueCount,
  showReviewStats = true,
  isDark,
  isRTL,
}: {
  total: number;
  newCount: number;
  dueCount: number;
  showReviewStats?: boolean;
  isDark: boolean;
  isRTL: boolean;
}) {
  const { themeColors } = useSettings();
  return (
    <View className={`flex-row items-center gap-2 ${isRTL ? "flex-row-reverse" : ""}`} style={{ direction: "ltr" }}>
      <Text
        className="text-charcoal dark:text-neutral-100 text-center min-w-[30px]"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 14, fontVariant: ["tabular-nums"] }}
      >
        {total}
      </Text>
      {showReviewStats && (
        <>
          <View style={{ width: 1, height: 20, backgroundColor: themeColors.surfaceDim }} />
          <Text
            className="text-center min-w-[24px]"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 14, fontVariant: ["tabular-nums"], color: isDark ? "#4ade80" : "#16a34a" }}
          >
            {newCount}
          </Text>
          <Text
            className="text-center min-w-[24px]"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 14, fontVariant: ["tabular-nums"], color: isDark ? "#f87171" : "#dc2626" }}
          >
            {dueCount}
          </Text>
        </>
      )}
    </View>
  );
}
