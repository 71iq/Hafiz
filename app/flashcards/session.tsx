import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Animated as RNAnimated,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { X, ChevronRight, Trophy } from "lucide-react-native";
import { useDatabase, useDatabaseStatus } from "@/lib/database/provider";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { interpolate } from "@/lib/i18n/useStrings";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/LoadingScreen";
import { gradeCard, Rating, State } from "@/lib/fsrs/scheduler";
import type { Card as FSRSCard, Grade } from "@/lib/fsrs/scheduler";
import {
  updateCard,
  insertStudyLog,
  getStudyStreak,
  getWirdStatus,
  MUTASHABIHAT_DECK_ID,
  getRemainingReviewLimit,
  readDeckReviewSettings,
} from "@/lib/fsrs/queries";
import { computeUniqueFront } from "@/lib/fsrs/uniqueness";
import { computeReviewPoints, addTodayPoints } from "@/lib/fsrs/scoring";
import { hapticMedium, hapticSuccess } from "@/lib/haptics";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { syncDailyScore, updateProfileStats } from "@/lib/fsrs/leaderboard-sync";
import type { StudyCardRow, TestMode, WordTestMode } from "@/lib/fsrs/types";
import type { DeckReviewSettings } from "@/lib/fsrs/types";
import {
  DEFAULT_DECK_DAILY_REVIEW_LIMIT,
  DEFAULT_DECK_LEARNING_STEPS,
  DEFAULT_DECK_RELEARNING_STEPS,
  DEFAULT_ENABLED_MODES,
  DEFAULT_WORD_TEST_MODES,
  TEST_MODE_COLORS,
} from "@/lib/fsrs/types";
import { fetchWordMeaningAr, fetchWordText, fetchWordTranslation } from "@/lib/word/queries";
import { Qcf2AyahText } from "@/components/flashcards/Qcf2AyahText";
import {
  getDueCardsForReview,
  getSmartCardContent,
  isSmartDeckId,
  materializeSmartDeckCards,
  type SmartCardKind,
  type SmartDeckRef,
} from "@/lib/fsrs/smart-decks";
import { parseQiraatText, type QiraatBlock } from "@/lib/qiraat/parse";
import { recordAchievementEvent } from "@/lib/achievements/queries";

// ─── Types ───────────────────────────────────────────────────

type SessionPhase = "loading" | "front" | "side" | "grading" | "summary";

type CardData = {
  kind: "ayah" | "word" | SmartCardKind;
  card: StudyCardRow;
  surah: number;
  ayah: number;
  wordPos?: number;
  isWordCard?: boolean;
  wordText?: string;
  wordMeaningAr?: string;
  wordMeaningEn?: string;
  surahName: string;
  textUthmani: string;
  textQcf2?: string;
  v2Page?: number;
  uniqueFront: { text: string; surahName: string; contextCount: number; needsExplicitLabel: boolean };
  translation: string;
  tafseer: string;
  prevAyahText: string | null;
  prevAyahQcf2?: string | null;
  prevV2Page?: number | null;
  nextAyahText: string | null;
  nextAyahQcf2?: string | null;
  nextV2Page?: number | null;
  smartDeckTitle?: string;
  smartTargetRef?: SmartDeckRef;
  smartCue?: string;
  smartRefs?: SmartDeckRef[];
  smartPromptQcf2?: string;
  smartPromptUthmani?: string;
  smartHiddenAnswerQcf2?: string;
  smartHiddenAnswerUthmani?: string;
  smartNeedsExplicitRefLabel?: boolean;
  qiraatText?: string;
  qiraatGroup?: string[];
};

type SessionSummary = {
  total: number;
  newCount: number;
  reviewCount: number;
  relearningCount: number;
  durationMs: number;
  nextReviewDate: string | null;
  wirdDays: number;
  wirdMaintainedToday: boolean;
};

type SmartTestMode = "smartRefs" | "qiraatReading";
type ReviewMode = TestMode | WordTestMode | SmartTestMode;
const WORD_TEST_MODE_COLORS: Record<WordTestMode, string> = {
  wordMeaningArabic: "#0d9488",
  wordMeaningTranslation: "#3b82f6",
};
const SMART_TEST_MODE_COLORS: Record<SmartTestMode, string> = {
  smartRefs: "#0d9488",
  qiraatReading: "#8b5cf6",
};

// ─── Main Component ──────────────────────────────────────────

export default function FlashcardSessionScreenWrapper() {
  const { isReady, progress, error } = useDatabaseStatus();
  const s = useStrings();

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-6">
        <Text
          className="text-red-600 mb-4"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 18 }}
        >
          {s.databaseError}
        </Text>
        <Text
          className="text-red-500 text-center"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
        >
          {error}
        </Text>
      </View>
    );
  }

  if (!isReady) {
    return <LoadingScreen progress={progress} />;
  }

  return (
    <SettingsProvider>
      <FlashcardSessionScreen />
    </SettingsProvider>
  );
}

function FlashcardSessionScreen() {
  const db = useDatabase();
  const { isDark, isRTL, fontSize, lineHeight, tafseerSource, isLoaded: settingsLoaded } = useSettings();
  const s = useStrings();
  const router = useRouter();
  const { deckId } = useLocalSearchParams<{ deckId?: string }>();
  const { width } = useWindowDimensions();
  const maxWidth = Math.min(width, 600);

  const [phase, setPhase] = useState<SessionPhase>("loading");
  const [cards, setCards] = useState<CardData[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentSideIndex, setCurrentSideIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [enabledModes, setEnabledModes] = useState<TestMode[]>(DEFAULT_ENABLED_MODES);
  const [wordEnabledModes, setWordEnabledModes] = useState<WordTestMode[]>(DEFAULT_WORD_TEST_MODES);
  const [reviewLimit, setReviewLimit] = useState(DEFAULT_DECK_DAILY_REVIEW_LIMIT);
  const [reviewSettings, setReviewSettings] = useState<DeckReviewSettings | null>(null);
  const [reviewSettingsLoaded, setReviewSettingsLoaded] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const sessionStartRef = useRef(Date.now());
  const streakRef = useRef(0);
  const sessionPointsRef = useRef(0);
  const gradingInFlightRef = useRef(false);
  const flipAnim = useRef(new RNAnimated.Value(0)).current;
  const normalizedDeckId = Array.isArray(deckId) ? deckId[0] : deckId;

  const resetSessionProgress = useCallback(() => {
    gradingInFlightRef.current = false;
    sessionPointsRef.current = 0;
    setCards([]);
    setCurrentIndex(0);
    setCurrentSideIndex(0);
    setRevealed(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReviewSettingsLoaded(false);
    readDeckReviewSettings(db, normalizedDeckId).then((settings) => {
      if (cancelled) return;
      setEnabledModes(settings.testModes);
      setWordEnabledModes(settings.wordTestModes);
      setReviewLimit(settings.dailyReviewLimit);
      setReviewSettings(settings);
      setReviewSettingsLoaded(true);
    }).catch((err) => {
      console.warn(err);
      if (cancelled) return;
      setEnabledModes(DEFAULT_ENABLED_MODES);
      setWordEnabledModes(DEFAULT_WORD_TEST_MODES);
      setReviewLimit(DEFAULT_DECK_DAILY_REVIEW_LIMIT);
      setReviewSettings(null);
      setReviewSettingsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [db, normalizedDeckId]);

  // Load due cards and pre-fetch all card data
  useEffect(() => {
    if (!settingsLoaded || !reviewSettingsLoaded) return;

    let cancelled = false;

    async function load() {
      resetSessionProgress();
      setSummary(null);
      setPhase("loading");
      try {
        // Pre-load streak for scoring
        streakRef.current = await getStudyStreak(db);
        const activeReviewSettings = reviewSettings;
        const remainingReviewLimit = await getRemainingReviewLimit(db, normalizedDeckId, activeReviewSettings?.dailyReviewLimit ?? reviewLimit);
        if (isSmartDeckId(normalizedDeckId) && remainingReviewLimit > 0) {
          await materializeSmartDeckCards(
            db,
            normalizedDeckId,
            remainingReviewLimit,
            activeReviewSettings?.newCardsLimit
          );
        }
        const dueRows = remainingReviewLimit > 0
          ? await getDueCardsForReview(db, normalizedDeckId, activeReviewSettings
              ? {
                  limit: remainingReviewLimit,
                  newCardsLimit: activeReviewSettings.newCardsLimit,
                  newReviewOrder: activeReviewSettings.newReviewOrder,
                  reviewSortOrder: activeReviewSettings.reviewSortOrder,
                  newCardSortOrder: activeReviewSettings.newCardSortOrder,
                }
              : remainingReviewLimit)
          : [];
        if (cancelled) return;
        if (dueRows.length === 0) {
          resetSessionProgress();
          setSummary({ total: 0, newCount: 0, reviewCount: 0, relearningCount: 0, durationMs: 0, nextReviewDate: null, wirdDays: 0, wirdMaintainedToday: false });
          setPhase("summary");
          return;
        }

        const loaded: CardData[] = [];
        for (const row of dueRows) {
          if (cancelled) return;
          const smartContent = await getSmartCardContent(db, row.id);
          if (smartContent?.targetRef) {
            const targetRef = smartContent.targetRef;
            loaded.push({
              kind: smartContent.kind,
              card: row,
              surah: targetRef.surah,
              ayah: targetRef.ayah,
              surahName: targetRef.surahNameAr,
              textUthmani: targetRef.textUthmani,
              textQcf2: targetRef.textQcf2,
              v2Page: targetRef.v2Page,
              uniqueFront: {
                text: smartContent.promptUthmani ?? smartContent.cue,
                surahName: targetRef.surahNameAr,
                contextCount: 0,
                needsExplicitLabel: true,
              },
              translation: "",
              tafseer: "",
              prevAyahText: null,
              nextAyahText: null,
              smartDeckTitle: getSmartDeckTitleForKind(smartContent.kind, s),
              smartTargetRef: targetRef,
              smartCue: smartContent.cue,
              smartRefs: smartContent.refs,
              smartPromptQcf2: smartContent.promptQcf2,
              smartPromptUthmani: smartContent.promptUthmani,
              smartHiddenAnswerQcf2: smartContent.hiddenAnswerQcf2,
              smartHiddenAnswerUthmani: smartContent.hiddenAnswerUthmani,
              smartNeedsExplicitRefLabel: smartContent.needsExplicitRefLabel,
              qiraatText: smartContent.qiraatText,
              qiraatGroup: smartContent.qiraatGroup,
            });
            continue;
          }

          const parts = row.id.split(":");
          const isWordCard = parts[0] === "word" && parts.length >= 4;
          const isMutashabihatCard = parts[0] === MUTASHABIHAT_DECK_ID && parts.length >= 3;
          const surah = parseInt(isWordCard || isMutashabihatCard ? parts[1] : parts[0], 10);
          const ayah = parseInt(isWordCard ? parts[2] : isMutashabihatCard ? parts[2] : parts[1], 10);
          const wordPos = isWordCard ? parseInt(parts[3]) : undefined;
          if (!Number.isFinite(surah) || !Number.isFinite(ayah)) continue;

          const [
            ayahRow,
            surahRow,
            translationRow,
            tafseerRow,
            prevRow,
            nextRow,
            uniqueFront,
            wordMeaningArRow,
            canonicalWordText,
            wordTranslation,
          ] = await Promise.all([
            db.getFirstAsync<{ text_uthmani: string; text_qcf2: string; v2_page: number }>(
              "SELECT text_uthmani, text_qcf2, v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
              [surah, ayah]
            ),
            db.getFirstAsync<{ name_arabic: string }>(
              "SELECT name_arabic FROM surahs WHERE number = ?",
              [surah]
            ),
            db.getFirstAsync<{ text_en: string }>(
              "SELECT text_en FROM translations WHERE surah = ? AND ayah = ?",
              [surah, ayah]
            ),
            db.getFirstAsync<{ text: string }>(
              "SELECT text FROM tafseer WHERE surah = ? AND ayah = ? AND source = ?",
              [surah, ayah, tafseerSource]
            ),
            ayah > 1
              ? db.getFirstAsync<{ text_uthmani: string; text_qcf2: string; v2_page: number }>(
                  "SELECT text_uthmani, text_qcf2, v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
                  [surah, ayah - 1]
                )
              : null,
            db.getFirstAsync<{ text_uthmani: string; text_qcf2: string; v2_page: number }>(
              "SELECT text_uthmani, text_qcf2, v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
              [surah, ayah + 1]
            ),
            computeUniqueFront(db, surah, ayah),
            isWordCard && wordPos ? fetchWordMeaningAr(db, surah, ayah, wordPos) : Promise.resolve(null),
            isWordCard && wordPos ? fetchWordText(db, surah, ayah, wordPos) : Promise.resolve(null),
            isWordCard && wordPos ? fetchWordTranslation(db, surah, ayah, wordPos) : Promise.resolve(null),
          ]);
          if (cancelled) return;

          const wordMeaningAr = isWordCard && wordPos
            ? (wordMeaningArRow?.meaning ?? null)
            : null;
          const wordText = isWordCard && wordPos
            ? (canonicalWordText ?? wordTranslation?.word_arabic ?? null)
            : null;
          const wordMeaningEn = isWordCard ? (wordTranslation?.translation_en ?? null) : null;
          const frontText = isWordCard ? (wordText ?? uniqueFront.text) : uniqueFront.text;

          loaded.push({
            kind: isWordCard ? "word" : "ayah",
            card: row,
            surah,
            ayah,
            wordPos,
            isWordCard,
            wordText: wordText ?? undefined,
            wordMeaningAr: wordMeaningAr ?? undefined,
            wordMeaningEn: wordMeaningEn ?? undefined,
            surahName: surahRow?.name_arabic ?? "",
            textUthmani: ayahRow?.text_uthmani ?? "",
            textQcf2: ayahRow?.text_qcf2,
            v2Page: ayahRow?.v2_page,
            uniqueFront: { ...uniqueFront, text: frontText },
            translation: translationRow?.text_en ?? "",
            tafseer: tafseerRow?.text ?? "",
            prevAyahText: prevRow?.text_uthmani ?? null,
            prevAyahQcf2: prevRow?.text_qcf2 ?? null,
            prevV2Page: prevRow?.v2_page ?? null,
            nextAyahText: nextRow?.text_uthmani ?? null,
            nextAyahQcf2: nextRow?.text_qcf2 ?? null,
            nextV2Page: nextRow?.v2_page ?? null,
          });
        }
        if (cancelled) return;
        if (loaded.length === 0) {
          resetSessionProgress();
          setSummary({ total: 0, newCount: 0, reviewCount: 0, relearningCount: 0, durationMs: 0, nextReviewDate: null, wirdDays: 0, wirdMaintainedToday: false });
          setPhase("summary");
          return;
        }

        sessionStartRef.current = Date.now();
        setCurrentIndex(0);
        setCurrentSideIndex(0);
        setRevealed(false);
        setCards(loaded);
        setPhase("front");
      } catch (e) {
        if (cancelled) return;
        console.warn("[FlashcardSession] Failed to load session:", e);
        resetSessionProgress();
        setSummary({ total: 0, newCount: 0, reviewCount: 0, relearningCount: 0, durationMs: 0, nextReviewDate: null, wirdDays: 0, wirdMaintainedToday: false });
        setPhase("summary");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [
    db,
    normalizedDeckId,
    tafseerSource,
    reviewLimit,
    reviewSettings,
    reviewSettingsLoaded,
    settingsLoaded,
    resetSessionProgress,
    s.smartDeckMutashabihatTitle,
    s.smartDeckSimilarTailsTitle,
    s.smartDeckQiraatTitle,
  ]);

  const currentCard = cards[currentIndex] ?? null;
  const gradePreviews = useMemo(
    () => currentCard ? getGradeSchedulePreviews(currentCard.card, reviewSettings, isRTL) : {},
    [currentCard, reviewSettings, isRTL]
  );
  const activeModes = useMemo<ReviewMode[]>(() => {
    if (!currentCard) return [] as ReviewMode[];
    if (currentCard.kind === "mutashabihat" || currentCard.kind === "similarTail") {
      return ["smartRefs"];
    }
    if (currentCard.kind === "qiraat") {
      return currentCard.qiraatText ? ["qiraatReading"] : [];
    }
    if (currentCard.isWordCard) {
      return wordEnabledModes.filter((mode) => {
        if (mode === "wordMeaningArabic" && !currentCard.wordMeaningAr) return false;
        if (mode === "wordMeaningTranslation" && !currentCard.wordMeaningEn) return false;
        return true;
      });
    }
    return enabledModes.filter((mode) => {
      if (mode === "previousAyah" && (!currentCard.prevAyahText || currentCard.uniqueFront.contextCount > 0)) return false;
      if (mode === "nextAyah" && !currentCard.nextAyahText) return false;
      if (mode === "translation" && !currentCard.translation) return false;
      if (mode === "tafseer" && !currentCard.tafseer) return false;
      return true;
    });
  }, [enabledModes, wordEnabledModes, currentCard]);

  const currentMode = activeModes[currentSideIndex] ?? null;
  const isLastSide = currentSideIndex >= activeModes.length - 1;

  const animateFlip = useCallback(() => {
    flipAnim.setValue(0);
    RNAnimated.spring(flipAnim, {
      toValue: 1,
      damping: 15,
      stiffness: 200,
      useNativeDriver: true,
    }).start();
  }, [flipAnim]);

  const revealFirstSide = () => {
    if (activeModes.length === 0) {
      setPhase("grading");
      return;
    }
    setCurrentSideIndex(0);
    setRevealed(true);
    setPhase("side");
    animateFlip();
  };

  const handleNext = () => {
    setCurrentSideIndex((i) => i + 1);
    setRevealed(true);
    animateFlip();
  };

  const handleGrade = async (rating: Grade) => {
    if (!currentCard || gradingInFlightRef.current) return;
    gradingInFlightRef.current = true;
    try {
      hapticMedium();
      const now = new Date();

      const result = gradeCard(toFSRSCard(currentCard.card), now, rating, reviewSettings ?? undefined);

      const updatedRow: StudyCardRow = {
        ...currentCard.card,
        due: result.card.due.toISOString(),
        stability: result.card.stability,
        difficulty: result.card.difficulty,
        elapsed_days: result.card.elapsed_days,
        scheduled_days: result.card.scheduled_days,
        learning_steps: result.card.learning_steps,
        reps: result.card.reps,
        lapses: result.card.lapses,
        state: result.card.state,
        last_review: now.toISOString(),
        updated_at: now.toISOString(),
      };
      await updateCard(db, updatedRow);

      await insertStudyLog(
        db,
        currentCard.card.id,
        rating,
        result.log.state,
        result.log.due.toISOString(),
        result.log.stability,
        result.log.difficulty,
        result.log.elapsed_days,
        result.log.scheduled_days,
        now.toISOString()
      );

      if (currentCard.card.id.startsWith("mutashabihat:") || currentCard.card.id.startsWith("similar-tail:")) {
        recordAchievementEvent(db, {
          type: "mutashabih_pair_reviewed",
          pairId: currentCard.card.id,
          reviewedAt: now.toISOString(),
        }).catch(console.warn);
      }

      // Compute and store leaderboard points
      const points = computeReviewPoints(
        rating,
        streakRef.current,
        currentCard.card.difficulty,
        currentCard.card.stability
      );
      if (points > 0) {
        sessionPointsRef.current += points;
        addTodayPoints(db, points).catch(console.warn);
      }

      if (currentIndex < cards.length - 1) {
        setCurrentIndex((i) => i + 1);
        setCurrentSideIndex(0);
        setRevealed(false);
        setPhase("front");
      } else {
        const newCount = cards.filter((c) => c.card.state === State.New).length;
        const relearningCount = cards.filter((c) => c.card.state === State.Relearning).length;
        const reviewCount = cards.length - newCount - relearningCount;

        const nextRow = await db.getFirstAsync<{ due: string }>(
          "SELECT due FROM study_cards ORDER BY due ASC LIMIT 1"
        );
        const wirdStatus = await getWirdStatus(db);

        setSummary({
          total: cards.length,
          newCount,
          reviewCount,
          relearningCount,
          durationMs: Date.now() - sessionStartRef.current,
          nextReviewDate: nextRow?.due ?? null,
          wirdDays: wirdStatus.currentDays,
          wirdMaintainedToday: wirdStatus.maintainedToday,
        });
        setPhase("summary");
        hapticSuccess();

        // Sync daily score and profile stats to Supabase (non-blocking)
        syncDailyScore(db).catch(console.warn);
        updateProfileStats(db).catch(console.warn);
      }
    } finally {
      gradingInFlightRef.current = false;
    }
  };

  const handleEndSession = () => {
    resetSessionProgress();
    setSummary(null);
    setPhase("loading");
    router.replace("/(tabs)/home");
  };

  // ─── Render ────────────────────────────────────────────────

  if (phase === "loading") {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="px-6 pt-6" style={{ gap: 16 }}>
          <Skeleton isDark={isDark} width="100%" height={8} borderRadius={4} />
          <View style={{ height: 24 }} />
          <Skeleton isDark={isDark} width="40%" height={12} borderRadius={6} style={{ alignSelf: "center" }} />
          <Skeleton isDark={isDark} width="100%" height={200} borderRadius={24} />
          <View style={{ height: 8 }} />
          <SkeletonText isDark={isDark} width="80%" lineHeight={14} style={{ alignSelf: "center" }} />
          <SkeletonText isDark={isDark} width="60%" lineHeight={14} style={{ alignSelf: "center" }} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "summary") {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <SessionSummaryView summary={summary!} onDone={handleEndSession} isDark={isDark} s={s} />
      </SafeAreaView>
    );
  }

  if (!currentCard) return null;

  const sessionTotal = cards.length;
  const currentProgress = Math.min(currentIndex + 1, sessionTotal);
  const progressPercent = sessionTotal > 0 ? (currentProgress / sessionTotal) * 100 : 0;
  const translateY = flipAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] });
  const opacity = flipAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      {/* Header */}
      <View className="px-6 pt-3 pb-2">
        <View className="flex-row items-center justify-between">
        <Pressable
          onPress={handleEndSession}
          className="w-11 h-11 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center"
        >
          <X size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
        </Pressable>

        <Text
          className="text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
        >
          {currentProgress} / {sessionTotal}
        </Text>

        <CardStateBadge state={currentCard.card.state} s={s} />
        </View>
        <View className="mt-2 h-[2px] rounded-full bg-surface-high dark:bg-surface-dark-high overflow-hidden">
          <View
            className="h-full rounded-full bg-primary-accent dark:bg-primary-bright"
            style={{ width: `${progressPercent}%` }}
          />
        </View>
      </View>

      {/* Mode tags row */}
      {phase === "side" && activeModes.length > 0 && (
        <View className="items-center px-6 pb-3">
          <View className="flex-row flex-wrap gap-2" style={{ width: "100%", maxWidth }}>
            {activeModes.map((mode, i) => {
              const color = getModeColor(mode);
              const isActive = i === currentSideIndex;
              const isDone = i < currentSideIndex;
              return (
                <View
                  key={mode}
                  className="px-3 py-1.5 rounded-full"
                  style={{
                    backgroundColor: isActive ? color : "transparent",
                    borderWidth: 1.5,
                    borderColor: color,
                    opacity: isDone ? 0.4 : 1,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: isActive ? "Manrope_600SemiBold" : "Manrope_500Medium",
                      fontSize: 11,
                      color: isActive ? "#fff" : color,
                    }}
                  >
                    {getModeName(mode, s)}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ alignItems: "center", paddingHorizontal: 24, paddingBottom: 140 }}
      >
        <View style={{ width: "100%", maxWidth }}>
          {/* Front of card */}
          {phase === "front" && (
            <Card elevation="low" className="p-6 mb-6 rounded-3xl bg-surface-low dark:bg-surface-dark-low">
              {isSmartReviewCard(currentCard) ? (
                <SmartCardFront card={currentCard} fontSize={fontSize} lineHeight={lineHeight} s={s} />
              ) : (
                <>
              {!currentCard.isWordCard && currentCard.uniqueFront.contextCount > 0 && (
                <Text
                  className="text-warm-400 dark:text-neutral-500 text-center mb-3"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 11 }}
                >
                  {interpolate(s.flashcardsContextCount, {
                    n: currentCard.uniqueFront.contextCount,
                    label: currentCard.uniqueFront.contextCount === 1 ? s.flashcardsContextAyah : s.flashcardsContextAyahs,
                  })}
                </Text>
              )}
              {!currentCard.isWordCard && currentCard.uniqueFront.contextCount === 0 && currentCard.textQcf2 && currentCard.v2Page ? (
                <Qcf2AyahText textQcf2={currentCard.textQcf2} v2Page={currentCard.v2Page} fontSize={fontSize} lineHeight={lineHeight} />
              ) : (
                <Text
                  className="text-charcoal dark:text-neutral-100 text-center"
                  style={{ fontSize, lineHeight, writingDirection: "rtl" }}
                >
                  {currentCard.uniqueFront.text}
                </Text>
              )}
                </>
              )}
            </Card>
          )}

          {/* Side (test mode) */}
          {phase === "side" && currentMode && (
            <View>
              <Card elevation="low" className="p-5 mb-4 rounded-3xl bg-surface-low dark:bg-surface-dark-low">
                <TestModePrompt mode={currentMode} card={currentCard} fontSize={fontSize * 0.85} lineHeight={lineHeight * 0.85} s={s} />
              </Card>

              {revealed && (
                <RNAnimated.View style={{ transform: [{ translateY }], opacity }}>
                  <Card elevation="mid" className="p-6 rounded-3xl bg-surface-bright dark:bg-surface-dark-mid">
                    <TestModeAnswer mode={currentMode} card={currentCard} fontSize={fontSize} lineHeight={lineHeight} s={s} />
                  </Card>
                </RNAnimated.View>
              )}
            </View>
          )}

          {/* Grading phase */}
          {phase === "grading" && (
            <Card elevation="low" className="p-6 mb-4 rounded-3xl bg-surface-low dark:bg-surface-dark-low">
              {currentCard.textQcf2 && currentCard.v2Page ? (
                <Qcf2AyahText
                  textQcf2={currentCard.textQcf2}
                  v2Page={currentCard.v2Page}
                  fontSize={fontSize * 0.8}
                  lineHeight={lineHeight * 0.8}
                />
              ) : (
                <Text
                  className="text-charcoal dark:text-neutral-100 text-center"
                  style={{ fontSize: fontSize * 0.8, lineHeight: lineHeight * 0.8, writingDirection: "rtl" }}
                >
                  {currentCard.textUthmani}
                </Text>
              )}
            </Card>
          )}
        </View>
      </ScrollView>

      {/* Bottom action area */}
      <View
        className="px-6 pb-6 pt-4 items-center"
        style={{ backgroundColor: isDark ? "rgba(10,10,10,0.95)" : "rgba(255,248,241,0.95)" }}
      >
        <View style={{ width: "100%", maxWidth }}>
          {phase === "front" && (
            <Button onPress={revealFirstSide} className="w-full">
              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
                {s.flashcardsReveal}
              </Text>
            </Button>
          )}

          {phase === "side" && revealed && !isLastSide && (
            <Button onPress={handleNext} className="w-full">
              <View className="flex-row items-center gap-2">
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
                  {s.flashcardsNext}
                </Text>
                <ChevronRight size={18} color="#fff" />
              </View>
            </Button>
          )}

          {/* Grading: show directly after last side is revealed, or in grading phase */}
          {((phase === "side" && revealed && isLastSide) || phase === "grading") && (
            <>
              <GradingButtons onGrade={handleGrade} previews={gradePreviews} isDark={isDark} s={s} />
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Test Mode Components ────────────────────────────────────

function TestModePrompt({
  mode, card, fontSize, lineHeight, s,
}: {
  mode: ReviewMode; card: CardData; fontSize: number; lineHeight: number; s: any;
}) {
  const label = getModeName(mode, s);
  const color = getModeColor(mode);
  const wordMode = isWordTestMode(mode);
  const targetWordQcf2 =
    wordMode && card.wordPos && card.textQcf2
      ? card.textQcf2.split(" ").filter(Boolean)[card.wordPos - 1]
      : null;

  return (
    <View>
      <View className="flex-row items-center gap-2 mb-3">
        <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: color }}>
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, color: "#fff" }}>
            {label}
          </Text>
        </View>
      </View>
      {wordMode && targetWordQcf2 && card.v2Page && (
        <View className="items-center mb-4">
          <Qcf2AyahText
            textQcf2={targetWordQcf2}
            v2Page={card.v2Page}
            fontSize={fontSize * 1.18}
            lineHeight={lineHeight * 1.18}
            colorClassName="text-primary-accent dark:text-primary-bright"
          />
        </View>
      )}
      {mode === "smartRefs" ? (
        <SmartCueText card={card} fontSize={fontSize} lineHeight={lineHeight} s={s} />
      ) : card.textQcf2 && card.v2Page ? (
        <Qcf2AyahText
          textQcf2={card.textQcf2}
          v2Page={card.v2Page}
          fontSize={fontSize}
          lineHeight={lineHeight}
          highlightWordPos={wordMode ? card.wordPos : undefined}
        />
      ) : (
        <Text
          className="text-charcoal dark:text-neutral-100 text-center"
          style={{ fontSize, lineHeight, writingDirection: "rtl" }}
        >
          {card.textUthmani}
        </Text>
      )}
    </View>
  );
}

function TestModeAnswer({
  mode, card, fontSize, lineHeight, s,
}: {
  mode: ReviewMode; card: CardData; fontSize: number; lineHeight: number; s: any;
}) {
  switch (mode) {
    case "nextAyah":
      return card.nextAyahQcf2 && card.nextV2Page ? (
        <Qcf2AyahText textQcf2={card.nextAyahQcf2} v2Page={card.nextV2Page} fontSize={fontSize} lineHeight={lineHeight} />
      ) : (
        <Text className="text-charcoal dark:text-neutral-100 text-center" style={{ fontSize, lineHeight, writingDirection: "rtl" }}>
          {card.nextAyahText ?? "—"}
        </Text>
      );
    case "previousAyah":
      return card.prevAyahQcf2 && card.prevV2Page ? (
        <Qcf2AyahText textQcf2={card.prevAyahQcf2} v2Page={card.prevV2Page} fontSize={fontSize} lineHeight={lineHeight} />
      ) : (
        <Text className="text-charcoal dark:text-neutral-100 text-center" style={{ fontSize, lineHeight, writingDirection: "rtl" }}>
          {card.prevAyahText ?? "—"}
        </Text>
      );
    case "translation":
      return (
        <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_400Regular", fontSize: 15, lineHeight: 24 }}>
          {card.translation}
        </Text>
      );
    case "tafseer":
      return (
        <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 22, writingDirection: "rtl" }}
          >
            {card.tafseer}
          </Text>
        </ScrollView>
      );
    case "surahName":
      return (
        <Text
          className="text-primary-accent dark:text-primary-bright text-center"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 22, writingDirection: "rtl" }}
        >
          {card.surahName}
        </Text>
      );
    case "wordMeaningArabic":
      return (
        <Text className="text-charcoal dark:text-neutral-100 text-center" style={{ fontSize, lineHeight, writingDirection: "rtl" }}>
          {card.wordMeaningAr ?? "—"}
        </Text>
      );
    case "wordMeaningTranslation":
      return (
        <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_400Regular", fontSize: 15, lineHeight: 24 }}>
          {card.wordMeaningEn ?? "—"}
        </Text>
      );
    case "smartRefs":
      return <SmartRefsAnswer card={card} fontSize={fontSize * 0.82} lineHeight={lineHeight * 0.82} s={s} />;
    case "qiraatReading":
      return <QiraatAnswer card={card} s={s} />;
    default:
      return null;
  }
}

function SmartCardFront({
  card,
  fontSize,
  lineHeight,
  s,
}: {
  card: CardData;
  fontSize: number;
  lineHeight: number;
  s: any;
}) {
  const prompt = getSmartPrompt(card, s);
  return (
    <View className="items-center">
      <Text
        className="text-primary-accent dark:text-primary-bright text-center mb-2"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}
      >
        {card.smartDeckTitle}
      </Text>
      <Text
        className="text-warm-500 dark:text-neutral-400 text-center mb-5"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 20 }}
      >
        {prompt}
      </Text>
      {card.kind === "qiraat" && card.textQcf2 && card.v2Page ? (
        <Qcf2AyahText textQcf2={card.textQcf2} v2Page={card.v2Page} fontSize={fontSize} lineHeight={lineHeight} />
      ) : (
        <SmartCueText card={card} fontSize={fontSize} lineHeight={lineHeight} s={s} />
      )}
    </View>
  );
}

function SmartCueText({
  card,
  fontSize,
  lineHeight,
  s,
}: {
  card: CardData;
  fontSize: number;
  lineHeight: number;
  s: any;
}) {
  const promptText = card.smartPromptUthmani ?? card.uniqueFront.text;
  return (
    <View className="items-center">
      {card.kind === "mutashabihat" && card.smartNeedsExplicitRefLabel && (
        <Text
          className="text-warm-500 dark:text-neutral-400 text-center mb-3"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 12, writingDirection: "rtl" }}
        >
          {card.surahName} {card.surah}:{card.ayah}
        </Text>
      )}
      {card.smartPromptQcf2 && card.v2Page ? (
        <Qcf2AyahText textQcf2={card.smartPromptQcf2} v2Page={card.v2Page} fontSize={fontSize} lineHeight={lineHeight} />
      ) : (
        <Text
          className="text-charcoal dark:text-neutral-100 text-center"
          style={{ fontSize, lineHeight, writingDirection: "rtl" }}
        >
          {promptText}
        </Text>
      )}
    </View>
  );
}

function SmartRefsAnswer({
  card,
  fontSize,
  lineHeight,
  s,
}: {
  card: CardData;
  fontSize: number;
  lineHeight: number;
  s: any;
}) {
  const refs = card.smartRefs ?? [];
  const target = card.smartTargetRef ?? refs[0] ?? null;
  const related = target
    ? refs.filter((ref) => ref.groupId !== target.groupId || ref.sortOrder !== target.sortOrder)
    : refs;
  const title = card.kind === "similarTail" ? s.smartDeckCorrectTail : s.smartDeckTargetAyah;
  return (
    <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
      <Text
        className="text-warm-400 dark:text-neutral-500 uppercase mb-3"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 11, letterSpacing: 1.1, textAlign: "right", writingDirection: "rtl" }}
      >
        {title}
      </Text>
      <View className="gap-3">
        {card.kind === "similarTail" && card.smartHiddenAnswerQcf2 && target && (
          <View className="rounded-2xl bg-primary-accent/10 dark:bg-primary-bright/10 p-4">
            <Qcf2AyahText
              textQcf2={card.smartHiddenAnswerQcf2}
              v2Page={target.v2Page}
              fontSize={fontSize * 1.08}
              lineHeight={lineHeight * 1.08}
              colorClassName="text-primary-accent dark:text-primary-bright"
            />
          </View>
        )}

        {target && (
          <SmartRefCard refData={target} fontSize={fontSize} lineHeight={lineHeight} />
        )}

        {card.kind === "mutashabihat" && card.smartCue && (
          <Text
            className="text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 20, textAlign: "right", writingDirection: "rtl" }}
          >
            {s.smartDeckComparisonCue}: {card.smartCue}
          </Text>
        )}

        {related.length > 0 && (
          <>
            <Text
              className="text-warm-400 dark:text-neutral-500 uppercase mt-2"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 11, letterSpacing: 1.1, textAlign: "right", writingDirection: "rtl" }}
            >
              {s.smartDeckRelatedAyahs}
            </Text>
            {related.map((ref, index) => (
              <SmartRefCard
                key={`${ref.groupId}:${ref.sortOrder}:${ref.surah}:${ref.ayah}:${index}`}
                refData={ref}
                fontSize={fontSize}
                lineHeight={lineHeight}
              />
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function SmartRefCard({
  refData,
  fontSize,
  lineHeight,
}: {
  refData: SmartDeckRef;
  fontSize: number;
  lineHeight: number;
}) {
  return (
    <View className="rounded-2xl bg-surface-low dark:bg-surface-dark-low p-4">
      <View className="flex-row-reverse items-center justify-between mb-3">
        <Text
          className="text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 13, writingDirection: "rtl" }}
        >
          {refData.surah}:{refData.ayah}
        </Text>
        <Text
          className="text-warm-500 dark:text-neutral-400 flex-1 mr-3"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: "right", writingDirection: "rtl" }}
          numberOfLines={1}
        >
          {refData.surahNameAr}
        </Text>
      </View>
      <Qcf2AyahText textQcf2={refData.textQcf2} v2Page={refData.v2Page} fontSize={fontSize} lineHeight={lineHeight} />
    </View>
  );
}

function QiraatAnswer({ card, s }: { card: CardData; s: any }) {
  const blocks = parseQiraatText(card.qiraatText ?? "");
  if (blocks.length === 0) {
    return (
      <Text className="text-warm-500 dark:text-neutral-400 text-center" style={{ writingDirection: "rtl" }}>
        {s.noQiraatData}
      </Text>
    );
  }

  const group = card.qiraatGroup ?? [];
  const coversLabel = group.length > 1
    ? `${s.qiraatCoversAyahs}: ${group.map(formatAyahKeyArabic).join("، ")}`
    : null;

  return (
    <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
      <Text
        className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider mb-3"
        style={{ writingDirection: "rtl", textAlign: "right" }}
      >
        {s.qiraatHeader}
      </Text>

      {coversLabel && (
        <View className="mb-3 px-3 py-2 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 self-start">
          <Text
            className="text-xs text-primary-accent dark:text-primary-bright"
            style={{ writingDirection: "rtl" }}
          >
            {coversLabel}
          </Text>
        </View>
      )}

      {blocks.map((block: QiraatBlock, i: number) => (
        <View key={i} className="mb-4">
          {block.heading && (
            <Text
              className="text-lg text-primary-accent dark:text-primary-bright mb-1.5"
              style={{ writingDirection: "rtl", textAlign: "right", fontWeight: "700" }}
            >
              {block.heading}
            </Text>
          )}
          <Text
            className="text-base text-charcoal dark:text-neutral-200 leading-8"
            style={{ writingDirection: "rtl", textAlign: "right" }}
          >
            {block.body}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Grading ─────────────────────────────────────────────────

const GRADE_BUTTONS: { rating: Grade; bgLight: string; bgDark: string }[] = [
  { rating: Rating.Again, bgLight: "#b91c1c", bgDark: "#dc2626" },
  { rating: Rating.Hard, bgLight: "#b45309", bgDark: "#d97706" },
  { rating: Rating.Good, bgLight: "#15803d", bgDark: "#16a34a" },
  { rating: Rating.Easy, bgLight: "#1d4ed8", bgDark: "#2563eb" },
];

function GradingButtons({
  onGrade,
  previews,
  isDark,
  s,
}: {
  onGrade: (rating: Grade) => void;
  previews: Record<number, string>;
  isDark: boolean;
  s: any;
}) {
  const labels: Record<number, string> = {
    [Rating.Again]: s.flashcardsAgain,
    [Rating.Hard]: s.flashcardsHard,
    [Rating.Good]: s.flashcardsGood,
    [Rating.Easy]: s.flashcardsEasy,
  };

  return (
    <View className="gap-3">
      <View className="flex-row gap-3">
        {GRADE_BUTTONS.map(({ rating, bgLight, bgDark }) => (
          <Pressable
            key={rating}
            onPress={() => onGrade(rating)}
            className="flex-1 rounded-2xl items-center"
            style={{
              backgroundColor: isDark ? bgDark : bgLight,
              minHeight: 58,
              paddingHorizontal: 6,
              paddingVertical: 10,
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={{ fontFamily: "Manrope_700Bold", fontSize: 14, color: "#fff" }}
            >
              {labels[rating]}
            </Text>
            {previews[rating] ? (
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                style={{ color: "rgba(255,255,255,0.82)", fontFamily: "Manrope_600SemiBold", fontSize: 10, marginTop: 3 }}
              >
                {previews[rating]}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── Card State Badge ────────────────────────────────────────

function CardStateBadge({ state, s }: { state: number; s: any }) {
  const config: Record<number, { label: string; bg: string }> = {
    [State.New]: { label: s.flashcardsSummaryNew, bg: "#3b82f6" },
    [State.Learning]: { label: s.flashcardsSummaryLearning, bg: "#f97316" },
    [State.Review]: { label: s.flashcardsSummaryReview, bg: "#22c55e" },
    [State.Relearning]: { label: s.flashcardsSummaryRelearning, bg: "#ef4444" },
  };
  const c = config[state] ?? config[State.New];

  return (
    <View className="px-3 py-1 rounded-full" style={{ backgroundColor: c.bg }}>
      <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, color: "#fff" }}>{c.label}</Text>
    </View>
  );
}

// ─── Session Summary ─────────────────────────────────────────

function SessionSummaryView({ summary, onDone, isDark, s }: { summary: SessionSummary; onDone: () => void; isDark: boolean; s: any }) {
  const durationMin = Math.max(1, Math.round(summary.durationMs / 60000));
  const nextReview = summary.nextReviewDate ? new Date(summary.nextReviewDate).toLocaleDateString() : "—";

  return (
    <ScrollView className="flex-1 px-6" contentContainerStyle={{ alignItems: "center", paddingTop: 60, paddingBottom: 100 }}>
      <View className="w-20 h-20 rounded-full items-center justify-center mb-6" style={{ backgroundColor: isDark ? "#1B4D4F" : "#f0fdfa" }}>
        <Trophy size={36} color={isDark ? "#FDDC91" : "#0d9488"} />
      </View>

      <Text className="text-charcoal dark:text-neutral-100 mb-8" style={{ fontFamily: "NotoSerif_700Bold", fontSize: 24 }}>
        {s.flashcardsSummaryTitle}
      </Text>

      <View className="w-full max-w-sm gap-4">
        <SummaryRow label={s.flashcardsSummaryReviewed} value={String(summary.total)} />
        {summary.total > 0 && (
          <SummaryRow
            label={summary.wirdMaintainedToday ? s.wirdMaintained : s.wirdConsistency}
            value={interpolate(s.wirdDays, { n: summary.wirdDays.toLocaleString() })}
          />
        )}
        <View className="flex-row gap-3">
          <SummaryCard label={s.flashcardsSummaryNew} value={String(summary.newCount)} color="#3b82f6" />
          <SummaryCard label={s.flashcardsSummaryReview} value={String(summary.reviewCount)} color="#22c55e" />
          <SummaryCard label={s.flashcardsSummaryRelearning} value={String(summary.relearningCount)} color="#ef4444" />
        </View>
        <SummaryRow label={s.flashcardsSummaryDuration} value={interpolate(s.flashcardsSummaryMinutes, { n: String(durationMin) })} />
        <SummaryRow label={s.flashcardsSummaryNextReview} value={nextReview} />
      </View>

      <Button onPress={onDone} className="mt-10 w-full max-w-sm">
        <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>{s.flashcardsSummaryDone}</Text>
      </Button>
    </ScrollView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <Card elevation="low" className="flex-row items-center justify-between p-5">
      <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}>{label}</Text>
      <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 18 }}>{value}</Text>
    </Card>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card elevation="low" className="flex-1 items-center p-4">
      <View className="w-2 h-2 rounded-full mb-2" style={{ backgroundColor: color }} />
      <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 20 }}>{value}</Text>
      <Text className="text-warm-400 dark:text-neutral-500 mt-0.5" style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}>{label}</Text>
    </Card>
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function getModeName(mode: ReviewMode, s: any): string {
  const map: Record<ReviewMode, string> = {
    nextAyah: s.flashcardsModeNextAyah,
    previousAyah: s.flashcardsModePreviousAyah,
    translation: s.flashcardsModeTranslation,
    tafseer: s.flashcardsModeTafseer,
    surahName: s.flashcardsModeSurahName,
    wordMeaningArabic: s.flashcardsModeWordMeaningArabic,
    wordMeaningTranslation: s.flashcardsModeWordMeaningTranslation,
    smartRefs: s.smartDeckTargetAyah,
    qiraatReading: s.smartDeckQiraatAnswerTitle,
  };
  return map[mode] ?? mode;
}

function getModeColor(mode: ReviewMode): string {
  if (isWordTestMode(mode)) return WORD_TEST_MODE_COLORS[mode];
  if (isSmartTestMode(mode)) return SMART_TEST_MODE_COLORS[mode];
  return TEST_MODE_COLORS[mode];
}

function isWordTestMode(mode: ReviewMode): mode is WordTestMode {
  return mode === "wordMeaningArabic" || mode === "wordMeaningTranslation";
}

function isSmartTestMode(mode: ReviewMode): mode is SmartTestMode {
  return mode === "smartRefs" || mode === "qiraatReading";
}

function isSmartReviewCard(card: CardData): boolean {
  return card.kind === "mutashabihat" || card.kind === "similarTail" || card.kind === "qiraat";
}

function toFSRSCard(row: StudyCardRow): FSRSCard {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
  };
}

function getGradeSchedulePreviews(
  row: StudyCardRow,
  settings: DeckReviewSettings | null,
  isRTL: boolean
): Record<number, string> {
  const now = new Date();
  const previews: Record<number, string> = {};

  for (const { rating } of GRADE_BUTTONS) {
    const result = gradeCard(toFSRSCard(row), now, rating, settings ?? undefined);
    const stepLabel = getLearningStepPreview(result.card, settings, isRTL);
    const returnLabel = formatReturnDelay(result.card.due, now, isRTL);
    previews[rating] = stepLabel ? `${stepLabel} · ${returnLabel}` : returnLabel;
  }

  return previews;
}

function getLearningStepPreview(
  nextCard: FSRSCard,
  settings: DeckReviewSettings | null,
  isRTL: boolean
): string | null {
  const steps = nextCard.state === State.Learning
    ? (settings?.learningSteps ?? DEFAULT_DECK_LEARNING_STEPS)
    : nextCard.state === State.Relearning
      ? (settings?.relearningSteps ?? DEFAULT_DECK_RELEARNING_STEPS)
      : null;

  if (!steps?.length) return null;

  const step = Math.min(Math.max(nextCard.learning_steps, 0), steps.length - 1) + 1;
  return `${formatCompactNumber(step, isRTL)}/${formatCompactNumber(steps.length, isRTL)}`;
}

function formatReturnDelay(due: Date, now: Date, isRTL: boolean): string {
  const minutes = Math.ceil(Math.max(0, due.getTime() - now.getTime()) / 60000);
  const units = isRTL
    ? { minute: "د", hour: "س", day: "ي", month: "ش", year: "سنة" }
    : { minute: "m", hour: "h", day: "d", month: "mo", year: "y" };

  if (minutes <= 1) return `<${formatCompactNumber(1, isRTL)}${units.minute}`;
  if (minutes < 60) return `${formatCompactNumber(minutes, isRTL)}${units.minute}`;

  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${formatCompactNumber(hours, isRTL)}${units.hour}`;

  const days = Math.ceil(minutes / 1440);
  if (days < 30) return `${formatCompactNumber(days, isRTL)}${units.day}`;

  if (days < 365) {
    return `${formatCompactNumber(Math.max(1, Math.round(days / 30)), isRTL)}${units.month}`;
  }

  return `>${formatCompactNumber(Math.max(1, Math.floor(days / 365)), isRTL)}${units.year}`;
}

function formatCompactNumber(value: number, isRTL: boolean): string {
  return isRTL ? toArabicNumeral(value) : String(value);
}

function getSmartDeckTitleForKind(kind: SmartCardKind, s: any): string {
  if (kind === "mutashabihat") return s.smartDeckMutashabihatTitle;
  if (kind === "similarTail") return s.smartDeckSimilarTailsTitle;
  return s.smartDeckQiraatTitle;
}

function getSmartPrompt(card: CardData, s: any): string {
  if (card.kind === "similarTail") return s.smartDeckTailCompletePrompt;
  if (card.kind === "qiraat") return s.smartDeckQiraatPrompt;
  return s.smartDeckMutashabihatPrefixPrompt;
}

function formatAyahKeyArabic(key: string): string {
  const [surah, ayah] = key.split(":").map((part) => parseInt(part, 10));
  if (!Number.isFinite(surah) || !Number.isFinite(ayah)) return key;
  return `${toArabicNumeral(surah)}:${toArabicNumeral(ayah)}`;
}

function toArabicNumeral(n: number): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[parseInt(d, 10)]);
}
