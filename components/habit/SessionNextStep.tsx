import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import type { AppDatabase } from "@/lib/database/types";
import { formatCards } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { loadStudyState, studyMoreCount, type StudyState, type StudyStep } from "@/lib/study/resolve";

const OUTLINE_BORDER = "border border-warm-300 dark:border-neutral-700";

/**
 * What the resolver says comes next, read once a session reaches its end screen (`ready`). A result
 * that arrives after the screen moved on is dropped, and a new end screen never shows the last one's.
 */
export function useNextStudyStep(db: AppDatabase, ready: boolean): StudyState | null {
  const [state, setState] = useState<StudyState | null>(null);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    loadStudyState(db).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
      setState(null);
    };
  }, [db, ready]);
  return ready ? state : null;
}

export function studyStepName(step: StudyStep, s: UIStrings): string | null {
  switch (step.kind) {
    case "welcome_back":
      return s.studyStepWelcomeBack;
    case "review":
      return s.studyStepReview;
    case "memorize":
      return s.studyStepMemorize;
    case "cards":
      return s.studyStepCards;
    default:
      return null;
  }
}

/**
 * The buttons at the end of a session (SPEC 3.1). With a step left: Continue, naming the step, and Done
 * for now. With nothing left but cards the budget held back: Study more with the count, and Done.
 * Otherwise Done. Done shows at once and never waits for the resolver; the STR-20 commitment, when it
 * applies, replaces the text of Done or Done for now.
 */
export function SessionNextStep({
  state,
  commitment,
  onContinue,
  onStudyMore,
  onDone,
  language,
  s,
  ownContinue = false,
  className = "w-full max-w-sm",
}: {
  /** From useNextStudyStep; null while it loads. */
  state: StudyState | null;
  /** STR-20's label for this session, or null when Done keeps its own text. */
  commitment: string | null;
  onContinue: (step: Exclude<StudyStep, { kind: "home" }>) => void;
  /** Adds today's extra budget and opens the cards. Buttons stay disabled until it settles. */
  onStudyMore: () => Promise<void>;
  onDone: () => void;
  language: "en" | "ar";
  s: UIStrings;
  /** The screen already offers its own next step (memorize's second look), so Continue is left out. */
  ownContinue?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const step = state?.step;
  const next = step && step.kind !== "home" && !ownContinue ? step : null;
  const more = !next && step?.kind === "home" ? studyMoreCount(state?.queue ?? null) : 0;
  const stepName = next ? studyStepName(next, s) : null;

  const studyMore = () => {
    if (busy) return;
    setBusy(true);
    onStudyMore()
      .catch((error) => console.warn("[Study] Study more failed:", error))
      .finally(() => setBusy(false));
  };

  const doneLabel = commitment ?? (next ? s.studyDoneForNow : s.flashcardsSummaryDone);
  return (
    <View className={className} style={{ gap: 10 }}>
      {state === null && !ownContinue ? (
        // While the resolver loads, Continue's place is held so Done never moves under a finger about
        // to press it. If nothing comes back the slot closes and Done moves up, away from the finger.
        // aria-hidden reaches web screen readers too; the two native props cover older readers.
        <View
          style={{ gap: 6, opacity: 0, pointerEvents: "none" }}
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Button label={s.studyContinue} disabled />
          <Text variant="caption" align="center">
            {" "}
          </Text>
        </View>
      ) : next ? (
        <View style={{ gap: 6 }}>
          <Button label={s.studyContinue} accessibilityHint={stepName ?? undefined} onPress={() => onContinue(next)} />
          {stepName ? (
            <Text variant="caption" align="center" importantForAccessibility="no">
              {interpolate(s.studyNext, { step: stepName })}
            </Text>
          ) : null}
        </View>
      ) : more > 0 ? (
        <View style={{ gap: 6 }}>
          <Button label={s.studyMore} disabled={busy} onPress={studyMore} />
          <Text variant="caption" align="center">
            {interpolate(s.studyMoreAdds, { cards: formatCards(more, language) })}
          </Text>
        </View>
      ) : null}
      <Button
        variant={next || more > 0 ? "outline" : "default"}
        className={next || more > 0 ? OUTLINE_BORDER : undefined}
        label={doneLabel}
        disabled={busy}
        onPress={onDone}
      />
    </View>
  );
}
