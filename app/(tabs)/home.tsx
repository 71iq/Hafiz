import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  Pressable,
  Platform,
  StyleSheet,
  useWindowDimensions,
  type ScrollView,
} from "react-native";
import { formatAyahRef, toArabicNumber } from "@/lib/arabic";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  Play,
  Layers,
  Search,
  Languages,
  BookMarked,
  BookOpen,
  CheckCircle2,
  Settings2,
  Sparkles,
  BookOpenText,
  ListEnd,
  List,
} from "lucide-react-native";
import { useAccountPromo } from "@/lib/auth/account-promo";
import { AccountPromoCard } from "@/components/auth/AccountPromoCard";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { mutedIconColor } from "@/lib/ui/theme-icons";
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
import { getUnseenUnlocks, markAchievementSeen, subscribeAchievementUnlocks } from "@/lib/achievements/queries";
import type { AchievementUnlock } from "@/lib/achievements/types";
import { getReflectionJourneySummary } from "@/lib/reflection-journey/queries";
import { localizeReflectionJourneyText } from "@/lib/reflection-journey/schema";
import { DESKTOP_CONTENT_MAX_WIDTH, VIEWPORT_BREAKPOINTS } from "@/lib/ui/viewport";
import { AppReleaseCard } from "@/components/app-update/AppReleaseCard";
import { textStartStyle } from "@/lib/ui/direction";
import { SecondaryDestinations } from "@/components/ui/SecondaryDestinations";
import { consumeSearchRequest, usePendingSearchRequest } from "@/lib/navigation/search-launcher";
import { useOpenMushaf } from "@/lib/navigation/open-mushaf";
import { useDayBoundaryRefresh, nextLocalMidnight } from "@/lib/habit/use-day-boundary";
import { diffDays, localDateOf } from "@/lib/habit/dates";
import { formatSurahs } from "@/lib/i18n/count";
import { surahTransliteration } from "@/lib/search/surah-match";

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
};

type DeckCardsTarget = {
  id: string;
  title: string;
};

const GRACE_NOTE_SEEN_KEY = "device_habit_grace_note_seen";

/**
 * Home's achievement notices: the visible one stays first while newer unlocks queue behind it, so a
 * live unlock never replaces a notice the user has not seen yet.
 */
export function mergeUnlockQueue(current: readonly AchievementUnlock[], unseen: readonly AchievementUnlock[]): AchievementUnlock[] {
  const visible = current[0];
  const keepVisible = visible && unseen.some((unlock) => unlock.achievementId === visible.achievementId);
  return keepVisible ? [visible, ...unseen.filter((unlock) => unlock.achievementId !== visible.achievementId)] : [...unseen];
}

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
  const accountPromo = useAccountPromo("home");
  const openMushaf = useOpenMushaf();
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
  const [searchQuery, setSearchQuery] = useState("");
  // Search opened from the sidebar, Ctrl/Cmd+K or the legacy /search?q= link (search-launcher).
  const searchRequest = usePendingSearchRequest();
  useEffect(() => {
    if (!searchRequest) return;
    const request = consumeSearchRequest(searchRequest.id);
    if (!request) return;
    setSearchQuery(request.query);
    setShowSearch(true);
  }, [searchRequest]);
  // The legacy /flashcards link lands here with section=decks and scrolls to the deck cards once.
  const { section } = useLocalSearchParams<{ section?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const [decksY, setDecksY] = useState<number | null>(null);
  useEffect(() => {
    if (section !== "decks" || decksY === null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, decksY - 16), animated: false });
    router.setParams({ section: undefined });
  }, [section, decksY, router]);
  const [toast, setToast] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filterDeckId, setFilterDeckId] = useState<SmartDeckId | null>(null);
  const [reviewSettingsTarget, setReviewSettingsTarget] = useState<DeckReviewSettingsTarget | null>(null);
  const [deckCardsTarget, setDeckCardsTarget] = useState<DeckCardsTarget | null>(null);
  const [surahNames, setSurahNames] = useState<Record<number, string>>({});
  // undefined while loading; null when no reading position is saved yet.
  const [resume, setResume] = useState<{ surah: number; ayah: number; page: number } | null | undefined>(undefined);
  const [unlockQueue, setUnlockQueue] = useState<AchievementUnlock[]>([]);
  const latestUnlock = unlockQueue[0] ?? null;
  const [dismissingUnlockId, setDismissingUnlockId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // The local day the dashboard was loaded for, and when the next one starts.
  const loadedDay = useRef<string | null>(null);
  const [dayBoundary, setDayBoundary] = useState<number | null>(null);
  const [journeySummary, setJourneySummary] = useState<{
    totalLevels: number;
    completedLevels: number;
    currentLevelTitle: string | null;
  }>({
    totalLevels: 0,
    completedLevels: 0,
    currentLevelTitle: null,
  });

  const loadUnlocks = useCallback(async () => {
    try {
      const unseen = await getUnseenUnlocks(db);
      setUnlockQueue((current) => mergeUnlockQueue(current, unseen));
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
        // English uses the transliterated name people know ("Al-Kahf"), as Search does.
        nameMap[row.number] =
          uiLanguage === "ar" ? row.name_arabic : (surahTransliteration(row.number) ?? row.name_english);
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
      const loadedAt = new Date();
      loadedDay.current = localDateOf(loadedAt);
      setDayBoundary(nextLocalMidnight(loadedAt).getTime());
      setSurahNames(nameMap);
      setSmartDecks(smartDisplays);
      setMemorizedCards(memorizedTotal);
      setGraceNoteSeen(graceSeen?.value ?? null);
      setVocabStats(vocabTodayStats);
      setDueLoaded(true);
      loadUnlocks();
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
      loadUnlocks,
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

  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      loadData();
      return () => {
        focused.current = false;
      };
    }, [loadData]),
  );
  // Due counts roll over with the local day: reload at midnight, or on resume once the date changed.
  // The wird and habit cards follow their own day boundaries and make-up cutoff.
  const reloadForNewDay = useCallback(() => {
    if (focused.current && loadedDay.current !== localDateOf(new Date())) loadData();
  }, [loadData]);
  useDayBoundaryRefresh(dayBoundary, reloadForNewDay);

  const retryLoad = useCallback(async () => {
    setRetrying(true);
    try {
      await loadData();
    } finally {
      setRetrying(false);
    }
  }, [loadData]);

  useEffect(() => subscribeReviewActivity(loadData), [loadData]);
  useEffect(
    () =>
      subscribeSyncCompleted(({ pulled }) => {
        if (pulled > 0) loadData();
      }),
    [loadData],
  );

  // A live unlock waits behind the visible notice instead of replacing it.
  useEffect(
    () =>
      subscribeAchievementUnlocks((unlock) =>
        setUnlockQueue((current) =>
          current.some((entry) => entry.achievementId === unlock.achievementId) ? current : [...current, unlock],
        ),
      ),
    [],
  );

  const dismissLatestUnlock = useCallback(() => {
    if (!latestUnlock || dismissingUnlockId === latestUnlock.achievementId) return;
    const achievementId = latestUnlock.achievementId;
    setDismissingUnlockId(achievementId);
    markAchievementSeen(db, achievementId)
      .then(() => getUnseenUnlocks(db))
      .then((unseen) => {
        setUnlockQueue((current) =>
          mergeUnlockQueue(
            current.filter((entry) => entry.achievementId !== achievementId),
            unseen.filter((entry) => entry.achievementId !== achievementId),
          ),
        );
      })
      .catch(console.warn)
      .finally(() => {
        setDismissingUnlockId((current) => (current === achievementId ? null : current));
      });
  }, [db, dismissingUnlockId, latestUnlock]);

  const handleStartReview = (deckId?: string) => {
    router.push({ pathname: "/flashcards/session", params: deckId ? { deckId } : {} });
  };

  // A readable scope: "Al-Kahf 1-7", "3 surahs" or "Juz 1, 2", in the interface's digits.
  const getSmartFilterLabel = (filter: BuiltInDeckFilter): string => {
    if (filter.type === "surah") {
      const ranges = filter.ranges ?? [];
      if (ranges.length === 1 && filter.surahs.length === 1) {
        const range = ranges[0];
        return `${surahNames[range.surah] ?? localNumber(range.surah)} ${localNumber(range.ayahStart)}-${localNumber(range.ayahEnd)}`;
      }
      if (filter.surahs.length === 1 && ranges.length === 0) {
        const n = filter.surahs[0];
        return surahNames[n] ?? localNumber(n);
      }
      return formatSurahs(filter.surahs.length, uiLanguage);
    }
    if (filter.type === "juz") {
      return interpolate(s.homeScopeJuz, { list: filter.juzNumbers.map(localNumber).join(isRTL ? "، " : ", ") });
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

  const dueReviews = ayahReviewsDue + vocabStats.dueCount;
  const newCards = smartDecks.reduce((sum, deck) => sum + deck.newCount, 0) + vocabStats.newCount;
  // Genuinely done: every deck and today's plan work, not merely one empty deck.
  const allCaughtUp = dueLoaded && wird !== undefined && remainingToday === 0;
  const showDeckLabels = width >= VIEWPORT_BREAKPOINTS.sidebar;
  const decksWithCards = smartDecks.filter((deck) => deck.total > 0);
  const emptyDecks = smartDecks.filter((deck) => deck.total === 0);
  const journeyComplete = journeySummary.totalLevels > 0 && journeySummary.completedLevels >= journeySummary.totalLevels;
  const renderSmartDeck = (deck: SmartDeckDisplay) => (
    <SmartDeckCard
      key={deck.id}
      deck={deck}
      filterLabel={getSmartFilterLabel(deck.filter)}
      onStartReview={() =>
        // Only future cards: open the card list to inspect them instead of an empty session.
        deck.dueCount + deck.newCount > 0
          ? handleStartReview(deck.id)
          : setDeckCardsTarget({ id: deck.id, title: deck.title })
      }
      onConfigure={() => setFilterDeckId(deck.id)}
      onShowCards={() => setDeckCardsTarget({ id: deck.id, title: deck.title })}
      isDark={isDark}
      isRTL={isRTL}
      compact={compactDeckCards}
      showLabels={showDeckLabels}
      s={s}
    />
  );

  return (
    <Screen>
      <ScreenScrollView ref={scrollRef} maxWidth={DESKTOP_CONTENT_MAX_WIDTH} bottomInset={TAB_SCREEN_BOTTOM_INSET}>
        <View className="pt-6 pb-3">
          <View
            className={`flex-row items-center justify-between ${isRTL ? "flex-row-reverse" : ""}`}
            style={mirroredRowStyle}
          >
            <Text
              className="text-warm-400 dark:text-neutral-400 uppercase"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: 1.8 }}
            >
              {isRTL ? formatArabicDate(new Date()) : new Date().toLocaleDateString()}
            </Text>
            <Pressable
              onPress={() => setShowSearch(true)}
              accessibilityRole="button"
              accessibilityLabel={s.searchTitle}
              className="w-11 h-11 items-center justify-center rounded-full"
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
                onPress={retryLoad}
                disabled={retrying}
                accessibilityRole="button"
                accessibilityLabel={s.homeLoadRetry}
                accessibilityState={{ busy: retrying, disabled: retrying }}
                className="rounded-full bg-primary-accent px-4 min-h-[44px] flex-row items-center justify-center gap-2"
                style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
              >
                {retrying ? <ActivityIndicator size="small" color="#fff" /> : null}
                <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                  {s.homeLoadRetry}
                </Text>
              </Pressable>
            </View>
          </Card>
        )}

        {latestUnlock && (
          <AchievementUnlockToast
            unlock={latestUnlock}
            moreCount={unlockQueue.length - 1}
            onDismiss={dismissLatestUnlock}
            onOpen={() => router.navigate({ pathname: "/(tabs)/progress", params: { achievements: "1" } } as Href)}
          />
        )}

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
                {dueLoaded ? (
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    // Already display size; larger system text grows it only a little more.
                    maxFontSizeMultiplier={1.3}
                    style={{ fontFamily: "NotoSerif_700Bold", fontSize: 68, lineHeight: 68 }}
                  >
                    {localNumber(totalDue)}
                  </Text>
                ) : (
                  <Skeleton isDark={isDark} width={96} height={64} borderRadius={16} accessibilityElementsHidden />
                )}
                <Text
                  className="text-warm-400 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL)}}
                >
                  {s.flashcardsDueToday}
                </Text>
                {dueLoaded ? (
                  // Cards only: the plan's pages are counted on the plan card, never added in here.
                  <Text
                    className="text-warm-600 dark:text-neutral-400"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, ...textStartStyle(isRTL) }}
                  >
                    {interpolate(s.homeDueNew, { due: localNumber(dueReviews), new: localNumber(newCards) })}
                  </Text>
                ) : null}
              </View>
              <View className={`pb-1 ${isRTL ? "items-end" : "items-start"}`}>
                {dueLoaded ? (
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
                ) : (
                  <Skeleton isDark={isDark} width={48} height={26} borderRadius={10} accessibilityElementsHidden />
                )}
                <Text
                  className="text-warm-400 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 11, ...textStartStyle(isRTL)}}
                >
                  {pageMode ? s.hifzHomeMemorizedPages : s.homeMemorized}
                </Text>
              </View>
            </View>
            {dueLoaded && totalDue > 0 ? (
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
            ) : allCaughtUp ? (
              <View
                className={`min-h-[44px] items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
                style={mirroredRowStyle}
                accessibilityRole="text"
              >
                <CheckCircle2 size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />
                <Text className="text-primary-muted dark:text-primary-bright" style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}>
                  {s.homeAllCaughtUp}
                </Text>
              </View>
            ) : null}
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
            ayahDue={ayahReviewsDue}
            ayahNew={smartDecks.reduce((sum, deck) => sum + deck.newCount, 0)}
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

        {/* Continue reading opens the saved ayah as one explicit target; a new reader gets a start card. */}
        {resume !== undefined ? (
          <Pressable
            onPress={() => openMushaf(resume ? { surah: resume.surah, ayah: resume.ayah } : { surah: 1, ayah: 1 })}
            accessibilityRole="button"
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
            className="mb-6"
          >
            <Card elevation="low" className="p-4 rounded-3xl">
              <View className="items-center gap-3" style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}>
                <View className="w-11 h-11 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
                  <BookOpen size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
                </View>
                <View className={`flex-1 ${isRTL ? "items-end" : "items-start"}`}>
                  <Text
                    className="text-warm-400 dark:text-neutral-400 uppercase"
                    // Letter spacing would break the joins between Arabic letters.
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: isRTL ? 0 : 1.5 }}
                  >
                    {s.continueReading}
                  </Text>
                  {resume ? (
                    <>
                      <Text
                        className="text-charcoal dark:text-neutral-100"
                        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, ...textStartStyle(isRTL) }}
                      >
                        {`${surahNames[resume.surah] ? interpolate(s.surahNamed, { name: surahNames[resume.surah] }) : localNumber(resume.surah)}${isRTL ? "، " : " · "}${formatAyahRef(isRTL, resume.surah, resume.ayah)}`}
                      </Text>
                      <Text
                        className="text-warm-400 dark:text-neutral-400"
                        style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL) }}
                      >
                        {interpolate(s.pageN, { n: localNumber(resume.page) })}
                      </Text>
                    </>
                  ) : (
                    <Text
                      className="text-charcoal dark:text-neutral-100"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, ...textStartStyle(isRTL) }}
                    >
                      {s.homeStartReading}
                    </Text>
                  )}
                </View>
              </View>
            </Card>
          </Pressable>
        ) : null}

        {/* Hand-mirrored alignment pins LTR coordinates; under the RTL tab root it flipped twice. */}
        <View
          className={`mb-3 ${isRTL ? "items-end" : "items-start"}`}
          style={{ direction: "ltr" }}
          onLayout={(event) => setDecksY(event.nativeEvent.layout.y)}
        >
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

        {dueLoaded ? (
          <>
            <View className="gap-2 mb-3">
              {decksWithCards.map(renderSmartDeck)}
              {vocabStats.total > 0 && (
                <VocabularyDeckCard
                  stats={vocabStats}
                  onStartReview={() =>
                    vocabStats.dueCount + vocabStats.newCount > 0
                      ? handleStartReview(MEANINGS_DECK_ID)
                      : setDeckCardsTarget({ id: MEANINGS_DECK_ID, title: s.vocabDeckTitle })
                  }
                  onConfigure={() => setReviewSettingsTarget({ id: MEANINGS_DECK_ID, title: s.vocabDeckTitle })}
                  onShowCards={() => setDeckCardsTarget({ id: MEANINGS_DECK_ID, title: s.vocabDeckTitle })}
                  isDark={isDark}
                  isRTL={isRTL}
                  compact={compactDeckCards}
                  showLabels={showDeckLabels}
                  s={s}
                />
              )}
            </View>
            {emptyDecks.length > 0 ? (
              <>
                <View className={`mt-3 mb-2 ${isRTL ? "items-end" : "items-start"}`} style={{ direction: "ltr" }}>
                  <Text
                    className="text-warm-600 dark:text-neutral-400"
                    accessibilityRole="header"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                  >
                    {s.homeMoreDecks}
                  </Text>
                </View>
                <View className="gap-2 mb-3">{emptyDecks.map(renderSmartDeck)}</View>
              </>
            ) : null}
          </>
        ) : (
          <View className="gap-2 mb-3" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} isDark={isDark} height={72} borderRadius={24} />
            ))}
          </View>
        )}

        {journeySummary.totalLevels > 0 && (
          <Pressable
            onPress={() => router.push("/reflection-journey" as Href)}
            accessibilityRole="button"
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
            className="mt-3 mb-6"
          >
            <Card elevation="low" className="p-4 rounded-3xl">
              <View className="items-center gap-3" style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}>
                <View className="w-11 h-11 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
                  <BookMarked size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
                </View>
                <View className={`flex-1 ${isRTL ? "items-end" : "items-start"}`}>
                  <Text
                    className="text-warm-400 dark:text-neutral-400 uppercase"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, letterSpacing: isRTL ? 0 : 1.5 }}
                  >
                    {journeyComplete
                      ? s.homeJourneyComplete
                      : interpolate(s.reflectionJourneyProgress, {
                          completed: localNumber(journeySummary.completedLevels),
                          total: localNumber(journeySummary.totalLevels),
                        })}
                  </Text>
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, ...textStartStyle(isRTL)}}
                  >
                    {s.reflectionJourneyTitle}
                  </Text>
                  <Text
                    className="text-warm-500 dark:text-neutral-400"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 13,
                      lineHeight: 20,
                      ...textStartStyle(isRTL),
                    }}
                  >
                    {s.reflectionJourneySubtitle}
                  </Text>
                  {/* The level the Journey opens (shared selector); a finished Journey says so above. */}
                  {journeySummary.currentLevelTitle && !journeyComplete ? (
                    <Text
                      className="text-charcoal dark:text-neutral-200"
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        fontSize: 13,
                        lineHeight: 20,
                        ...textStartStyle(isRTL),
                      }}
                    >
                      {interpolate(s.reflectionJourneyCurrentLevel, { title: journeySummary.currentLevelTitle })}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Card>
          </Pressable>
        )}

        <SecondaryDestinations destinations={["leaderboard"]} />

        {/* The web download offer lives in Settings > About; the app keeps its in-app update notice. */}
        {Platform.OS !== "web" ? <AppReleaseCard /> : null}

        {/* Optional sync comes last so it never pushes study down; hidden when accounts are not configured. */}
        {accountPromo.visible ? (
          <AccountPromoCard
            surface="home"
            title={s.homeAuthCardTitle}
            message={s.homeAuthCardSubtitle}
            logInLabel={s.homeAuthCardSignIn}
            signUpLabel={s.homeAuthCardSignUp}
            onDismiss={accountPromo.dismiss}
          />
        ) : null}
      </ScreenScrollView>

      <SearchCommand
        visible={showSearch}
        initialQuery={searchQuery}
        onClose={() => {
          setShowSearch(false);
          setSearchQuery("");
        }}
      />

      <SmartDeckFilterSheet
        visible={!!filterDeckId}
        deckId={filterDeckId}
        onClose={() => setFilterDeckId(null)}
        onSaved={(notice) => {
          setToast(notice);
          loadData();
        }}
      />

      <DeckReviewSettingsSheet
        visible={!!reviewSettingsTarget}
        deckId={reviewSettingsTarget?.id ?? null}
        deckTitle={reviewSettingsTarget?.title ?? ""}
        onClose={() => setReviewSettingsTarget(null)}
        onSaved={(notice) => {
          setToast(notice);
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

/** A deck's card-list or settings control: 40 px, a 44 px target, and a visible label from 768 px. */
function DeckActionButton({
  icon,
  label,
  accessibilityLabel,
  showLabel,
  isRTL,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  accessibilityLabel: string;
  showLabel: boolean;
  isRTL: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={(event) => {
        event.stopPropagation?.();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className={`h-10 min-w-10 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center gap-1.5 ${showLabel ? "px-3" : ""}`}
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
      hitSlop={2}
    >
      {icon}
      {showLabel ? (
        <Text className="text-warm-700 dark:text-neutral-300" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
          {label}
        </Text>
      ) : null}
    </Pressable>
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
  showLabels,
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
  showLabels: boolean;
  s: UIStrings;
}) {
  const mutedIcon = mutedIconColor(useSettings().effectiveTheme);
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
        className="text-warm-400 dark:text-neutral-400 mt-0.5"
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
      <DeckActionButton
        icon={<List size={14} color={mutedIcon} />}
        label={s.homeDeckCardsLabel}
        accessibilityLabel={s.deckCardsTitle}
        showLabel={showLabels}
        isRTL={isRTL}
        onPress={onShowCards}
      />
      <DeckActionButton
        icon={<Settings2 size={14} color={mutedIcon} />}
        label={s.homeDeckFilterLabel}
        accessibilityLabel={s.smartDeckFilterTitle}
        showLabel={showLabels}
        isRTL={isRTL}
        onPress={onConfigure}
      />
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
  showLabels,
  s,
}: {
  stats: { total: number; dueCount: number; newCount: number };
  onStartReview: () => void;
  onConfigure: () => void;
  onShowCards: () => void;
  isDark: boolean;
  isRTL: boolean;
  compact: boolean;
  showLabels: boolean;
  s: UIStrings;
}) {
  const mutedIcon = mutedIconColor(useSettings().effectiveTheme);
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
        className="text-warm-400 dark:text-neutral-400 mt-0.5"
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
      <DeckActionButton
        icon={<List size={14} color={mutedIcon} />}
        label={s.homeDeckCardsLabel}
        accessibilityLabel={s.deckCardsTitle}
        showLabel={showLabels}
        isRTL={isRTL}
        onPress={onShowCards}
      />
      <DeckActionButton
        icon={<Settings2 size={14} color={mutedIcon} />}
        label={s.homeDeckSettingsLabel}
        accessibilityLabel={s.deckReviewSettingsTitle}
        showLabel={showLabels}
        isRTL={isRTL}
        onPress={onConfigure}
      />
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
  // New and Due take their color only above zero, so a zero never looks like work waiting.
  const stats = [
    { value: total, label: s.deckStatCards, color: undefined },
    ...(showReviewStats
      ? [
          { value: newCount, label: s.deckCardsFilterNew, color: newCount > 0 ? (isDark ? "#4ade80" : "#16a34a") : undefined },
          { value: dueCount, label: s.deckCardsFilterDue, color: dueCount > 0 ? (isDark ? "#f87171" : "#dc2626") : undefined },
        ]
      : []),
  ];
  const left = newCount + dueCount;
  // Today's remaining cards come from the same queue counts, so the daily limit is visible before
  // starting. Without any, the caption says why the deck has nothing to start.
  const availability = !showReviewStats
    ? null
    : total === 0
      ? s.homeDeckNoCards
      : left > 0
        ? interpolate(s.deckLeftToday, { n: isRTL ? toArabicNumber(left) : String(left) })
        : s.homeDeckNothingDue;
  return (
    <View className={isRTL ? "items-end" : "items-start"} style={{ gap: 2 }}>
      <View
        accessible
        accessibilityLabel={[...stats.map((stat) => `${stat.value} ${stat.label}`), ...(availability ? [availability] : [])].join(", ")}
        className={`flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}
        style={{ direction: "ltr" }}
      >
        {stats.map((stat, index) => (
          <View key={stat.label} className={`items-center ${isRTL ? "flex-row-reverse" : "flex-row"}`} style={{ gap: 12 }}>
            {index === 1 ? <View style={{ width: 1, height: 28, backgroundColor: themeColors.surfaceDim }} /> : null}
            <View className="items-center min-w-[32px]">
              <Text
                className={
                  stat.color
                    ? "text-center"
                    : index === 0
                      ? "text-charcoal dark:text-neutral-100 text-center"
                      : "text-warm-500 dark:text-neutral-400 text-center"
                }
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
      {availability ? (
        <Text
          importantForAccessibility="no"
          accessibilityElementsHidden
          className="text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 11, writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {availability}
        </Text>
      ) : null}
    </View>
  );
}
