import { useState, useCallback, useMemo, useEffect } from "react";
import { View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import type { FlashCard } from "../../lib/uniqueness";
import { sm2, getNextReviewDate, getTodayDate, projectIntervals, type SM2Input } from "../../lib/sm2";
import { getStudyLogEntry, upsertStudyLog } from "../../db/database";
import FlashcardView from "./FlashcardView";
import GradingButtons from "./GradingButtons";
import type { SessionStats } from "./SessionSummary";
import { Button } from "../ui/button";
import { Text } from "../ui/text";
import { Progress } from "../ui/progress";

interface FlashcardSessionProps {
  deck: FlashCard[];
  onComplete: (stats: SessionStats) => void;
  onExit: () => void;
}

type CardState = "prompt" | "reveal";

export default function FlashcardSession({ deck, onComplete, onExit }: FlashcardSessionProps) {
  const db = useSQLiteContext();
  const [cardIndex, setCardIndex] = useState(0);
  const [cardState, setCardState] = useState<CardState>("prompt");
  const [grades, setGrades] = useState<number[]>([]);

  const currentCard = deck[cardIndex];

  const defaultEntry: SM2Input = { interval: 0, repetitions: 0, easeFactor: 2.5 };
  const [prevEntry, setPrevEntry] = useState<SM2Input>(defaultEntry);

  useEffect(() => {
    if (!currentCard) return;
    (async () => {
      const log = await getStudyLogEntry(db, currentCard.ayah.surah, currentCard.ayah.ayah);
      if (log) {
        setPrevEntry({
          interval: log.interval,
          repetitions: log.repetitions,
          easeFactor: log.ease_factor,
        });
      } else {
        setPrevEntry(defaultEntry);
      }
    })();
  }, [db, currentCard]);

  const intervals = useMemo(() => projectIntervals(prevEntry), [prevEntry]);

  const handleReveal = useCallback(() => {
    setCardState("reveal");
  }, []);

  const handleGrade = useCallback(
    async (grade: number) => {
      const result = sm2(grade, prevEntry);
      const today = getTodayDate();

      await upsertStudyLog(db, {
        surah: currentCard.ayah.surah,
        ayah: currentCard.ayah.ayah,
        interval: result.interval,
        repetitions: result.repetitions,
        ease_factor: result.easeFactor,
        next_review_date: getNextReviewDate(result.interval),
        last_review_date: today,
      });

      const newGrades = [...grades, grade];
      setGrades(newGrades);

      const nextIndex = cardIndex + 1;
      if (nextIndex >= deck.length) {
        onComplete({
          total: newGrades.length,
          again: newGrades.filter((g) => g === 0).length,
          hard: newGrades.filter((g) => g === 1).length,
          good: newGrades.filter((g) => g === 2).length,
          easy: newGrades.filter((g) => g === 3).length,
        });
      } else {
        setCardIndex(nextIndex);
        setCardState("prompt");
      }
    },
    [prevEntry, db, currentCard, grades, cardIndex, deck.length, onComplete]
  );

  if (!currentCard) return null;

  const progressPercent = ((cardIndex + 1) / deck.length) * 100;

  return (
    <View className="flex-1 bg-background">
      {/* Header with back button and progress */}
      <View className="px-4 pt-2 pb-1">
        <View className="flex-row items-center justify-between mb-1">
          <Button variant="ghost" size="sm" onPress={onExit}>
            ← Back
          </Button>
          <Text variant="muted" className="text-xs">
            {cardIndex + 1} / {deck.length}
          </Text>
        </View>
        <Progress value={progressPercent} />
      </View>

      {/* Card */}
      <FlashcardView card={currentCard} revealed={cardState === "reveal"} />

      {/* Action area */}
      {cardState === "prompt" ? (
        <View className="px-4 pb-4">
          <Button onPress={handleReveal}>Show Answer</Button>
        </View>
      ) : (
        <GradingButtons intervals={intervals} onGrade={handleGrade} />
      )}
    </View>
  );
}
