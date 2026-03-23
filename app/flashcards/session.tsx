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
import { X, ChevronRight, Trophy, RotateCcw } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { interpolate } from "@/lib/i18n/useStrings";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { gradeCard, Rating, State, createEmptyCard } from "@/lib/fsrs/scheduler";
import type { Card as FSRSCard, Grade } from "@/lib/fsrs/scheduler";
import { getDueCards, updateCard, insertStudyLog } from "@/lib/fsrs/queries";
import { computeUniqueFront, getFirstLetters } from "@/lib/fsrs/uniqueness";
import type { StudyCardRow, TestMode } from "@/lib/fsrs/types";
import { ALL_TEST_MODES, DEFAULT_ENABLED_MODES } from "@/lib/fsrs/types";

// ─── Types ───────────────────────────────────────────────────

type SessionPhase = "loading" | "front" | "side" | "grading" | "summary";

type CardData = {
  card: StudyCardRow;
  surah: number;
  ayah: number;
  surahName: string;
  textUthmani: string;
  textClean: string;
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
  return (
    <SettingsProvider>
      <FlashcardSessionScreen />
    </SettingsProvider>
  );
}

function FlashcardSessionScreen() {
  const db = useDatabase();
  const { isDark, fontSize, lineHeight, tafseerSource } = useSettings();
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
  const flipAnim = useRef(new RNAnimated.Value(0)).current;

  // Load enabled test modes from settings
  useEffect(() => {
    db.getFirstAsync<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = 'flashcard_test_modes'"
    ).then((row) => {
      if (row?.value) {
        try {
          const modes = JSON.parse(row.value) as TestMode[];
          if (modes.length > 0) setEnabledModes(modes);
        } catch {}
      }
    });
  }, [db]);

  // Load due cards and pre-fetch all card data
  useEffect(() => {
    async function load() {
      const dueRows = await getDueCards(db, deckId);
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
          db.getFirstAsync<{ text_uthmani: string; text_clean: string }>(
            "SELECT text_uthmani, text_clean FROM quran_text WHERE surah = ? AND ayah = ?",
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
          textClean: ayahRow?.text_clean ?? "",
          uniqueFront,
          translation: translationRow?.text_en ?? "",
          tafseer: tafseerRow?.text ?? "",
          prevAyahText: prevRow?.text_uthmani ?? null,
          nextAyahText: nextRow?.text_uthmani ?? null,
        });
      }

      setCards(loaded);
      setPhase("front");
    }
    load();
  }, [db, deckId, tafseerSource]);

  const currentCard = cards[currentIndex] ?? null;
  const activeModes = useMemo(() => {
    if (!currentCard) return [];
    return enabledModes.filter((mode) => {
      // Filter out modes that don't apply
      if (mode === "previousAyah" && !currentCard.prevAyahText) return false;
      if (mode === "nextAyah" && !currentCard.nextAyahText) return false;
      if (mode === "translation" && !currentCard.translation) return false;
      if (mode === "tafseer" && !currentCard.tafseer) return false;
      return true;
    });
  }, [enabledModes, currentCard]);

  const currentMode = activeModes[currentSideIndex] ?? null;

  // Animate card flip
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
    if (currentSideIndex < activeModes.length - 1) {
      setCurrentSideIndex((i) => i + 1);
      setRevealed(false);
      animateFlip();
    } else {
      // All sides done → grading
      setPhase("grading");
    }
  };

  const handleGrade = async (rating: Grade) => {
    if (!currentCard) return;
    const now = new Date();

    // Reconstruct FSRS card from row
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

    // Update card in DB
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

    // Log the review
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

    // Move to next card or summary
    if (currentIndex < cards.length - 1) {
      setCurrentIndex((i) => i + 1);
      setCurrentSideIndex(0);
      setRevealed(false);
      setPhase("front");
    } else {
      // Session complete
      const newCount = cards.filter((c) => c.card.state === State.New).length;
      const relearningCount = cards.filter((c) => c.card.state === State.Relearning).length;
      const reviewCount = cards.length - newCount - relearningCount;

      // Get next review date
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
    }
  };

  const handleEndSession = () => {
    router.back();
  };

  // ─── Render phases ─────────────────────────────────────────

  if (phase === "loading") {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark items-center justify-center">
        <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 16 }}>
          {s.loading}
        </Text>
      </SafeAreaView>
    );
  }

  if (phase === "summary") {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <SessionSummaryView
          summary={summary!}
          onDone={handleEndSession}
          isDark={isDark}
          s={s}
        />
      </SafeAreaView>
    );
  }

  if (!currentCard) return null;

  const translateY = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [30, 0],
  });
  const opacity = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      {/* Header */}
      <View className="flex-row items-center justify-between px-6 py-3">
        <Pressable
          onPress={handleEndSession}
          className="w-10 h-10 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
        >
          <X size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
        </Pressable>

        {/* Progress bar */}
        <View className="flex-1 mx-4">
          <View className="h-2 rounded-full bg-surface-high dark:bg-surface-dark-high overflow-hidden">
            <View
              className="h-full rounded-full bg-primary-accent"
              style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }}
            />
          </View>
          <Text
            className="text-warm-400 dark:text-neutral-500 mt-1 text-center"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
          >
            {currentIndex + 1} / {cards.length}
          </Text>
        </View>

        {/* Card state badge */}
        <CardStateBadge state={currentCard.card.state} s={s} />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ alignItems: "center", paddingHorizontal: 24, paddingBottom: 140 }}
      >
        <View style={{ width: "100%", maxWidth }}>
          {/* Surah context (always shown subtly) */}
          <Text
            className="text-warm-400 dark:text-neutral-500 text-center mb-2 mt-4"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, writingDirection: "rtl" }}
          >
            {currentCard.surahName} - {s.ayahs} {currentCard.ayah}
          </Text>

          {/* Front of card */}
          {phase === "front" && (
            <Card elevation="low" className="p-8 mb-6">
              {/* Show unique front text */}
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
                style={{
                  fontSize: fontSize,
                  lineHeight: lineHeight,
                  writingDirection: "rtl",
                }}
              >
                {currentCard.uniqueFront.text}
              </Text>
            </Card>
          )}

          {/* Side (test mode) */}
          {phase === "side" && currentMode && (
            <View>
              {/* Front context (smaller) */}
              <Card elevation="low" className="p-5 mb-4">
                <TestModePrompt
                  mode={currentMode}
                  card={currentCard}
                  fontSize={fontSize * 0.85}
                  lineHeight={lineHeight * 0.85}
                  s={s}
                />
              </Card>

              {/* Answer */}
              {revealed ? (
                <RNAnimated.View style={{ transform: [{ translateY }], opacity }}>
                  <Card elevation="mid" className="p-6">
                    <Text
                      className="text-primary-accent dark:text-primary-bright mb-2"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                    >
                      {getModeName(currentMode, s)}
                    </Text>
                    <TestModeAnswer
                      mode={currentMode}
                      card={currentCard}
                      fontSize={fontSize}
                      lineHeight={lineHeight}
                    />
                  </Card>
                </RNAnimated.View>
              ) : null}
            </View>
          )}

          {/* Grading phase — show the ayah as reminder */}
          {phase === "grading" && (
            <Card elevation="low" className="p-6 mb-4">
              <Text
                className="text-charcoal dark:text-neutral-100 text-center"
                style={{
                  fontSize: fontSize * 0.8,
                  lineHeight: lineHeight * 0.8,
                  writingDirection: "rtl",
                }}
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

        {phase === "side" && revealed && (
          <Button onPress={handleNext} className="w-full">
            <View className="flex-row items-center gap-2">
              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
                {currentSideIndex < activeModes.length - 1 ? s.flashcardsNext : s.flashcardsNext}
              </Text>
              <ChevronRight size={18} color="#fff" />
            </View>
          </Button>
        )}

        {phase === "grading" && (
          <GradingButtons onGrade={handleGrade} isDark={isDark} s={s} />
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Test Mode Components ────────────────────────────────────

function TestModePrompt({
  mode,
  card,
  fontSize,
  lineHeight,
  s,
}: {
  mode: TestMode;
  card: CardData;
  fontSize: number;
  lineHeight: number;
  s: any;
}) {
  switch (mode) {
    case "nextAyah":
      return (
        <View>
          <Text
            className="text-warm-400 dark:text-neutral-500 mb-2"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
          >
            {s.flashcardsModeNextAyah}: What comes next?
          </Text>
          <Text
            className="text-charcoal dark:text-neutral-100 text-center"
            style={{ fontSize, lineHeight, writingDirection: "rtl" }}
          >
            {card.textUthmani}
          </Text>
        </View>
      );
    case "previousAyah":
      return (
        <View>
          <Text
            className="text-warm-400 dark:text-neutral-500 mb-2"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
          >
            {s.flashcardsModePreviousAyah}: What came before?
          </Text>
          <Text
            className="text-charcoal dark:text-neutral-100 text-center"
            style={{ fontSize, lineHeight, writingDirection: "rtl" }}
          >
            {card.textUthmani}
          </Text>
        </View>
      );
    case "translation":
      return (
        <View>
          <Text
            className="text-warm-400 dark:text-neutral-500 mb-2"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
          >
            {s.flashcardsModeTranslation}: What does this mean?
          </Text>
          <Text
            className="text-charcoal dark:text-neutral-100 text-center"
            style={{ fontSize, lineHeight, writingDirection: "rtl" }}
          >
            {card.textUthmani}
          </Text>
        </View>
      );
    case "tafseer":
      return (
        <View>
          <Text
            className="text-warm-400 dark:text-neutral-500 mb-2"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
          >
            {s.flashcardsModeTafseer}
          </Text>
          <Text
            className="text-charcoal dark:text-neutral-100 text-center"
            style={{ fontSize, lineHeight, writingDirection: "rtl" }}
          >
            {card.textUthmani}
          </Text>
        </View>
      );
    case "firstLetter":
      return (
        <View>
          <Text
            className="text-warm-400 dark:text-neutral-500 mb-2"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
          >
            {s.flashcardsModeFirstLetter}: Complete the ayah
          </Text>
          <Text
            className="text-charcoal dark:text-neutral-100 text-center"
            style={{ fontSize: fontSize * 1.1, lineHeight: lineHeight * 1.1, writingDirection: "rtl", letterSpacing: 6 }}
          >
            {getFirstLetters(card.textClean)}
          </Text>
        </View>
      );
    case "surahIdentification":
      return (
        <View>
          <Text
            className="text-warm-400 dark:text-neutral-500 mb-2"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
          >
            {s.flashcardsModeSurahId}: Which surah?
          </Text>
          <Text
            className="text-charcoal dark:text-neutral-100 text-center"
            style={{ fontSize, lineHeight, writingDirection: "rtl" }}
          >
            {card.textUthmani}
          </Text>
        </View>
      );
    default:
      return null;
  }
}

function TestModeAnswer({
  mode,
  card,
  fontSize,
  lineHeight,
}: {
  mode: TestMode;
  card: CardData;
  fontSize: number;
  lineHeight: number;
}) {
  switch (mode) {
    case "nextAyah":
      return (
        <Text
          className="text-charcoal dark:text-neutral-100 text-center"
          style={{ fontSize, lineHeight, writingDirection: "rtl" }}
        >
          {card.nextAyahText ?? "—"}
        </Text>
      );
    case "previousAyah":
      return (
        <Text
          className="text-charcoal dark:text-neutral-100 text-center"
          style={{ fontSize, lineHeight, writingDirection: "rtl" }}
        >
          {card.prevAyahText ?? "—"}
        </Text>
      );
    case "translation":
      return (
        <Text
          className="text-charcoal dark:text-neutral-200"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 15, lineHeight: 24 }}
        >
          {card.translation}
        </Text>
      );
    case "tafseer":
      return (
        <Text
          className="text-charcoal dark:text-neutral-200"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 22, writingDirection: "rtl" }}
        >
          {card.tafseer.length > 300 ? card.tafseer.slice(0, 300) + "..." : card.tafseer}
        </Text>
      );
    case "firstLetter":
      return (
        <Text
          className="text-charcoal dark:text-neutral-100 text-center"
          style={{ fontSize, lineHeight, writingDirection: "rtl" }}
        >
          {card.textUthmani}
        </Text>
      );
    case "surahIdentification":
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

const GRADE_BUTTONS: { rating: Grade; colorClass: string; bgColor: string }[] = [
  { rating: Rating.Again, colorClass: "text-red-500", bgColor: "#ef4444" },
  { rating: Rating.Hard, colorClass: "text-orange-500", bgColor: "#f97316" },
  { rating: Rating.Good, colorClass: "text-green-500", bgColor: "#22c55e" },
  { rating: Rating.Easy, colorClass: "text-blue-500", bgColor: "#3b82f6" },
];

function GradingButtons({
  onGrade,
  isDark,
  s,
}: {
  onGrade: (rating: Grade) => void;
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
    <View className="flex-row gap-3">
      {GRADE_BUTTONS.map(({ rating, bgColor }) => (
        <Pressable
          key={rating}
          onPress={() => onGrade(rating)}
          className="flex-1 py-4 rounded-full items-center"
          style={({ pressed }) => ({
            backgroundColor: bgColor,
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.95 : 1 }],
          })}
        >
          <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 14, color: "#fff" }}>
            {labels[rating]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Card State Badge ────────────────────────────────────────

function CardStateBadge({ state, s }: { state: number; s: any }) {
  const config: Record<number, { label: string; bg: string; text: string }> = {
    [State.New]: { label: s.flashcardsSummaryNew, bg: "#3b82f6", text: "#fff" },
    [State.Learning]: { label: s.loading?.split("...")[0] ?? "Learning", bg: "#f97316", text: "#fff" },
    [State.Review]: { label: s.flashcardsSummaryReview, bg: "#22c55e", text: "#fff" },
    [State.Relearning]: { label: s.flashcardsSummaryRelearning, bg: "#ef4444", text: "#fff" },
  };
  const c = config[state] ?? config[State.New];

  return (
    <View className="px-3 py-1 rounded-full" style={{ backgroundColor: c.bg }}>
      <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, color: c.text }}>
        {c.label}
      </Text>
    </View>
  );
}

// ─── Session Summary ─────────────────────────────────────────

function SessionSummaryView({
  summary,
  onDone,
  isDark,
  s,
}: {
  summary: SessionSummary;
  onDone: () => void;
  isDark: boolean;
  s: any;
}) {
  const durationMin = Math.max(1, Math.round(summary.durationMs / 60000));
  const nextReview = summary.nextReviewDate
    ? new Date(summary.nextReviewDate).toLocaleDateString()
    : "—";

  return (
    <ScrollView
      className="flex-1 px-6"
      contentContainerStyle={{ alignItems: "center", paddingTop: 60, paddingBottom: 100 }}
    >
      {/* Trophy */}
      <View
        className="w-20 h-20 rounded-full items-center justify-center mb-6"
        style={{ backgroundColor: isDark ? "#1B4D4F" : "#f0fdfa" }}
      >
        <Trophy size={36} color={isDark ? "#FDDC91" : "#0d9488"} />
      </View>

      <Text
        className="text-charcoal dark:text-neutral-100 mb-8"
        style={{ fontFamily: "NotoSerif_700Bold", fontSize: 24 }}
      >
        {s.flashcardsSummaryTitle}
      </Text>

      {/* Stats grid */}
      <View className="w-full max-w-sm gap-4">
        <SummaryRow label={s.flashcardsSummaryReviewed} value={String(summary.total)} isDark={isDark} />
        <View className="flex-row gap-3">
          <SummaryCard label={s.flashcardsSummaryNew} value={String(summary.newCount)} color="#3b82f6" isDark={isDark} />
          <SummaryCard label={s.flashcardsSummaryReview} value={String(summary.reviewCount)} color="#22c55e" isDark={isDark} />
          <SummaryCard label={s.flashcardsSummaryRelearning} value={String(summary.relearningCount)} color="#ef4444" isDark={isDark} />
        </View>
        <SummaryRow
          label={s.flashcardsSummaryDuration}
          value={interpolate(s.flashcardsSummaryMinutes, { n: String(durationMin) })}
          isDark={isDark}
        />
        <SummaryRow label={s.flashcardsSummaryNextReview} value={nextReview} isDark={isDark} />
      </View>

      <Button onPress={onDone} className="mt-10 w-full max-w-sm">
        <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
          {s.flashcardsSummaryDone}
        </Text>
      </Button>
    </ScrollView>
  );
}

function SummaryRow({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  return (
    <Card elevation="low" className="flex-row items-center justify-between p-5">
      <Text
        className="text-warm-400 dark:text-neutral-500"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}
      >
        {label}
      </Text>
      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 18 }}
      >
        {value}
      </Text>
    </Card>
  );
}

function SummaryCard({
  label,
  value,
  color,
  isDark,
}: {
  label: string;
  value: string;
  color: string;
  isDark: boolean;
}) {
  return (
    <Card elevation="low" className="flex-1 items-center p-4">
      <View className="w-2 h-2 rounded-full mb-2" style={{ backgroundColor: color }} />
      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 20 }}
      >
        {value}
      </Text>
      <Text
        className="text-warm-400 dark:text-neutral-500 mt-0.5"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
      >
        {label}
      </Text>
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
    firstLetter: s.flashcardsModeFirstLetter,
    surahIdentification: s.flashcardsModeSurahId,
  };
  return map[mode] ?? mode;
}
