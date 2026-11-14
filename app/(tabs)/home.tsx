import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { formatAyahRef, toArabicNumber } from "@/lib/arabic";
import { useRouter, type Href } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  Play,
  Layers,
  Search,
  Languages,
  UserPlus,
  BookMarked,
  X as XIcon,
  Settings2,
  Sparkles,
  BookOpenText,
  ListEnd,
  List,
} from "lucide-react-native";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import type { UIStrings } from "@/lib/i18n/strings";
import { Card } from "@/components/ui/Card";
import { Screen, ScreenScrollView, TAB_SCREEN_BOTTOM_INSET } from "@/components/ui/ScreenContent";
import { DeckReviewSettingsSheet } from "@/components/flashcards/DeckReviewSettingsSheet";
import { DeckCardsSheet } from "@/components/flashcards/DeckCardsSheet";
import { SmartDeckFilterSheet } from "@/components/flashcards/SmartDeckFilterSheet";
import { SearchCommand } from "@/components/SearchCommand";
import { Toast } from "@/components/ui/Toast";
import { Skeleton } from "@/components/ui/Skeleton";
import { AchievementUnlockToast } from "@/components/achievements/AchievementUnlockToast";
import {
  getDeckTodayStats,
  getMemorizedAyahCardCount,
  readDeckReviewSettings,
  MEANINGS_DECK_ID,
} from "@/lib/fsrs/queries";
import { WirdStreakCard } from "@/components/habit/WirdStreakCard";
import { WirdReminderBanner } from "@/components/notifications/WirdReminderBanner";
import { HabitBreakSheet } from "@/components/habit/HabitBreakSheet";
import { useHabitOverview } from "@/lib/habit/use-habit-overview";
import { markFullWirdIfComplete } from "@/lib/habit/queries";
import { WirdPlanCard } from "@/components/hifz/WirdPlanCard";
import { WelcomeBackCard } from "@/components/hifz/WelcomeBackCard";
import { WirdExtras } from "@/components/habit/WirdExtras";
import { MonthlyCheckCard } from "@/components/hifz/MonthlyCheckCard";
import { reviewLeftToday } from "@/lib/hifz/pages";
import { markMonthlyCheck } from "@/lib/hifz/progress";
import { diffDays } from "@/lib/habit/dates";
import { useTodayWird } from "@/lib/hifz/use-today-wird";
import { reminderHref } from "@/lib/notifications/reminder-route";
import { putUserSetting } from "@/lib/database/user-settings";
import {
  migrateLegacyRetentionDecks,
  readSmartDeckFilter,
  SMART_DECK_IDS,
  type BuiltInDeckFilter,
  type SmartDeckId,
} from "@/lib/fsrs/smart-decks";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { subscribeSyncCompleted } from "@/lib/sync/events";
import { getLatestUnseenUnlock, markAchievementSeen, subscribeAchievementUnlocks } from "@/lib/achievements/queries";
import type { AchievementUnlock } from "@/lib/achievements/types";
import { getReflectionJourneySummary } from "@/lib/reflection-journey/queries";
import { localizeReflectionJourneyText } from "@/lib/reflection-journey/schema";
import { DESKTOP_CONTENT_MAX_WIDTH, VIEWPORT_BREAKPOINTS } from "@/lib/ui/viewport";
import { AppReleaseCard } from "@/components/app-update/AppReleaseCard";
import { textStartStyle, textEndStyle } from "@/lib/ui/direction";

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

const GRACE_NOTE_SEEN_KEY = "device_habit_grace_note_seen";

function formatArabicDate(date: Date): string {
  return [date.getDate(), date.getMonth() + 1, date.getFullYear()].map(toArabicNumber).join("/");
}

export default function HomeScreen() {
  const db = useDatabase();
  const { isDark, isRTL, uiLanguage } = useSettings();
  // Arabic uses Arabic-Indic digits, matching the reader.
  const localNumber = (value: number) => (isRTL ? toArabicNumber(value) : value.toLocaleString());
  const s = useStrings();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const mirroredRowStyle = isRTL ? ({ direction: "ltr" } as const) : undefined;
  const compactDeckCards = width <= VIEWPORT_BREAKPOINTS.phoneLarge;
  const [smartDecks, setSmartDecks] = useState<SmartDeckDisplay[]>([]);
  /** The header row's width, measured, so Start Review can take its own full-width line when needed. */
  const [headerWidth, setHeaderWidth] = useState(0);
  const [vocabStats, setVocabStats] = useState<{ total: number; dueCount: number; newCount: number }>({
    total: 0,
    dueCount: 0,
    newCount: 0,
  });
  const [authBannerDismissed, setAuthBannerDismissed] = useState(false);
  const user = useAuthStore((state) => state.user);
  // Ayah reviews due now in the ayah decks, without new cards: ayah review's daily work (UNIT-02).
  const ayahReviewsDue = smartDecks.reduce((sum, deck) => sum + deck.dueCount, 0);
  // The headline is what the deck rows offer, which is also what Review all loads.
  const totalDue = smartDecks.reduce(
    (sum, deck) => sum + deck.dueCount + deck.newCount,
    vocabStats.dueCount + vocabStats.newCount,
  );
  // The counts and Start Review need about 330 px at standard text size; each further digit of the
  // due count widens the big number by about 38 px, and larger system text widens everything.
  const headerNeeds = (totalDue >= 1000 ? 420 : totalDue >= 100 ? 370 : 330) * Math.max(1, fontScale);
  const headerStacked = headerWidth > 0 && headerWidth < headerNeeds;
  const [memorizedCards, setMemorizedCards] = useState(0);
  const { overview: habit, failed: habitFailed } = useHabitOverview(db);
  const { wird, inboxCount, remediationDue, monthlyCheckDue, secondLooksDue, nextLookAt, refresh: refreshWird } = useTodayWird(db);
  const [habitBreakOpen, setHabitBreakOpen] = useState(false);
  const [graceNoteSeen, setGraceNoteSeen] = useState<string | null>(null);
  const [dueLoaded, setDueLoaded] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filterDeckId, setFilterDeckId] = useState<SmartDeckId | null>(null);
  const [reviewSettingsTarget, setReviewSettingsTarget] = useState<DeckReviewSettingsTarget | null>(null);
  const [deckCardsTarget, setDeckCardsTarget] = useState<DeckCardsTarget | null>(null);
  const [surahNames, setSurahNames] = useState<Record<number, string>>({});
  const [resume, setResume] = useState<{ surah: number; ayah: number; page: number } | null>(null);
  const [latestUnlock, setLatestUnlock] = useState<AchievementUnlock | null>(null);
  const [dismissingUnlockId, setDismissingUnlockId] = useState<string | null>(null);
  const [journeySummary, setJourneySummary] = useState<{
    totalLevels: number;
    completedLevels: number;
    currentLevelTitle: string | null;
  }>({
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

  const loadDashboard = useCallback(
    async (isCurrent: () => boolean) => {
      const surahRows = await db.getAllAsync<{ number: number; name_arabic: string; name_english: string }>(
        "SELECT number, name_arabic, name_english FROM surahs",
      );
      const nameMap: Record<number, string> = {};
      for (const row of surahRows) {
        nameMap[row.number] = uiLanguage === "ar" ? row.name_arabic : row.name_english;
      }
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
        }),
      );

      const vocabSettings = await readDeckReviewSettings(db, MEANINGS_DECK_ID);
      const [memorizedTotal, vocabTodayStats, reflectionJourneySummary, graceSeen] =
        await Promise.all([
          getMemorizedAyahCardCount(db),
          getDeckTodayStats(db, MEANINGS_DECK_ID, vocabSettings),
          getReflectionJourneySummary(db),
          db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [GRACE_NOTE_SEEN_KEY]),
        ]);
      const currentLevelTitle = reflectionJourneySummary.currentLevelTitle
        ? localizeReflectionJourneyText(reflectionJourneySummary.currentLevelTitle, uiLanguage)
        : null;
      // Apply the dashboard only once every query succeeded, so a failure keeps the last good values,
      // and only for the latest load, so an older overlapping load cannot overwrite a newer one.
      if (!isCurrent()) return;
      setSurahNames(nameMap);
      setSmartDecks(smartDisplays);
      setMemorizedCards(memorizedTotal);
      setGraceNoteSeen(graceSeen?.value ?? null);
      setVocabStats(vocabTodayStats);
      setDueLoaded(true);
      loadLatestUnlock();
      setJourneySummary({
        totalLevels: reflectionJourneySummary.totalLevels,
        completedLevels: reflectionJourneySummary.completedLevels,
        currentLevelTitle,
      });

      const applyResume = (value: { surah: number; ayah: number; page: number } | null) => {
        if (isCurrent()) setResume(value);
      };
      try {
        const row = await db.getFirstAsync<{ value: string }>(
          "SELECT value FROM user_settings WHERE key = 'last_mushaf_position'",
        );
        if (!row?.value) {
          applyResume(null);
          return;
        }
        const parsed = JSON.parse(row.value);
        if (parsed?.mode === "page" && typeof parsed.page === "number") {
          const pageMeta = await db.getFirstAsync<{ surah_start: number; ayah_start: number }>(
            "SELECT surah_start, ayah_start FROM page_map WHERE page = ?",
            [parsed.page],
          );
          if (pageMeta) {
            applyResume({ surah: pageMeta.surah_start, ayah: pageMeta.ayah_start, page: parsed.page });
          } else {
            applyResume(null);
          }
        } else if (parsed?.mode === "verse" && typeof parsed.surah === "number" && typeof parsed.ayah === "number") {
          const page = await db.getFirstAsync<{ v2_page: number }>(
            "SELECT v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
            [parsed.surah, parsed.ayah],
          );
          applyResume({ surah: parsed.surah, ayah: parsed.ayah, page: page?.v2_page ?? 1 });
        } else {
          applyResume(null);
        }
      } catch {
        applyResume(null);
      }
    },
    [
      db,
      loadLatestUnlock,
      s.smartDeckRetentionTitle,
      s.smartDeckRetentionSubtitle,
      s.smartDeckMutashabihatTitle,
      s.smartDeckMutashabihatSubtitle,
      s.smartDeckSimilarTailsTitle,
      s.smartDeckSimilarTailsSubtitle,
      s.smartDeckQiraatTitle,
      s.smartDeckQiraatSubtitle,
      s.smartDeckReasonsTitle,
      s.smartDeckReasonsSubtitle,
      uiLanguage,
    ],
  );

  const latestLoad = useRef(0);
  const loadData = useCallback(async () => {
    const load = ++latestLoad.current;
    const isCurrent = () => load === latestLoad.current;
    try {
      await loadDashboard(isCurrent);
      if (isCurrent()) setLoadFailed(false);
    } catch (e) {
      console.warn(e);
      if (isCurrent()) setLoadFailed(true);
    }
  }, [loadDashboard]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  useEffect(() => subscribeReviewActivity(loadData), [loadData]);
  useEffect(
    () =>
      subscribeSyncCompleted(({ pulled }) => {
        if (pulled > 0) loadData();
      }),
    [loadData],
  );

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
        return `${s.flashcardsScopeBysurah}: ${surahNames[range.surah] ?? localNumber(range.surah)} ${localNumber(range.ayahStart)}-${localNumber(range.ayahEnd)}`;
      }
      if (ranges.length > 0) {
        return `${s.flashcardsScopeBysurah}: ${localNumber(filter.surahs.length)} ${s.flashcardsScopeCustom}`;
      }
      if (filter.surahs.length === 1) {
        const n = filter.surahs[0];
        return `${s.flashcardsScopeBysurah}: ${surahNames[n] ?? localNumber(n)}`;
      }
      return `${s.flashcardsScopeBysurah}: ${localNumber(filter.surahs.length)}`;
    }
    if (filter.type === "juz") {
      return `${s.flashcardsScopeByjuz}: ${filter.juzNumbers.map(localNumber).join(isRTL ? "، " : ", ")}`;
    }
    return s.smartDeckFilterAll;
  };

  // GOAL-04: once the minimum is met and today's pages, new lines and every Home deck are done, the
  // full wird is complete.
  const planRemaining =
    wird === undefined
      ? 1
      : wird === null
        ? 0
        : wird.todo.length +
          // A half page or seam due after a missed page is part of today's review (SCH-06, SCH-08).
          remediationDue +
          (wird.newLines > 0 && !wird.daily.backlog && !wird.sabaqDoneToday ? 1 : 0);
  const remainingToday = totalDue + planRemaining;
  // MST-01: with page or half-page review, Home counts memorized pages instead of ayah cards.
  const pageMode = !!wird && wird.plan.unit !== "ayah";
  // 6.4: after 7 or more days without a wird, welcome the user back before today's review.
  const lastWirdDay = habit ? habit.days.filter((day) => day.localDate <= habit.today).at(-1)?.localDate ?? null : null;
  const returning =
    !!habit && !!wird && wird.todo.length > 0 && !habit.streak.doneToday && lastWirdDay !== null && diffDays(lastWirdDay, habit.today) >= 7;
  useEffect(() => {
    if (!dueLoaded || !habit?.streak.doneToday || remainingToday > 0) return;
    markFullWirdIfComplete(db, { now: new Date(), remaining: remainingToday }).catch(console.warn);
  }, [db, dueLoaded, habit?.streak.doneToday, remainingToday]);

  const dismissGraceNote = useCallback(() => {
    const seen = habit?.recentGraceDay;
    if (!seen) return;
    setGraceNoteSeen(seen);
    putUserSetting(db, GRACE_NOTE_SEEN_KEY, seen).catch(console.warn);
  }, [db, habit?.recentGraceDay]);

  return (
    <Screen>
      <ScreenScrollView maxWidth={DESKTOP_CONTENT_MAX_WIDTH} bottomInset={TAB_SCREEN_BOTTOM_INSET}>
        <View className="pt-6 pb-3">
          <View
            className={`flex-row items-center justify-between ${isRTL ? "flex-row-reverse" : ""}`}
            style={mirroredRowStyle}
          >
            <Text
              className="text-warm-400 dark:text-neutral-500 uppercase"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: 1.8 }}
            >
              {isRTL ? formatArabicDate(new Date()) : new Date().toLocaleDateString()}
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

        {loadFailed && (
          <Card elevation="low" className="p-4 mb-6">
            <View className={`items-center gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`} style={mirroredRowStyle}>
              <Text
                className="flex-1 text-charcoal dark:text-neutral-200"
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 13,
                  lineHeight: 19,
                  ...textStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
                accessibilityRole="alert"
              >
                {s.homeLoadFailed}
              </Text>
              <Pressable
                onPress={loadData}
                accessibilityRole="button"
                hitSlop={8}
                className="rounded-full bg-primary-accent px-4 py-2 min-h-[36px] justify-center"
                style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
              >
                <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                  {s.homeLoadRetry}
                </Text>
              </Pressable>
            </View>
          </Card>
        )}

        {latestUnlock && <AchievementUnlockToast unlock={latestUnlock} onDismiss={dismissLatestUnlock} />}

        <View className="mb-6">
          {/* The counts and Start Review share a row when there is room (about 330 px, 370 px with a
              three-digit due count). Otherwise Start Review takes its own full-width line below the
              counts, the same in both languages, instead of wrapping as a stray pill. */}
          <View
            onLayout={(event) => setHeaderWidth(Math.round(event.nativeEvent.layout.width))}
            className={headerStacked ? "gap-3" : `flex-row items-end justify-between gap-3 ${isRTL ? "flex-row-reverse" : ""}`}
            style={headerStacked ? undefined : mirroredRowStyle}
          >
            {/* Stacked, the counts may still need more than one line at very large text sizes. */}
            <View
              className={`${headerStacked ? "flex-wrap" : "grow shrink-0"} flex-row items-end gap-3 ${isRTL ? "flex-row-reverse" : ""}`}
              style={mirroredRowStyle}
            >
              <View className={isRTL ? "items-end" : "items-start"}>
                <Text
                  className="text-charcoal dark:text-neutral-100"
                  // Already display size; larger system text grows it only a little more.
                  maxFontSizeMultiplier={1.3}
                  style={{ fontFamily: "NotoSerif_700Bold", fontSize: 68, lineHeight: 68 }}
                >
                  {localNumber(totalDue)}
                </Text>
                <Text
                  className="text-warm-400 dark:text-neutral-500"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL)}}
                >
                  {s.flashcardsDueToday}
                </Text>
              </View>
              <View className={`pb-1 ${isRTL ? "items-end" : "items-start"}`}>
                <Text
                  className="text-warm-500 dark:text-neutral-400"
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    fontSize: 24,
                    lineHeight: 28,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {localNumber(pageMode ? wird!.memorizedPages : memorizedCards)}
                </Text>
                <Text
                  className="text-warm-400 dark:text-neutral-500"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 11, ...textStartStyle(isRTL)}}
                >
                  {pageMode ? s.hifzHomeMemorizedPages : s.homeMemorized}
                </Text>
              </View>
            </View>
            {totalDue > 0 && (
              <Pressable
                onPress={() => handleStartReview()}
                className={`min-h-[44px] rounded-full bg-primary-accent px-4 py-3 flex-row items-center gap-2 ${headerStacked ? "justify-center" : ""} ${isRTL ? "flex-row-reverse" : ""}`}
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
          {/* NOT-03: the in-app reminder, on web and while native notifications are off. Its Start opens
              the same plan-aware route as a notification tap (lib/notifications/reminder-route). */}
          <WirdReminderBanner />
          {habit ? (
            <WirdStreakCard
              overview={habit}
              language={uiLanguage}
              isDark={isDark}
              s={s}
              graceNoteDismissed={habit.recentGraceDay !== null && graceNoteSeen === habit.recentGraceDay}
              onDismissGraceNote={dismissGraceNote}
              onOpenBreak={() => setHabitBreakOpen(true)}
              // Unknown while the wird loads; without a plan there is no wird review to wait for.
              wirdLeft={wird === undefined || (wird !== null && reviewLeftToday(wird, { remediationDue, ayahReviewsDue }))}
            />
          ) : habitFailed ? null : (
            // Hold the card's place while it loads, so the content below does not jump down.
            <Skeleton isDark={isDark} height={64} borderRadius={24} className="mt-4" accessibilityElementsHidden />
          )}
        </View>

        {returning ? (
          <WelcomeBackCard
            language={uiLanguage}
            s={s}
            showZayt={habit?.settings.showZayt ?? true}
            onChoose={(level) =>
              router.push({ pathname: "/hifz/review", params: { mode: "welcome_back", level: String(level) } } as Href)
            }
          />
        ) : null}

        {wird !== undefined ? (
          <WirdPlanCard
            wird={wird}
            inboxCount={inboxCount}
            secondLooksDue={secondLooksDue}
            nextLookAt={nextLookAt}
            ayahDue={totalDue}
            language={uiLanguage}
            isDark={isDark}
            s={s}
            // Like the wird reminder: the page review, or the ayah review when the plan reviews ayat (UNIT-02).
            onStartReview={() => router.push(reminderHref("wird", wird?.plan ?? null))}
            onStartSabaq={() => router.push("/hifz/sabaq" as Href)}
            onSetup={() => router.push("/hifz/setup" as Href)}
            onDrill={() => router.push({ pathname: "/hifz/review", params: { mode: "mistakes" } } as Href)}
          />
        ) : (
          <Skeleton isDark={isDark} height={160} borderRadius={32} className="mb-6" accessibilityElementsHidden />
        )}

        {monthlyCheckDue && !returning ? (
          <MonthlyCheckCard
            language={uiLanguage}
            s={s}
            onStart={() => router.push({ pathname: "/hifz/review", params: { mode: "monthly_check" } } as Href)}
            onDecline={() => {
              markMonthlyCheck(db).then(refreshWird).catch(console.warn);
            }}
          />
        ) : null}

        {wird ? (
          <WirdExtras
            db={db}
            inboxCount={inboxCount}
            hasMemorizedPages={wird.memorizedPages > 0}
            sabaqToday={wird.sabaqDoneToday}
            language={uiLanguage}
            isDark={isDark}
            s={s}
            onStrengthen={() => router.push({ pathname: "/hifz/review", params: { mode: "mistakes" } } as Href)}
            onConnect={() => router.push("/hifz/review" as Href)}
          />
        ) : null}

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
                  <Text
                    className="text-warm-400 dark:text-neutral-500 uppercase"
                    // Letter spacing would break the joins between Arabic letters.
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: isRTL ? 0 : 1.5 }}
                  >
                    {s.continueReading}
                  </Text>
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
                  >
                    {`${surahNames[resume.surah] ? interpolate(s.surahNamed, { name: surahNames[resume.surah] }) : resume.surah}${isRTL ? "، " : " · "}${formatAyahRef(isRTL, resume.surah, resume.ayah)}`}
                  </Text>
                  <Text
                    className="text-warm-400 dark:text-neutral-500"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
                  >
                    {interpolate(s.pageN, { n: localNumber(resume.page) })}
                  </Text>
                </View>
              </View>
            </Card>
          </Pressable>
        )}

        <AppReleaseCard />

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
                    <Text
                      className="text-charcoal dark:text-neutral-200"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                    >
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
                    style={{ fontFamily: "NotoSerif_700Bold", fontSize: 22, ...textStartStyle(isRTL)}}
                  >
                    {s.reflectionJourneyTitle}
                  </Text>
                  <Text
                    className="text-warm-500 dark:text-neutral-400 mt-1"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 13,
                      lineHeight: 21,
                      ...textStartStyle(isRTL),
                    }}
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

        {/* Hand-mirrored alignment pins LTR coordinates; under the RTL tab root it flipped twice. */}
        <View className={`mb-3 ${isRTL ? "items-end" : "items-start"}`} style={{ direction: "ltr" }}>
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{
              fontFamily: "Manrope_600SemiBold",
              fontSize: 16,
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
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
              onConfigure={() =>
                setReviewSettingsTarget({ id: MEANINGS_DECK_ID, title: s.vocabDeckTitle, mode: "word" })
              }
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

      <HabitBreakSheet
        open={habitBreakOpen}
        onClose={() => setHabitBreakOpen(false)}
        db={db}
        pause={habit?.settings.pause ?? null}
        language={uiLanguage}
        isDark={isDark}
        s={s}
      />

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </Screen>
  );
}

/**
 * A deck card whose body starts its review. The start target sits behind the content instead of
 * wrapping it, so the card-list and settings buttons are siblings rather than buttons nested inside
 * a button (invalid on web and read as one control by screen readers). Content ignores touches so
 * taps on the text reach the start target.
 */
function DeckCardShell({
  canStart,
  onStartReview,
  label,
  compact,
  isRTL,
  iconNode,
  textNode,
  actionNodes,
  statsNode,
}: {
  canStart: boolean;
  onStartReview: () => void;
  label: string;
  compact: boolean;
  isRTL: boolean;
  iconNode: React.ReactNode;
  textNode: React.ReactNode;
  actionNodes: React.ReactNode;
  statsNode: React.ReactNode;
}) {
  const row = { direction: "ltr" as const, flexDirection: isRTL ? ("row-reverse" as const) : ("row" as const) };
  const passive = <View style={{ pointerEvents: "none" }}>{iconNode}</View>;
  const passiveText = <View style={{ flex: 1, minWidth: 0, pointerEvents: "none" }}>{textNode}</View>;
  const passiveStats = <View style={{ pointerEvents: "none" }}>{statsNode}</View>;
  return (
    <Card elevation="low" className="px-4 py-3 rounded-3xl" style={{ opacity: canStart ? 1 : 0.55 }}>
      <Pressable
        onPress={canStart ? onStartReview : undefined}
        disabled={!canStart}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !canStart }}
        style={({ pressed }) => [
          StyleSheet.absoluteFill,
          { backgroundColor: pressed && canStart ? "rgba(13, 148, 136, 0.08)" : "transparent" },
        ]}
      />
      {compact ? (
        <View className="gap-3" pointerEvents="box-none">
          <View className="items-center gap-3" style={row} pointerEvents="box-none">
            {passive}
            {passiveText}
          </View>
          <View className="items-center justify-between gap-2" style={row} pointerEvents="box-none">
            {actionNodes}
            {passiveStats}
          </View>
        </View>
      ) : (
        // box-none goes through the prop: React Native Web ignores it as a style value.
        <View className="items-center gap-3" style={row} pointerEvents="box-none">
          {passive}
          {passiveText}
          {actionNodes}
          {passiveStats}
        </View>
      )}
    </Card>
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
        style={{
          fontFamily: "Manrope_600SemiBold",
          fontSize: 14,
          ...textStartStyle(isRTL),
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
        numberOfLines={compact ? undefined : 1}
      >
        {deck.title}
      </Text>
      <Text
        className="text-warm-400 dark:text-neutral-500 mt-0.5"
        style={{
          fontFamily: "Manrope_400Regular",
          fontSize: 11,
          lineHeight: 16,
          ...textStartStyle(isRTL),
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
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
        accessibilityRole="button"
        accessibilityLabel={s.smartDeckFilterTitle}
        className="w-8 h-8 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center"
        hitSlop={8}
      >
        <Settings2 size={14} color={isDark ? "#a3a3a3" : "#8B8178"} />
      </Pressable>
    </View>
  );
  const statsNode = (
    <DeckStats total={deck.total} newCount={deck.newCount} dueCount={deck.dueCount} isDark={isDark} isRTL={isRTL} />
  );

  return (
    <DeckCardShell
      canStart={canStart}
      onStartReview={onStartReview}
      label={deck.title}
      compact={compact}
      isRTL={isRTL}
      iconNode={iconNode}
      textNode={textNode}
      actionNodes={actionNodes}
      statsNode={statsNode}
    />
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
        style={{
          fontFamily: "Manrope_600SemiBold",
          fontSize: 14,
          ...textStartStyle(isRTL),
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
        numberOfLines={compact ? undefined : 1}
      >
        {s.vocabDeckTitle}
      </Text>
      <Text
        className="text-warm-400 dark:text-neutral-500 mt-0.5"
        style={{
          fontFamily: "Manrope_400Regular",
          fontSize: 11,
          lineHeight: 16,
          ...textStartStyle(isRTL),
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
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
  const statsNode = (
    <DeckStats total={stats.total} newCount={stats.newCount} dueCount={stats.dueCount} isDark={isDark} isRTL={isRTL} />
  );

  return (
    <DeckCardShell
      canStart={canStart}
      onStartReview={onStartReview}
      label={s.vocabDeckTitle}
      compact={compact}
      isRTL={isRTL}
      iconNode={iconNode}
      textNode={textNode}
      actionNodes={actionNodes}
      statsNode={statsNode}
    />
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
  const s = useStrings();
  // Each count carries a caption: three bare colored numbers left people guessing what they meant.
  const stats = [
    { value: total, label: s.deckStatCards, color: undefined },
    ...(showReviewStats
      ? [
          { value: newCount, label: s.deckCardsFilterNew, color: isDark ? "#4ade80" : "#16a34a" },
          { value: dueCount, label: s.deckCardsFilterDue, color: isDark ? "#f87171" : "#dc2626" },
        ]
      : []),
  ];
  return (
    <View
      accessible
      accessibilityLabel={stats.map((stat) => `${stat.value} ${stat.label}`).join(", ")}
      className={`flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}
      style={{ direction: "ltr" }}
    >
      {stats.map((stat, index) => (
        <View key={stat.label} className={`items-center ${isRTL ? "flex-row-reverse" : "flex-row"}`} style={{ gap: 12 }}>
          {index === 1 ? <View style={{ width: 1, height: 28, backgroundColor: themeColors.surfaceDim }} /> : null}
          <View className="items-center min-w-[32px]">
            <Text
              className={stat.color ? "text-center" : "text-charcoal dark:text-neutral-100 text-center"}
              style={{
                fontFamily: "Manrope_700Bold",
                fontSize: 14,
                fontVariant: ["tabular-nums"],
                ...(stat.color ? { color: stat.color } : null),
              }}
            >
              {isRTL ? toArabicNumber(stat.value) : stat.value}
            </Text>
            <Text
              className="text-warm-500 dark:text-neutral-400 text-center"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 10, marginTop: 1 }}
            >
              {stat.label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
