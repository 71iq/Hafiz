import { useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, View } from "react-native";
import { Check } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { SimilarVerseLine } from "@/components/hifz/SimilarVerseLine";
import { formatAyahRef } from "@/lib/arabic";
import { meaningKey } from "@/lib/hifz/meanings";
import type { SimilarPair, SimilarRef } from "@/lib/hifz/similar";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";

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
  /** MUT-05: verse meanings keyed 's:a', shown once a verse is chosen so they never give the answer away. */
  meanings: ReadonlyMap<string, string>;
  onNext: () => void;
};

/** The review column's width, so the two verses stay near each other on a wide window. */
const OPTIONS_MAX_WIDTH = 624;

function sameVerse(a: SimilarRef, b: SimilarRef): boolean {
  return a.surah === b.surah && a.ayah === b.ayah;
}

/**
 * The "Which one" prompt, after a drift (MUT-04) or interleaved in a wird review (MUT-03): both verses
 * of the pair with their shared wording marked and their references hidden, and the reference of one
 * of them. Verses that read the same also show the neighbouring words that tell them apart. Choosing
 * shows both references, each verse's meaning (MUT-05), the words that differ, which one was asked for
 * and which one was chosen, described neutrally (ERR-07). Nothing is graded; the next item follows.
 * The feedback and Next sit in a fixed footer, so a long pair never hides them.
 */
export function DriftPairPrompt({ pair, target, dir, s, accent, accentText, busy, error, meanings, onNext }: Props) {
  const isRTL = dir === "rtl";
  const [chosen, setChosen] = useState<SimilarRef | null>(null);
  const answer = target === "self" ? pair.self : pair.sibling;
  // Mushaf order, so the right answer's position follows the verses, not the prompt.
  const options = [pair.self, pair.sibling].sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);
  // The Arabic surah name is isolated in English, so the digits after it keep their order.
  const answerRef = `${answer.surahName}${isRTL ? "" : "\u200E"} ${formatAyahRef(isRTL, answer.surah, answer.ayah)}`;
  const meaningOf = (ref: SimilarRef) => {
    const text = chosen === null ? undefined : meanings.get(meaningKey(ref));
    return text
      ? { label: interpolate(s.hifzSimilarMeaning, { ref: formatAyahRef(isRTL, ref.surah, ref.ayah) }), text }
      : null;
  };
  const right = chosen !== null && sameVerse(chosen, answer);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, alignItems: "center" }}>
        <View className="rounded-full px-3 py-1 bg-primary-accent/10 dark:bg-primary-bright/15">
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: accentText }}>
            {s.hifzSimilarTitle}
          </Text>
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
        <View style={{ width: "100%", maxWidth: OPTIONS_MAX_WIDTH, gap: 10 }} accessibilityRole="radiogroup">
          {options.map((option) => {
            const key = `${option.surah}:${option.ayah}`;
            const isAnswer = sameVerse(option, answer);
            const picked = chosen !== null && sameVerse(option, chosen);
            const other = options.find((candidate) => !sameVerse(candidate, option)) ?? null;
            // Two pixels in every state, so the text never shifts when the answer is marked.
            const border =
              chosen === null
                ? "border-2 border-warm-300 dark:border-neutral-700"
                : isAnswer
                  ? "border-2 border-primary-accent dark:border-primary-bright"
                  : picked
                    ? "border-2 border-warm-500 dark:border-neutral-500"
                    : "border-2 border-warm-300 dark:border-neutral-700 opacity-80";
            const status =
              chosen === null ? null : isAnswer ? (
                <View accessible accessibilityLabel={s.hifzPairAnswer}>
                  <Check size={16} color={accent} />
                </View>
              ) : picked ? (
                <Text dir={dir} variant="caption" className="text-warm-700 dark:text-neutral-400">
                  {s.hifzPairYourChoice}
                </Text>
              ) : null;
            return (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ checked: picked, disabled: chosen !== null }}
                disabled={chosen !== null}
                onPress={() => {
                  setChosen(option);
                  // VoiceOver has no polite live region, so the feedback is announced in both systems.
                  AccessibilityInfo.announceForAccessibility(
                    sameVerse(option, answer) ? s.hifzPairRight : s.hifzPairOther,
                  );
                }}
              >
                <Card elevation="low" className={`p-4 rounded-3xl ${border}`}>
                  <SimilarVerseLine
                    reference={option}
                    isRTL={isRTL}
                    // The verse text takes the text-safe accent (4.5:1 on cards); the check keeps the bright one.
                    accent={accentText}
                    pageTemplate={s.hifzPageN}
                    showReference={chosen !== null}
                    status={status}
                    compareWith={chosen !== null && other ? [other] : null}
                    meaning={meaningOf(option)}
                  />
                </Card>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View className="px-5 pt-3 pb-4 border-t border-surface-high dark:border-surface-dark-high items-center">
        <View style={{ width: "100%", maxWidth: 384, gap: 10 }}>
          {chosen !== null ? (
            // Both references are shown now, so the feedback names neither and stays in one direction.
            <Text dir={dir} align="center" variant="body" accessibilityLiveRegion="polite">
              {right ? s.hifzPairRight : s.hifzPairOther}
            </Text>
          ) : null}
          {error ? (
            <Text
              dir={dir}
              align="center"
              className="text-red-700 dark:text-red-400"
              accessibilityRole="alert"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 20 }}
            >
              {error}
            </Text>
          ) : null}
          <Button label={s.hifzSabaqNext} onPress={onNext} disabled={busy || chosen === null} />
        </View>
      </View>
    </View>
  );
}
