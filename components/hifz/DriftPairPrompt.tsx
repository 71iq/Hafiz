import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { SimilarVerseLine } from "@/components/hifz/SimilarVerseLine";
import { formatAyahRef } from "@/lib/arabic";
import type { SimilarPair, SimilarRef } from "@/lib/hifz/similar";
import type { UIStrings } from "@/lib/i18n/strings";

type Props = {
  pair: SimilarPair;
  /** Which verse of the pair the prompt asks for. */
  target: "self" | "sibling";
  dir: "ltr" | "rtl";
  s: UIStrings;
  accent: string;
  accentText: string;
  busy: boolean;
  error: string | null;
  onNext: () => void;
};

function sameVerse(a: SimilarRef, b: SimilarRef): boolean {
  return a.surah === b.surah && a.ayah === b.ayah;
}

/**
 * MUT-04 "Which one" prompt after a drift: both verses of the pair with their shared wording marked
 * and their references hidden, and the reference of one of them. Choosing shows both references and
 * which one it was, described neutrally (ERR-07). Nothing is graded; the next item follows.
 */
export function DriftPairPrompt({ pair, target, dir, s, accent, accentText, busy, error, onNext }: Props) {
  const isRTL = dir === "rtl";
  const [chosen, setChosen] = useState<SimilarRef | null>(null);
  const answer = target === "self" ? pair.self : pair.sibling;
  // Mushaf order, so the right answer's position follows the verses, not the prompt.
  const options = [pair.self, pair.sibling].sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);
  const answerRef = `${answer.surahName} ${formatAyahRef(isRTL, answer.surah, answer.ayah)}`;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16, alignItems: "center" }}>
      <View className="rounded-full px-3 py-1 bg-primary-accent/10 dark:bg-primary-bright/15">
        <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: accentText }}>{s.hifzSimilarTitle}</Text>
      </View>
      <Text dir={dir} align="center" variant="title-md">
        {s.hifzPairTitle}
      </Text>
      <View style={{ gap: 4 }}>
        <Text dir={dir} align="center" variant="body">
          {s.hifzPairPrompt}
        </Text>
        {/* The reference sits on its own line, so the Arabic surah name never reorders an English sentence. */}
        <Text
          dir={dir}
          align="center"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 16 }}
          className="text-charcoal dark:text-neutral-100"
        >
          {answerRef}
        </Text>
      </View>
      <View className="w-full" style={{ gap: 10 }} accessibilityRole="radiogroup">
        {options.map((option) => {
          const key = `${option.surah}:${option.ayah}`;
          const isAnswer = sameVerse(option, answer);
          const picked = chosen !== null && sameVerse(option, chosen);
          const border =
            chosen === null
              ? "border border-warm-300 dark:border-neutral-700"
              : isAnswer
                ? "border-2 border-primary-accent dark:border-primary-bright"
                : "border border-warm-300 dark:border-neutral-700 opacity-80";
          return (
            <Pressable
              key={key}
              accessibilityRole="radio"
              accessibilityState={{ checked: picked, disabled: chosen !== null }}
              disabled={chosen !== null}
              onPress={() => setChosen(option)}
            >
              <Card elevation="low" className={`p-4 rounded-3xl ${border}`}>
                <SimilarVerseLine reference={option} isRTL={isRTL} accent={accent} showReference={chosen !== null} />
              </Card>
            </Pressable>
          );
        })}
      </View>
      {chosen !== null ? (
        // Both references are shown now, so the feedback names neither and stays in one direction.
        <Text dir={dir} align="center" variant="body" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {sameVerse(chosen, answer) ? s.hifzPairRight : s.hifzPairOther}
        </Text>
      ) : null}
      {error ? (
        <Text dir={dir} className="text-red-600 dark:text-red-400" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {chosen !== null ? (
        <Button className="w-full max-w-sm" label={s.hifzSabaqNext} onPress={onNext} disabled={busy} />
      ) : null}
    </ScrollView>
  );
}
