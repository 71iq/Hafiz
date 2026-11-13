import { Pressable, Text, View } from "react-native";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import { Rating, State, type Grade } from "@/lib/fsrs/scheduler";
import { DEFAULT_DECK_LEARNING_STEPS, DEFAULT_DECK_RELEARNING_STEPS, type DeckReviewSettings, type StudyCardRow } from "@/lib/fsrs/types";
import { toArabicNumber } from "@/lib/arabic";
import type { UIStrings } from "@/lib/i18n/strings";

export const GRADE_BUTTONS: { rating: Grade; bgLight: string; bgDark: string }[] = [
  { rating: Rating.Again, bgLight: "#b91c1c", bgDark: "#dc2626" },
  { rating: Rating.Hard, bgLight: "#b45309", bgDark: "#d97706" },
  { rating: Rating.Good, bgLight: "#15803d", bgDark: "#16a34a" },
  { rating: Rating.Easy, bgLight: "#1d4ed8", bgDark: "#2563eb" },
];

/**
 * The four FSRS grades with their next-review previews. A recitation can pass the rubric's proposal
 * (GRD-02), shown as a ring the user can override with one tap, and the support level's cap
 * (GRD-03): grades above it are disabled.
 */
export function GradingButtons({
  onGrade,
  previews,
  isDark,
  s,
  disabled = false,
  proposed = null,
  maxRating = Rating.Easy,
}: {
  onGrade: (rating: Grade) => void;
  previews: Record<number, string>;
  isDark: boolean;
  s: UIStrings;
  disabled?: boolean;
  proposed?: Grade | null;
  maxRating?: Grade;
}) {
  const labels: Record<number, string> = {
    [Rating.Again]: s.flashcardsAgain,
    [Rating.Hard]: s.flashcardsHard,
    [Rating.Good]: s.flashcardsGood,
    [Rating.Easy]: s.flashcardsEasy,
  };

  return (
    <View className="gap-3">
      <View className="flex-row gap-3" style={{ direction: "ltr" }}>
        {GRADE_BUTTONS.map(({ rating, bgLight, bgDark }) => {
          const backgroundColor = isDark ? bgDark : bgLight;
          const capped = rating > maxRating;
          const suggested = proposed === rating;
          return (
            <Pressable
              key={rating}
              onPress={() => onGrade(rating)}
              disabled={disabled || capped}
              accessibilityRole="button"
              accessibilityState={{ disabled: disabled || capped, selected: suggested }}
              accessibilityHint={suggested ? s.hifzSuggestedGrade : undefined}
              className="flex-1 rounded-2xl overflow-hidden"
              style={({ pressed }) => ({
                opacity: capped ? 0.3 : disabled ? 0.55 : pressed ? 0.88 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
                borderWidth: suggested ? 3 : 0,
                borderColor: suggested ? (isDark ? "#FDDC91" : "#785F22") : "transparent",
              })}
            >
              <View
                className="items-center justify-center px-1.5 py-2.5"
                style={{ backgroundColor, minHeight: 58 }}
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
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}


export function getGradeSchedulePreviews(
  row: StudyCardRow,
  settings: DeckReviewSettings | null,
  isRTL: boolean
): Record<number, string> {
  const now = new Date();
  const previews: Record<number, string> = {};

  for (const { rating } of GRADE_BUTTONS) {
    const transition = calculateReviewTransition({
      card: row,
      rating,
      reviewedAt: now,
      reviewPolicy: settings ?? undefined,
    });
    const stepLabel = getLearningStepPreview(transition.updatedCard, settings, isRTL);
    const returnLabel = formatReturnDelay(new Date(transition.updatedCard.due), now, isRTL);
    // A middle dot reads as the Arabic zero (٠) beside Arabic-Indic digits, so Arabic uses its comma.
    previews[rating] = stepLabel ? `${stepLabel}${isRTL ? "، " : " · "}${returnLabel}` : returnLabel;
  }

  return previews;
}

function getLearningStepPreview(
  nextCard: Pick<StudyCardRow, "state" | "learning_steps">,
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
  // Arabic unit letters sit after a no-break space so they do not run into the digits.
  const units = isRTL
    ? { minute: "\u00A0د", hour: "\u00A0س", day: "\u00A0ي", month: "\u00A0ش", year: "\u00A0سنة" }
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
  return isRTL ? toArabicNumber(value) : String(value);
}
