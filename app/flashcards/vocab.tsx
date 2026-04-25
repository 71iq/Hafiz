import { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, ArrowRight, Trash2, X } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { listVocabCards, deleteVocabCard, type VocabCard } from "@/lib/vocab/queries";
import { Rating } from "@/lib/fsrs/scheduler";
import { fsrs } from "ts-fsrs";

const scheduler = fsrs({ request_retention: 0.95 });

export default function VocabSessionScreen() {
  const db = useDatabase();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  const router = useRouter();

  const [cards, setCards] = useState<VocabCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await listVocabCards(db);
      const now = new Date();
      const due = all.filter((c) => !c.due || new Date(c.due) <= now);
      setCards(due.length > 0 ? due : all);
      setIdx(0);
      setRevealed(false);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    load();
  }, [load]);

  const grade = useCallback(
    async (rating: number) => {
      const c = cards[idx];
      if (!c) return;
      const cardObj = {
        due: c.due ? new Date(c.due) : new Date(),
        stability: c.stability,
        difficulty: c.difficulty,
        elapsed_days: c.elapsed_days,
        scheduled_days: c.scheduled_days,
        learning_steps: 0,
        reps: c.reps,
        lapses: c.lapses,
        state: c.state,
        last_review: c.last_review ? new Date(c.last_review) : undefined,
      };
      const result = scheduler.repeat(cardObj as any, new Date());
      const next = result[rating as keyof typeof result] as any;
      if (!next?.card) return;
      const u = next.card;
      await db.runAsync(
        `UPDATE vocab_cards SET
          due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
          reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?`,
        [
          new Date(u.due).toISOString(),
          u.stability,
          u.difficulty,
          u.elapsed_days,
          u.scheduled_days,
          u.reps,
          u.lapses,
          u.state,
          new Date().toISOString(),
          c.id,
        ]
      );
      setRevealed(false);
      setIdx((i) => i + 1);
    },
    [cards, idx, db]
  );

  const remove = useCallback(async () => {
    const c = cards[idx];
    if (!c) return;
    await deleteVocabCard(db, c.id);
    setCards((prev) => prev.filter((x) => x.id !== c.id));
    setRevealed(false);
  }, [cards, idx, db]);

  const finished = !loading && (cards.length === 0 || idx >= cards.length);
  const card = cards[idx];
  const Back = isRTL ? ArrowRight : ArrowLeft;

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="flex-row items-center justify-between px-5 py-3">
        <Pressable
          onPress={() => router.back()}
          className="w-10 h-10 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
        >
          <Back size={18} color={isDark ? "#a3a3a3" : "#003638"} />
        </Pressable>
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
        >
          {s.vocabDeckTitle}
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="w-10 h-10 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
        >
          <X size={18} color={isDark ? "#a3a3a3" : "#003638"} />
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingVertical: 24, alignItems: "center" }}>
        {loading ? (
          <Text className="text-warm-400 dark:text-neutral-500 mt-12">{s.loading}</Text>
        ) : finished ? (
          <View className="items-center mt-16 gap-3">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 24 }}
            >
              {s.flashcardsSummaryTitle}
            </Text>
            <Pressable
              onPress={() => router.back()}
              className="rounded-full bg-primary-accent px-5 py-2.5 mt-3"
            >
              <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                {s.flashcardsSummaryDone}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View className="w-full max-w-md gap-4">
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
            >
              {`${idx + 1} / ${cards.length}`}
            </Text>

            <View className="bg-surface-high dark:bg-surface-dark-high rounded-3xl p-6 items-center">
              <Text
                className="text-charcoal dark:text-neutral-100 mb-2"
                style={{
                  writingDirection: "rtl",
                  textAlign: "center",
                  fontSize: 32,
                  lineHeight: 48,
                }}
              >
                {card?.word ?? "—"}
              </Text>
              <Text
                className="text-warm-400 dark:text-neutral-500"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 12 }}
              >
                {card ? `${card.surah}:${card.ayah}:${card.word_pos}` : ""}
              </Text>

              {revealed ? (
                <Text
                  className="text-charcoal dark:text-neutral-200 mt-5"
                  style={{
                    writingDirection: uiLanguage === "ar" ? "rtl" : undefined,
                    textAlign: uiLanguage === "ar" ? "right" : "left",
                    fontFamily: "Manrope_400Regular",
                    fontSize: 16,
                    lineHeight: 26,
                  }}
                >
                  {(uiLanguage === "ar"
                    ? card?.meaning_ar ?? card?.meaning_en
                    : card?.meaning_en ?? card?.meaning_ar) ?? "—"}
                </Text>
              ) : (
                <Pressable
                  onPress={() => setRevealed(true)}
                  className="rounded-full bg-primary-accent px-5 py-2.5 mt-5"
                >
                  <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                    {s.flashcardsReveal}
                  </Text>
                </Pressable>
              )}
            </View>

            {revealed && (
              <View className="flex-row gap-2">
                {[
                  { r: Rating.Again, label: s.flashcardsAgain, color: "#dc2626" },
                  { r: Rating.Hard, label: s.flashcardsHard, color: "#b45309" },
                  { r: Rating.Good, label: s.flashcardsGood, color: "#0d9488" },
                  { r: Rating.Easy, label: s.flashcardsEasy, color: "#1d4ed8" },
                ].map((b) => (
                  <Pressable
                    key={b.r}
                    onPress={() => grade(b.r as number)}
                    className="flex-1 rounded-full py-2.5 items-center"
                    style={({ pressed }) => ({
                      backgroundColor: b.color,
                      opacity: pressed ? 0.9 : 1,
                    })}
                  >
                    <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                      {b.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Pressable
              onPress={remove}
              className="self-center mt-3 flex-row items-center gap-1.5"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Trash2 size={14} color={isDark ? "#737373" : "#8B8178"} />
              <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
                {s.flashcardsDelete}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
