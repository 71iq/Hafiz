import { Pressable, Text, View } from "react-native";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import { Rating, State, type Grade } from "@/lib/fsrs/scheduler";
import { DEFAULT_DECK_LEARNING_STEPS, DEFAULT_DECK_RELEARNING_STEPS, type DeckReviewSettings, type StudyCardRow } from "@/lib/fsrs/types";
import { Text as DirectionalText } from "@/components/ui/Text";
import { toArabicNumber } from "@/lib/arabic";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";

const GRADE_BUTTONS: { rating: Grade; bgLight: string; bgDark: string }[] = [
  { rating: Rating.Again, bgLight: "#b91c1c", bgDark: "#dc2626" },
  { rating: Rating.Hard, bgLight: "#b45309", bgDark: "#d97706" },
  { rating: Rating.Good, bgLight: "#15803d", bgDark: "#16a34a" },
  { rating: Rating.Easy, bgLight: "#1d4ed8", bgDark: "#2563eb" },
];

/**
 * The four FSRS grades with their next-review previews. A recitation can pass the rubric's proposal
 * (GRD-02), shown as a ring the user can override with one tap, and the support level's cap
 * (GRD-03): grades above it are disabled. A caption above the row names the suggestion and the cap,
 * so a muted grade always has its reason in view. Without either, the row is the plain flashcard row.
 */
export function GradingButtons({
  onGrade,
  previews,
  isDark,
  s,
  disabled = false,
  proposed = null,
  maxRating = Rating.Easy,
  dir = "ltr",
}: {
  onGrade: (rating: Grade) => void;
  previews: Record<number, string>;
  isDark: boolean;
  s: UIStrings;
  disabled?: boolean;
  proposed?: Grade | null;
  maxRating?: Grade;
  /** Direction of the caption; the grade row itself always runs Again to Easy from the left. */
  dir?: "ltr" | "rtl";
}) {
  const labels: Record<number, string> = {
    [Rating.Again]: s.flashcardsAgain,
    [Rating.Hard]: s.flashcardsHard,
    [Rating.Good]: s.flashcardsGood,
    [Rating.Easy]: s.flashcardsEasy,
  };
  const capped = maxRating < Rating.Easy;
  // Every button gets the same ring space when a suggestion is shown, so no label shifts.
  const ringSpace = proposed !== null ? 3 : 0;
  const ringColor = isDark ? "#FDDC91" : "#2D2D2D";
  const captions = [
    proposed !== null ? `${s.hifzSuggestedGrade}: ${labels[proposed]}` : null,
    capped ? interpolate(s.hifzLevelCap, { grade: labels[maxRating] }) : null,
  ].filter((line): line is string => line !== null);

  return (
    <View className="gap-2">
      {captions.length > 0 ? (
        <View style={{ gap: 2 }}>
          {captions.map((line) => (
            <DirectionalText
              key={line}
              dir={dir}
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 18 }}
              className="text-warm-700 dark:text-neutral-300"
            >
              {line}
            </DirectionalText>
          ))}
        </View>
      ) : null}
      <View className="flex-row" style={{ direction: "ltr", gap: ringSpace > 0 ? 6 : 12 }}>
        {GRADE_BUTTONS.map(({ rating, bgLight, bgDark }) => {
          const isCapped = rating > maxRating;
          const suggested = proposed === rating;
          return (
            <View
              key={rating}
              className="flex-1"
              style={{ padding: ringSpace, borderRadius: 16 + ringSpace, backgroundColor: suggested ? ringColor : "transparent" }}
            >
              <Pressable
                onPress={() => onGrade(rating)}
                disabled={disabled || isCapped}
                accessibilityRole="button"
                accessibilityState={{ disabled: disabled || isCapped, selected: suggested }}
                accessibilityHint={suggested ? s.hifzSuggestedGrade : undefined}
                className={`flex-1 rounded-2xl overflow-hidden ${isCapped ? "bg-surface-high dark:bg-surface-dark-high" : ""}`}
                style={({ pressed }) => ({
                  opacity: disabled && !isCapped ? 0.55 : pressed ? 0.88 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <View
                  className="items-center justify-center px-1.5 py-2.5"
                  style={{ backgroundColor: isCapped ? undefined : isDark ? bgDark : bgLight, minHeight: 58 }}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                    className={isCapped ? "text-warm-700 dark:text-neutral-400" : undefined}
                    style={{ fontFamily: "Manrope_700Bold", fontSize: 14, color: isCapped ? undefined : "#fff" }}
                  >
                    {labels[rating]}
                  </Text>
                  {previews[rating] ? (
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.75}
                      className={isCapped ? "text-warm-700 dark:text-neutral-400" : undefined}
                      style={{
                        color: isCapped ? undefined : "rgba(255,255,255,0.82)",
                        fontFamily: "Manrope_600SemiBold",
                        fontSize: 10,
                        marginTop: 3,
                      }}
                    >
                      {previews[rating]}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
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
