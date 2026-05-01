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
import { gradeCard, Rating, State, createEmptyCard } from "@/lib/fsrs/scheduler";
import type { Card as FSRSCard, Grade } from "@/lib/fsrs/scheduler";
import { getDueCards, updateCard, insertStudyLog, getStudyStreak } from "@/lib/fsrs/queries";
import { computeUniqueFront } from "@/lib/fsrs/uniqueness";
import { computeReviewPoints, addTodayPoints, getTodayScore } from "@/lib/fsrs/scoring";
import { hapticMedium, hapticSuccess } from "@/lib/haptics";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { syncDailyScore, updateProfileStats } from "@/lib/fsrs/leaderboard-sync";
import type { StudyCardRow, TestMode } from "@/lib/fsrs/types";
import { DEFAULT_ENABLED_MODES, TEST_MODE_COLORS } from "@/lib/fsrs/types";

// ─── Types ───────────────────────────────────────────────────

type SessionPhase = "loading" | "front" | "side" | "grading" | "summary";

type CardData = {
  card: StudyCardRow;
  surah: number;
  ayah: number;
  surahName: string;
  textUthmani: string;
  uniqueFront: { text: string; surahName: string; contextCount: number; needsExplicitLabel: boolean };
  translation: string;
  tafseer: string;
  prevAyahText: string | null;
  nextAyahText: string | null;
};

type SessionSummary = {
  total: number;
  newCount: number;
  reviewCount: number;
  relearningCount: number;
  durationMs: number;
  nextReviewDate: string | null;
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

/** Fisher-Yates shuffle (in-place) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function FlashcardSessionScreen() {
  const db = useDatabase();
  const { isDark, fontSize, lineHeight, tafseerSource, dailyReviewLimit } = useSettings();
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
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const sessionStartRef = useRef(Date.now());
  const streakRef = useRef(0);
  const sessionPointsRef = useRef(0);
  const flipAnim = useRef(new RNAnimated.Value(0)).current;

  // Load enabled test modes from settings
  useEffect(() => {
    db.getFirstAsync<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = 'flashcard_test_modes'"
    ).then((row) => {
      if (row?.value) {
        try {
          const modes = JSON.parse(row.value) as TestMode[];
          // Filter out removed modes (e.g. firstLetter, surahIdentification)
          const valid = modes.filter((m) =>
            ["nextAyah", "previousAyah", "translation", "tafseer", "surahName"].includes(m)
          );
          if (valid.length > 0) setEnabledModes(valid);
        } catch {}
      }
    });
  }, [db]);

  // Load due cards and pre-fetch all card data
  useEffect(() => {
    async function load() {
      // Pre-load streak for scoring
      streakRef.current = await getStudyStreak(db);
      const dueRows = await getDueCards(db, deckId, dailyReviewLimit);
      if (dueRows.length === 0) {
        setSummary({ total: 0, newCount: 0, reviewCount: 0, relearningCount: 0, durationMs: 0, nextReviewDate: null });
        setPhase("summary");
        return;
      }

      const loaded: CardData[] = [];
      for (const row of dueRows) {
        const [surahStr, ayahStr] = row.id.split(":");
        const surah = parseInt(surahStr);
        const ayah = parseInt(ayahStr);

        const [ayahRow, surahRow, translationRow, tafseerRow, prevRow, nextRow, uniqueFront] = await Promise.all([
          db.getFirstAsync<{ text_uthmani: string }>(
            "SELECT text_uthmani FROM quran_text WHERE surah = ? AND ayah = ?",
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
            ? db.getFirstAsync<{ text_uthmani: string }>(
                "SELECT text_uthmani FROM quran_text WHERE surah = ? AND ayah = ?",
                [surah, ayah - 1]
              )
            : null,
          db.getFirstAsync<{ text_uthmani: string }>(
            "SELECT text_uthmani FROM quran_text WHERE surah = ? AND ayah = ?",
            [surah, ayah + 1]
          ),
          computeUniqueFront(db, surah, ayah),
        ]);

        loaded.push({
          card: row,
          surah,
          ayah,
          surahName: surahRow?.name_arabic ?? "",
          textUthmani: ayahRow?.text_uthmani ?? "",
          uniqueFront,
          translation: translationRow?.text_en ?? "",
          tafseer: tafseerRow?.text ?? "",
          prevAyahText: prevRow?.text_uthmani ?? null,
          nextAyahText: nextRow?.text_uthmani ?? null,
        });
      }

      shuffle(loaded);
      setCards(loaded);
      setPhase("front");
    }
    load();
  }, [db, deckId, tafseerSource, dailyReviewLimit]);

  const currentCard = cards[currentIndex] ?? null;
  const activeModes = useMemo(() => {
    if (!currentCard) return [];
    return enabledModes.filter((mode) => {
      if (mode === "previousAyah" && (!currentCard.prevAyahText || currentCard.uniqueFront.contextCount > 0)) return false;
      if (mode === "nextAyah" && !currentCard.nextAyahText) return false;
      if (mode === "translation" && !currentCard.translation) return false;
      if (mode === "tafseer" && !currentCard.tafseer) return false;
      return true;
    });
  }, [enabledModes, currentCard]);

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

  const handleReveal = () => {
    setRevealed(true);
    animateFlip();
  };

  const handleNext = () => {
    setCurrentSideIndex((i) => i + 1);
    setRevealed(false);
    animateFlip();
  };

  const handleGrade = async (rating: Grade) => {
    if (!currentCard) return;
    hapticMedium();
    const now = new Date();

    const fsrsCard: FSRSCard = {
      due: new Date(currentCard.card.due),
      stability: currentCard.card.stability,
      difficulty: currentCard.card.difficulty,
      elapsed_days: currentCard.card.elapsed_days,
      scheduled_days: currentCard.card.scheduled_days,
      learning_steps: currentCard.card.learning_steps,
      reps: currentCard.card.reps,
      lapses: currentCard.card.lapses,
      state: currentCard.card.state as State,
    };

    const result = gradeCard(fsrsCard, now, rating);

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

      setSummary({
        total: cards.length,
        newCount,
        reviewCount,
        relearningCount,
        durationMs: Date.now() - sessionStartRef.current,
        nextReviewDate: nextRow?.due ?? null,
      });
      setPhase("summary");
      hapticSuccess();

      // Sync daily score and profile stats to Supabase (non-blocking)
      syncDailyScore(db).catch(console.warn);
      updateProfileStats(db).catch(console.warn);
    }
  };

  const handleEndSession = () => {
    router.back();
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
          {currentIndex + 1} / {cards.length}
        </Text>

        <CardStateBadge state={currentCard.card.state} s={s} />
        </View>
        <View className="mt-2 h-[2px] rounded-full bg-surface-high dark:bg-surface-dark-high overflow-hidden">
          <View
            className="h-full rounded-full bg-primary-accent dark:bg-primary-bright"
            style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }}
          />
        </View>
      </View>

      {/* Mode tags row */}
      {phase === "side" && activeModes.length > 0 && (
        <View className="flex-row flex-wrap gap-2 px-6 pb-3">
          {activeModes.map((mode, i) => {
            const color = TEST_MODE_COLORS[mode];
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
      )}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ alignItems: "center", paddingHorizontal: 24, paddingBottom: 140 }}
      >
        <View style={{ width: "100%", maxWidth }}>
          {/* Surah context */}
          <Text
            className="text-warm-400 dark:text-neutral-500 text-center mb-2 mt-2"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, writingDirection: "rtl" }}
          >
            {currentCard.surahName} - {s.ayahs} {currentCard.ayah}
          </Text>

          {/* Front of card */}
          {phase === "front" && (
            <Card elevation="low" className="p-6 mb-6 rounded-3xl bg-surface-low dark:bg-surface-dark-low">
              {currentCard.uniqueFront.needsExplicitLabel && (
                <Text
                  className="text-primary-accent dark:text-primary-bright text-center mb-3"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                >
                  {currentCard.surahName} ({currentCard.ayah})
                </Text>
              )}
              {currentCard.uniqueFront.contextCount > 0 && (
                <Text
                  className="text-warm-400 dark:text-neutral-500 text-center mb-3"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 11 }}
                >
                  ({currentCard.uniqueFront.contextCount} {currentCard.uniqueFront.contextCount === 1 ? "ayah" : "ayahs"} of context)
                </Text>
              )}
              <Text
                className="text-charcoal dark:text-neutral-100 text-center"
                style={{ fontSize, lineHeight, writingDirection: "rtl" }}
              >
                {currentCard.uniqueFront.text}
              </Text>
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
                    <TestModeAnswer mode={currentMode} card={currentCard} fontSize={fontSize} lineHeight={lineHeight} />
                  </Card>
                </RNAnimated.View>
              )}
            </View>
          )}

          {/* Grading phase */}
          {phase === "grading" && (
            <Card elevation="low" className="p-6 mb-4 rounded-3xl bg-surface-low dark:bg-surface-dark-low">
              <Text
                className="text-charcoal dark:text-neutral-100 text-center"
                style={{ fontSize: fontSize * 0.8, lineHeight: lineHeight * 0.8, writingDirection: "rtl" }}
              >
                {currentCard.textUthmani}
              </Text>
            </Card>
          )}
        </View>
      </ScrollView>

      {/* Bottom action area */}
      <View
        className="px-6 pb-6 pt-4"
        style={{ backgroundColor: isDark ? "rgba(10,10,10,0.95)" : "rgba(255,248,241,0.95)" }}
      >
        {phase === "front" && (
          <Button onPress={() => { setPhase("side"); setCurrentSideIndex(0); setRevealed(false); }} className="w-full">
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
              {s.flashcardsReveal}
            </Text>
          </Button>
        )}

        {phase === "side" && !revealed && (
          <Button onPress={handleReveal} className="w-full">
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
            <GradingButtons onGrade={handleGrade} isDark={isDark} s={s} />
            <Text
              className="text-warm-400 dark:text-neutral-500 text-center mt-2"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.flashcardsGrade}
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Test Mode Components ────────────────────────────────────

function TestModePrompt({
  mode, card, fontSize, lineHeight, s,
}: {
  mode: TestMode; card: CardData; fontSize: number; lineHeight: number; s: any;
}) {
  const label = getModeName(mode, s);
  const color = TEST_MODE_COLORS[mode];

  const promptText: Record<string, string> = {
    nextAyah: s.flashcardsModeNextAyah,
    previousAyah: s.flashcardsModePreviousAyah,
    translation: s.flashcardsModeTranslation,
    tafseer: "",
    surahName: s.flashcardsModeSurahName,
  };

  // Surah Name mode hides the surah context
  const showAyah = mode !== "surahName" || true;

  return (
    <View>
      <View className="flex-row items-center gap-2 mb-3">
        <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: color }}>
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, color: "#fff" }}>
            {label}
          </Text>
        </View>
        {promptText[mode] ? (
          <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_400Regular", fontSize: 11 }}>
            {promptText[mode]}
          </Text>
        ) : null}
      </View>
      <Text
        className="text-charcoal dark:text-neutral-100 text-center"
        style={{ fontSize, lineHeight, writingDirection: "rtl" }}
      >
        {card.textUthmani}
      </Text>
    </View>
  );
}

function TestModeAnswer({
  mode, card, fontSize, lineHeight,
}: {
  mode: TestMode; card: CardData; fontSize: number; lineHeight: number;
}) {
  switch (mode) {
    case "nextAyah":
      return (
        <Text className="text-charcoal dark:text-neutral-100 text-center" style={{ fontSize, lineHeight, writingDirection: "rtl" }}>
          {card.nextAyahText ?? "—"}
        </Text>
      );
    case "previousAyah":
      return (
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
    default:
      return null;
  }
}

// ─── Grading ─────────────────────────────────────────────────

const GRADE_BUTTONS: { rating: Grade; bgLight: string; bgDark: string }[] = [
  { rating: Rating.Again, bgLight: "#b91c1c", bgDark: "#dc2626" },
  { rating: Rating.Hard, bgLight: "#b45309", bgDark: "#d97706" },
  { rating: Rating.Good, bgLight: "#15803d", bgDark: "#16a34a" },
  { rating: Rating.Easy, bgLight: "#1d4ed8", bgDark: "#2563eb" },
];

function GradingButtons({ onGrade, isDark, s }: { onGrade: (rating: Grade) => void; isDark: boolean; s: any }) {
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
              paddingVertical: 14,
            }}
          >
            <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 14, color: "#fff" }}>
              {labels[rating]}
            </Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row justify-between px-1">
        {GRADE_BUTTONS.map(({ rating }) => (
          <Text
            key={`hint-${rating}`}
            className="text-warm-500 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 10 }}
          >
            {labels[rating]}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ─── Card State Badge ────────────────────────────────────────

function CardStateBadge({ state, s }: { state: number; s: any }) {
  const config: Record<number, { label: string; bg: string }> = {
    [State.New]: { label: s.flashcardsSummaryNew, bg: "#3b82f6" },
    [State.Learning]: { label: "Learning", bg: "#f97316" },
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

function getModeName(mode: TestMode, s: any): string {
  const map: Record<TestMode, string> = {
    nextAyah: s.flashcardsModeNextAyah,
    previousAyah: s.flashcardsModePreviousAyah,
    translation: s.flashcardsModeTranslation,
    tafseer: s.flashcardsModeTafseer,
    surahName: s.flashcardsModeSurahName,
  };
  return map[mode] ?? mode;
}
