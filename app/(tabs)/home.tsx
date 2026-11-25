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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  PenLine,
} from "lucide-react-native";
import { useAccountPromo } from "@/lib/auth/account-promo";
import { AccountPromoCard } from "@/components/auth/AccountPromoCard";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { mutedIconColor } from "@/lib/ui/theme-icons";
import { isBoardEnabled } from "@/lib/board/config";
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
import { readDailyDeckIds, settleAutomaticDecks } from "@/lib/study/daily-decks";
import { openReminderRoute } from "@/lib/notifications/reminder-route";
import { addStudyMore } from "@/lib/study/daily-queue";
import { DAILY_SESSION_HREF, loadStudyState, studyMoreCount, type StudyState } from "@/lib/study/resolve";
import { queueCardCounts, shortfallCards, todayParts } from "@/lib/study/today";
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
import { ZaytAnimation } from "@/components/habit/ZaytAnimation";
import { isZaytLiveEvent, markZaytLiveEvent, markZaytPresented } from "@/lib/zayt/presentation";
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
import { formatCards, formatNumber, formatSurahs } from "@/lib/i18n/count";
import { surahTransliteration } from "@/lib/search/surah-match";

type SmartDeckDisplay = {
  id: SmartDeckId;
  title: string;
  subtitle: string;
  icon: typeof Sparkles;
  filter: BuiltInDeckFilter;
} & DeckTodayCounts;

/** A deck's queue for the rest of today; `total` is the deck's size, kept for the empty-deck checks. */
type DeckTodayCounts = Awaited<ReturnType<typeof getDeckTodayStats>>;

type DeckReviewSettingsTarget = {
  id: string;
  title: string;
};

type DeckCardsTarget = {
  id: string;
  title: string;
};

const GRACE_NOTE_SEEN_KEY = "device_habit_grace_note_seen";
/** The last wird day of the return episode whose welcome wave already played on this device. */
const ZAYT_RETURN_SEEN_KEY = "device_zayt_return_seen";
/** A juz completed on this device; the duplicate first-juz badge and the aggregates get no Zayt. */
const JUZ_UNLOCK = /^juz_\d{2}_completed$/;
/** Decks a setting can leave out of daily study (SPEC 3.6, 3.7); the others are always in it or never. */
const SWITCHABLE_DECKS: readonly string[] = [MEANINGS_DECK_ID, SMART_DECK_IDS.qiraat, SMART_DECK_IDS.reasonsOfRevelation];

function juzZaytEventId(unlock: { achievementId: string; unlockedAt: string }): string {
  return `juz:${unlock.achievementId}:${unlock.unlockedAt}`;
}

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
  const { isDark, isRTL, uiLanguage, effectiveTheme } = useSettings();
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
  const [vocabStats, setVocabStats] = useState<DeckTodayCounts>({
    total: 0,
    dueCount: 0,
    newCount: 0,
    learningCount: 0,
    reviewCount: 0,
    heldBack: 0,
  });
  const accountPromo = useAccountPromo("home");
  const openMushaf = useOpenMushaf();
  const [decksLoaded, setDecksLoaded] = useState(false);
  // SPEC 3.1 to 3.3: what the resolver saw. The counter is the daily list cut at today's budget, the
  // same list the Today card's parts and the daily session use.
  const [study, setStudy] = useState<StudyState | null>(null);
  const [dailyDeckIds, setDailyDeckIds] = useState<readonly string[]>([]);
  const queue = study?.queue ?? null;
  /** Each read of the study state, from the dashboard or a plan timer; only the latest is applied. */
  const latestStudyLoad = useRef(0);
  // A plan timer (a half page or seam, a page's learning step or a second look coming due) changes
  // what the resolver answers, so the header and Study button read it again then. Only the resolver
  // is read: the rest of the dashboard does not depend on those timers.
  const refreshStudy = useCallback(() => {
    const load = ++latestStudyLoad.current;
    loadStudyState(db).then((next) => {
      if (load === latestStudyLoad.current) setStudy(next);
    });
  }, [db]);
  // Retention's ayah reviews due now, without new cards, under its own limit: an ayah plan's review
  // (UNIT-02, SPEC 3.5). The same deck queue as countAyahReviewsDue, which the wird-left line, the
  // reminders and the widget read. Zero for other plans.
  const ayahReviewsDue = queue?.planCards.filter((item) => !item.virtual && item.card.state !== 0).length ?? 0;
  const cardCounts = queue ? queueCardCounts(queue) : { total: 0, due: 0, fresh: 0 };
  // The counts and the Study button need about 330 px at standard text size; each further digit of the
  // counter widens the big number by about 38 px, and larger system text widens everything.
  const headerNeeds = (cardCounts.total >= 1000 ? 420 : cardCounts.total >= 100 ? 370 : 330) * Math.max(1, fontScale);
  const headerStacked = headerWidth > 0 && headerWidth < headerNeeds;
  /** All decks starts collapsed; the legacy /flashcards link opens it. */
  const [decksOpen, setDecksOpen] = useState(false);
  const [memorizedCards, setMemorizedCards] = useState(0);
  const { overview: habit, failed: habitFailed } = useHabitOverview(db);
  const { wird, inboxCount, remediationDue, monthlyCheckDue, secondLooksDue, nextLookAt, refresh: refreshWird } = useTodayWird(db, {
    // On a new day Home's own day-boundary reload reads the study state with the rest of the
    // dashboard, so the timer read is skipped then rather than run twice.
    onBoundary: () => {
      if (loadedDay.current === localDateOf(new Date())) refreshStudy();
    },
  });
  const [habitBreakOpen, setHabitBreakOpen] = useState(false);
  const [graceNoteSeen, setGraceNoteSeen] = useState<string | null>(null);
  /** Whether the played return episode was read, so the wave never starts before it is known. */
  const [zaytReturnLoaded, setZaytReturnLoaded] = useState(false);
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
    if (section !== "decks") return;
    setDecksOpen(true);
    if (decksY === null) return;
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
      // A user who becomes a full hafiz turns automatic Qira'at and Reasons of revelation on (SPEC 3.7).
      // It never blocks the dashboard; the next load tries again.
      await settleAutomaticDecks(db).catch((error: unknown) => console.warn("[Home] Could not settle the study decks:", error));

      const studyLoad = ++latestStudyLoad.current;
      const [memorizedTotal, reflectionJourneySummary, graceSeen, zaytReturnSeen, studyState, deckIds] = await Promise.all([
        getMemorizedAyahCardCount(db),
        getReflectionJourneySummary(db),
        db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [GRACE_NOTE_SEEN_KEY]),
        db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [ZAYT_RETURN_SEEN_KEY]),
        // Never throws: a failed read resolves to Home with no step.
        loadStudyState(db),
        readDailyDeckIds(db),
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
      setMemorizedCards(memorizedTotal);
      setGraceNoteSeen(graceSeen?.value ?? null);
      if (zaytReturnSeen?.value) markZaytPresented(`return:${zaytReturnSeen.value}`);
      setZaytReturnLoaded(true);
      // A plan-timer read that started after this one is newer.
      if (studyLoad === latestStudyLoad.current) setStudy(studyState);
      setDailyDeckIds(deckIds);
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
    [db, loadUnlocks, uiLanguage],
  );

  /**
   * Every deck's counts for today, for All decks. Read only while All decks is open: it is closed by
   * default, and the Study button and the counter need only the daily queue.
   */
  const loadDecks = useCallback(
    async (isCurrent: () => boolean) => {
      await migrateLegacyRetentionDecks(db);
      const smartDefinitions = [
        { id: SMART_DECK_IDS.retention, title: s.smartDeckRetentionTitle, subtitle: s.smartDeckRetentionSubtitle, icon: Layers },
        { id: SMART_DECK_IDS.mutashabihat, title: s.smartDeckMutashabihatTitle, subtitle: s.smartDeckMutashabihatSubtitle, icon: Sparkles },
        { id: SMART_DECK_IDS.similarTails, title: s.smartDeckSimilarTailsTitle, subtitle: s.smartDeckSimilarTailsSubtitle, icon: ListEnd },
        { id: SMART_DECK_IDS.qiraat, title: s.smartDeckQiraatTitle, subtitle: s.smartDeckQiraatSubtitle, icon: BookOpenText },
        { id: SMART_DECK_IDS.reasonsOfRevelation, title: s.smartDeckReasonsTitle, subtitle: s.smartDeckReasonsSubtitle, icon: BookMarked },
      ] as const;
      const [smartDisplays, vocabTodayStats] = await Promise.all([
        Promise.all(
          smartDefinitions.map(async (definition) => {
            const [settings, filter] = await Promise.all([readDeckReviewSettings(db, definition.id), readSmartDeckFilter(db, definition.id)]);
            const stats = await getDeckTodayStats(db, definition.id, settings);
            return { ...definition, filter, ...stats };
          }),
        ),
        readDeckReviewSettings(db, MEANINGS_DECK_ID).then((settings) => getDeckTodayStats(db, MEANINGS_DECK_ID, settings)),
      ]);
      // Applied only once every deck read, and only for the latest load, as the dashboard is.
      if (!isCurrent()) return;
      setSmartDecks(smartDisplays);
      setVocabStats(vocabTodayStats);
      setDecksLoaded(true);
    },
    [
      db,
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
    ],
  );

  const latestDeckLoad = useRef(0);
  const refreshDecks = useCallback(async () => {
    const load = ++latestDeckLoad.current;
    await loadDecks(() => load === latestDeckLoad.current);
  }, [loadDecks]);
  const decksOpenRef = useRef(decksOpen);
  decksOpenRef.current = decksOpen;

  const latestLoad = useRef(0);
  const loadData = useCallback(async () => {
    const load = ++latestLoad.current;
    const isCurrent = () => load === latestLoad.current;
    try {
      await loadDashboard(isCurrent);
      if (decksOpenRef.current) await refreshDecks();
      if (isCurrent()) setLoadFailed(false);
    } catch (e) {
      console.warn(e);
      if (isCurrent()) setLoadFailed(true);
    }
  }, [loadDashboard, refreshDecks]);

  // Opening All decks reads the decks; the dashboard's own reloads keep them current while open.
  useEffect(() => {
    if (!decksOpen) return;
    refreshDecks().catch((error: unknown) => {
      console.warn(error);
      setLoadFailed(true);
    });
  }, [decksOpen, refreshDecks]);

  const focused = useRef(false);
  /** The Study button or Study more already opened a step during this visit to Home. */
  const studyPending = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      studyPending.current = false;
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

  // Home behind a session skips each grade's reload: on web every read shares one database worker, so
  // reloads queued behind a session delay its own end screen. Returning to Home reloads anyway.
  useEffect(
    () =>
      subscribeReviewActivity(() => {
        if (focused.current) loadData();
      }),
    [loadData],
  );
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
      subscribeAchievementUnlocks((unlock) => {
        // Only an unlock published live on this device is new; restored or synced ones are not.
        if (JUZ_UNLOCK.test(unlock.achievementId)) markZaytLiveEvent(juzZaytEventId(unlock));
        setUnlockQueue((current) =>
          current.some((entry) => entry.achievementId === unlock.achievementId) ? current : [...current, unlock],
        );
      }),
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

  /** One deck from All decks: a single-deck session, which never spends the daily budget. */
  const handleStartReview = (deckId: string) => {
    router.push({ pathname: "/flashcards/session", params: { deckId } });
  };

  // The Study button opens the step Home last resolved (SPEC 3.1). Home resolves again on focus, after
  // review activity, after a sync that pulled records and at the day boundary, so the step is current
  // and the press opens at once instead of waiting for another read, which takes seconds on web. One
  // open per visit: a second tap before Home loses focus is ignored.
  const startStudy = useCallback(() => {
    const step = study?.step;
    if (studyPending.current || !step || step.kind === "home") return;
    studyPending.current = true;
    router.push(step.href);
  }, [router, study]);

  /** Study more: one more budget for today, then the cards it opened. A failed write can be pressed again. */
  const studyMore = useCallback(() => {
    if (studyPending.current) return;
    studyPending.current = true;
    addStudyMore(db)
      .then(() => router.push(DAILY_SESSION_HREF))
      .catch((error: unknown) => {
        console.warn("[Home] Study more failed:", error);
        studyPending.current = false;
      });
  }, [db, router]);

  const openDecks = useCallback(() => {
    setDecksOpen(true);
    if (decksY !== null) scrollRef.current?.scrollTo({ y: Math.max(0, decksY - 16), animated: true });
  }, [decksY]);

  const openStudySettings = useCallback(() => {
    router.push({ pathname: "/(tabs)/settings", params: { category: "general", section: "daily-study" } } as Href);
  }, [router]);

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

  // GOAL-04, SPEC 3.5: once the minimum is met, today's plan work is done and the daily list cut at
  // the base budget is empty, the full wird is complete. Study more and cards in other decks never
  // hold it back. Unknown while the wird or the daily queue loads.
  // All from the resolver's one read (planLeft and the queue), so a value Home's other hooks have not
  // refreshed yet, such as a second look that came due while Home was behind a session, cannot mark
  // the day early. A failed read leaves it unknown.
  const remainingToday = study && queue ? study.planLeft + queue.leftAtBase : 1;
  // MST-01: with page or half-page review, Home counts memorized pages instead of ayah cards.
  const pageMode = !!wird && wird.plan.unit !== "ayah";
  // 6.4: after 7 or more days without a wird, welcome the user back before today's review.
  const lastWirdDay = habit ? habit.days.filter((day) => day.localDate <= habit.today).at(-1)?.localDate ?? null : null;
  const returning =
    !!habit && !!wird && wird.todo.length > 0 && !habit.streak.doneToday && lastWirdDay !== null && diffDays(lastWirdDay, habit.today) >= 7;
  // ZAY-02: no Zayt until the setting is known to be on. The return episode is the gap since the
  // last wird day, so the wave plays once per episode, on this device, across launches.
  const showZayt = habit?.settings.showZayt === true;
  const returnZaytEventId = returning && zaytReturnLoaded && lastWirdDay ? `return:${lastWirdDay}` : null;
  const rememberZaytReturn = useCallback(() => {
    if (lastWirdDay) putUserSetting(db, ZAYT_RETURN_SEEN_KEY, lastWirdDay).catch(console.warn);
  }, [db, lastWirdDay]);
  // One Zayt per screen: the welcome-back card wins over a juz notice.
  const juzZaytId =
    latestUnlock && showZayt && !returning && JUZ_UNLOCK.test(latestUnlock.achievementId) ? juzZaytEventId(latestUnlock) : null;
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

  const step = study?.step ?? null;
  // Start until anything was graded today, Continue after.
  const startedToday =
    (habit?.minimumProgressToday ?? 0) > 0 || (wird?.done.length ?? 0) > 0 || (queue?.studiedToday ?? 0) > 0 || !!wird?.memorizeDoneToday;
  const nothingLeft = step?.kind === "home" && step.reason === "done";
  const heldBack = studyMoreCount(queue);
  const deckTitles: Record<string, string> = {
    [SMART_DECK_IDS.retention]: s.smartDeckRetentionTitle,
    [SMART_DECK_IDS.mutashabihat]: s.smartDeckMutashabihatTitle,
    [SMART_DECK_IDS.similarTails]: s.smartDeckSimilarTailsTitle,
    [SMART_DECK_IDS.qiraat]: s.smartDeckQiraatTitle,
    [SMART_DECK_IDS.reasonsOfRevelation]: s.smartDeckReasonsTitle,
    [MEANINGS_DECK_ID]: s.vocabDeckTitle,
  };
  const deckTitle = (deckId: string) => deckTitles[deckId] ?? deckId;
  const parts = wird && queue && study ? todayParts(wird, { remediationDue, memorizeOpen: study.memorizeOpen }, queue) : null;

  const showDeckLabels = width >= VIEWPORT_BREAKPOINTS.sidebar;
  // SPEC 3.3: the daily decks first, then Retention, then the decks a setting left out.
  const deckOrder = [...dailyDeckIds, SMART_DECK_IDS.retention, ...SWITCHABLE_DECKS.filter((id) => !dailyDeckIds.includes(id))];
  const deckIsOff = (deckId: string) => SWITCHABLE_DECKS.includes(deckId) && !dailyDeckIds.includes(deckId);
  const orderedDecks = deckOrder.flatMap((deckId) =>
    deckId === MEANINGS_DECK_ID ? [{ id: deckId, total: vocabStats.total }] : smartDecks.filter((deck) => deck.id === deckId),
  );
  const decksWithCards = orderedDecks.filter((deck) => deck.total > 0);
  const emptyDecks = orderedDecks.filter((deck) => deck.total === 0 && deck.id !== MEANINGS_DECK_ID);
  const journeyComplete = journeySummary.totalLevels > 0 && journeySummary.completedLevels >= journeySummary.totalLevels;
  const renderSmartDeck = (deck: SmartDeckDisplay) => (
    <SmartDeckCard
      key={deck.id}
      deck={deck}
      off={deckIsOff(deck.id)}
      onOpenSetting={openStudySettings}
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
            zayt={
              juzZaytId ? (
                <ZaytAnimation tier="M" animation="A15" height={112} presentationId={isZaytLiveEvent(juzZaytId) ? juzZaytId : null} />
              ) : null
            }
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
              {/* SPEC 3.2: today's daily cards, cut at the budget. Hidden without a plan. */}
              {wird === null ? null : (
                <View className={isRTL ? "items-end" : "items-start"}>
                  {dueLoaded ? (
                    <Text
                      className="text-charcoal dark:text-neutral-100"
                      // Already display size; larger system text grows it only a little more.
                      maxFontSizeMultiplier={1.3}
                      style={{ fontFamily: "NotoSerif_700Bold", fontSize: 68, lineHeight: 68 }}
                    >
                      {localNumber(cardCounts.total)}
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
                    // Cards only: the plan's pages are counted on the Today card, never added in here.
                    <Text
                      className="text-warm-600 dark:text-neutral-400"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, ...textStartStyle(isRTL) }}
                    >
                      {interpolate(s.homeDueNew, { due: localNumber(cardCounts.due), new: localNumber(cardCounts.fresh) })}
                    </Text>
                  ) : null}
                </View>
              )}
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
            {!dueLoaded || wird === undefined ? null : wird === null ? (
              <HeaderAction label={s.studySetUpPlan} onPress={() => router.push("/hifz/setup" as Href)} stacked={headerStacked} isRTL={isRTL} />
            ) : step && (step.kind === "review" || step.kind === "memorize" || step.kind === "cards") ? (
              // SPEC 3.1: one Study button. The welcome-back card below takes its place that day.
              <HeaderAction
                label={startedToday ? s.studyContinue : s.studyStart}
                icon={<Play size={15} color="#fff" />}
                onPress={startStudy}
                stacked={headerStacked}
                isRTL={isRTL}
              />
            ) : nothingLeft && habit?.streak.doneToday ? (
              <View
                className={`min-h-[44px] items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
                style={mirroredRowStyle}
                accessibilityRole="text"
              >
                <CheckCircle2 size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />
                <Text className="text-primary-muted dark:text-primary-bright" style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}>
                  {s.studyAllDone}
                </Text>
              </View>
            ) : nothingLeft && habit && queue ? (
              // Nothing left and the minimum not met: name the shortfall and offer a way to meet it.
              <View className={`gap-2 ${headerStacked ? "" : isRTL ? "items-start" : "items-end"}`} style={{ flexShrink: 1 }}>
                <Text
                  className="text-warm-600 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                >
                  {interpolate(s.studyShortfall, { cards: formatCards(shortfallCards(queue, habit.minimumProgressToday), uiLanguage) })}
                </Text>
                <HeaderAction
                  label={heldBack > 0 ? s.studyMore : s.studyAllDecks}
                  onPress={heldBack > 0 ? studyMore : openDecks}
                  stacked={headerStacked}
                  isRTL={isRTL}
                />
                {heldBack > 0 ? (
                  // What one press adds, as on the session end screens (SPEC 3.2).
                  <Text
                    className="text-warm-500 dark:text-neutral-400"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 11, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                  >
                    {interpolate(s.studyMoreAdds, { cards: formatCards(heldBack, uiLanguage) })}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          {/* NOT-03: the in-app reminder, on web and while native notifications are off. Its Start opens
              the same plan-aware route as a notification tap (lib/notifications/reminder-route). */}
          <WirdReminderBanner
            wirdStartable={!step || step.kind !== "home"}
            // A wird reminder opens the same step as the Study button, at once and under its guard, so
            // the two can never stack two sessions. Other reminders open their own route.
            onStart={(route) => {
              if (route === "wird" && step && step.kind !== "home") startStudy();
              else openReminderRoute(db, route).catch(console.warn);
            }}
          />
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
            showZayt={showZayt}
            zaytEventId={returnZaytEventId}
            onZaytPresented={rememberZaytReturn}
            onChoose={(level) =>
              router.push({ pathname: "/hifz/review", params: { mode: "welcome_back", level: String(level) } } as Href)
            }
          />
        ) : null}

        {wird !== undefined ? (
          <WirdPlanCard
            wird={wird}
            parts={parts}
            deckTitle={deckTitle}
            secondLooksDue={secondLooksDue}
            nextLookAt={nextLookAt}
            language={uiLanguage}
            isDark={isDark}
            s={s}
            onStartMemorize={() => router.push("/hifz/memorize" as Href)}
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
            memorizeToday={wird.memorizeDoneToday}
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

        {/* SPEC 3.3: every deck, collapsed by default. Study above covers the daily ones. */}
        <View onLayout={(event) => setDecksY(event.nativeEvent.layout.y)} className="mb-3">
          <Pressable
            onPress={() => setDecksOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: decksOpen }}
            className="min-h-[44px] items-center gap-2"
            style={({ pressed }) => ({ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row", opacity: pressed ? 0.7 : 1 })}
          >
            <Text
              className="text-charcoal dark:text-neutral-100"
              accessibilityRole="header"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
            >
              {s.studyAllDecks}
            </Text>
            {decksOpen ? (
              <ChevronDown size={18} color={mutedIconColor(effectiveTheme)} />
            ) : isRTL ? (
              <ChevronLeft size={18} color={mutedIconColor(effectiveTheme)} />
            ) : (
              <ChevronRight size={18} color={mutedIconColor(effectiveTheme)} />
            )}
          </Pressable>
        </View>

        {!decksOpen ? null : decksLoaded ? (
          <>
            <View className="gap-2 mb-3">
              {decksWithCards.map((deck) =>
                deck.id === MEANINGS_DECK_ID ? (
                  <VocabularyDeckCard
                    key={deck.id}
                    stats={vocabStats}
                    off={deckIsOff(MEANINGS_DECK_ID)}
                    onOpenSetting={openStudySettings}
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
                ) : (
                  renderSmartDeck(deck as SmartDeckDisplay)
                ),
              )}
              {/* Mistakes marked in review wait here; remediation due today is plan work under Study. */}
              {inboxCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: "/hifz/review", params: { mode: "mistakes" } } as Href)}
                  style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                >
                  <Card elevation="low" className="px-4 py-3 rounded-3xl">
                    <View className="items-center gap-3 min-h-[40px]" style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}>
                      <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
                        <PenLine size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
                      </View>
                      <Text
                        className="flex-1 text-charcoal dark:text-neutral-200"
                        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                      >
                        {interpolate(s.hifzInboxCount, { n: formatNumber(inboxCount, uiLanguage) })}
                      </Text>
                      <Text className="text-primary-muted dark:text-primary-bright" style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}>
                        {s.hifzInboxAction}
                      </Text>
                    </View>
                  </Card>
                </Pressable>
              ) : null}
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
                <View className="gap-2 mb-3">{emptyDecks.map((deck) => renderSmartDeck(deck as SmartDeckDisplay))}</View>
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

        {isBoardEnabled() ? <SecondaryDestinations destinations={["leaderboard"]} /> : null}

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
  trailingControl,
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
  /** A control shown in place of the stats, such as Off on a deck outside daily study. */
  trailingControl?: React.ReactNode;
}) {
  const row = { direction: "ltr" as const, flexDirection: isRTL ? ("row-reverse" as const) : ("row" as const) };
  const passive = <View style={{ pointerEvents: "none" }}>{iconNode}</View>;
  const passiveText = <View style={{ flex: 1, minWidth: 0, pointerEvents: "none" }}>{textNode}</View>;
  // Off takes the stats' place: a deck outside daily study has no work waiting, so its counts are not shown.
  const passiveStats = trailingControl ?? <View style={{ pointerEvents: "none" }}>{statsNode}</View>;
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

/** "Off" on a deck left out of daily study, opening the setting that turns it on (SPEC 3.3). */
function DeckOffButton({ isRTL, s, onPress }: { isRTL: boolean; s: UIStrings; onPress: () => void }) {
  return (
    <Pressable
      onPress={(event) => {
        event.stopPropagation?.();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${s.studyDeckOff}. ${s.studyDeckOffHint}`}
      className="h-10 px-3 rounded-full border border-warm-300 dark:border-neutral-700 items-center justify-center"
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
      hitSlop={2}
    >
      <Text className="text-warm-700 dark:text-neutral-300" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
        {s.studyDeckOff}
      </Text>
    </Pressable>
  );
}

/** The header's one action: Study, Set up your plan, Study more or All decks. */
function HeaderAction({
  label,
  icon,
  onPress,
  stacked,
  isRTL,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  stacked: boolean;
  isRTL: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`min-h-[44px] rounded-full bg-primary-accent px-4 py-3 flex-row items-center gap-2 ${stacked ? "justify-center" : ""} ${isRTL ? "flex-row-reverse" : ""}`}
      accessibilityRole="button"
      style={({ pressed }) => ({ ...(isRTL ? { direction: "ltr" as const } : {}), transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      {icon}
      <Text className="text-white" style={{ fontFamily: "Manrope_700Bold", fontSize: 12 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SmartDeckCard({
  deck,
  off,
  onOpenSetting,
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
  /** Left out of daily study by its setting: marked Off, with a way to the setting. */
  off: boolean;
  onOpenSetting: () => void;
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
    <DeckStats stats={deck} isDark={isDark} isRTL={isRTL} />
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
      trailingControl={off ? <DeckOffButton isRTL={isRTL} s={s} onPress={onOpenSetting} /> : undefined}
    />
  );
}

function VocabularyDeckCard({
  stats,
  off,
  onOpenSetting,
  onStartReview,
  onConfigure,
  onShowCards,
  isDark,
  isRTL,
  compact,
  showLabels,
  s,
}: {
  stats: DeckTodayCounts;
  /** Left out of daily study by its setting: marked Off, with a way to the setting. */
  off: boolean;
  onOpenSetting: () => void;
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
    <DeckStats stats={stats} isDark={isDark} isRTL={isRTL} />
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
      trailingControl={off ? <DeckOffButton isRTL={isRTL} s={s} onPress={onOpenSetting} /> : undefined}
    />
  );
}

function DeckStats({
  stats: counts,
  isDark,
  isRTL,
}: {
  stats: DeckTodayCounts;
  isDark: boolean;
  isRTL: boolean;
}) {
  const s = useStrings();
  // Today's work, not the deck's size: the new, learning and review cards the queue offers now, the
  // same counts Review all loads. Each count carries a caption, and takes its color only above zero,
  // so a zero never looks like work waiting.
  const stats = [
    { value: counts.newCount, label: s.deckCardsFilterNew, color: counts.newCount > 0 ? (isDark ? "#4ade80" : "#16a34a") : undefined },
    {
      value: counts.learningCount,
      label: s.deckCardsFilterLearning,
      color: counts.learningCount > 0 ? (isDark ? "#fbbf24" : "#d97706") : undefined,
    },
    { value: counts.reviewCount, label: s.deckCardsFilterReview, color: counts.reviewCount > 0 ? (isDark ? "#f87171" : "#dc2626") : undefined },
  ];
  const queued = counts.newCount + counts.dueCount;
  // A caption only when it adds something: due cards the daily limit keeps for a later day, or why
  // the deck has nothing to start.
  const availability =
    counts.heldBack > 0
      ? interpolate(s.deckHeldBackToday, { n: isRTL ? toArabicNumber(counts.heldBack) : String(counts.heldBack) })
      : counts.total === 0
        ? s.homeDeckNoCards
        : queued === 0
          ? s.homeDeckNothingDue
          : null;
  return (
    <View className={isRTL ? "items-end" : "items-start"} style={{ gap: 2 }}>
      <View
        accessible
        accessibilityLabel={[...stats.map((stat) => `${stat.value} ${stat.label}`), ...(availability ? [availability] : [])].join(", ")}
        className={`flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}
        style={{ direction: "ltr" }}
      >
        {stats.map((stat) => (
          <View key={stat.label} className="items-center min-w-[32px]">
            <Text
              className={stat.color ? "text-center" : "text-warm-500 dark:text-neutral-400 text-center"}
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
