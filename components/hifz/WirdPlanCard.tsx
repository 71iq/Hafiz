import { Pressable, View } from "react-native";
import { BookOpenCheck, CheckCircle2, ChevronLeft, ChevronRight, Circle, Eye, Sparkles } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Progress } from "@/components/ui/Progress";
import { Text } from "@/components/ui/Text";
import { newMemorizationOpen, type TodayWird } from "@/lib/hifz/pages";
import { formatAyahs, formatCards, formatLines, formatMinutes, formatNumber, formatPages } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { formatClockMinutesForDisplay } from "@/lib/notifications/clock";
import { useSettings } from "@/lib/settings/context";
import type { TodayPart } from "@/lib/study/today";
import { mutedIconColor } from "@/lib/ui/theme-icons";

type Props = {
  wird: TodayWird | null;
  /** Today's parts in order (SPEC 3.3), or null while the daily queue loads. */
  parts: readonly TodayPart[] | null;
  /** A daily deck's name, for its part. */
  deckTitle: (deckId: string) => string;
  /** SBQ-03: chunks memorized earlier today whose second look is due now. */
  secondLooksDue?: number;
  /** When the next of today's second looks opens, while none is due yet. */
  nextLookAt?: Date | null;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
  /** Opens memorization: the second look, or more lines once today's are done. */
  onStartMemorize: () => void;
};

/**
 * Home's Today card (SPEC 3.3, GOAL-01, GOAL-04): today's parts in order, each with what is left or a
 * check once finished, the pages left and the time they take, and a clear "Wird complete" once the
 * pages are reviewed. The Study button above it starts the work, so the card has no Start of its own.
 * Without a plan it says what a plan is; the Set up button sits where the Study button would be.
 */
export function WirdPlanCard({ wird, parts, deckTitle, secondLooksDue = 0, nextLookAt = null, language, isDark, s, onStartMemorize }: Props) {
  const { effectiveTheme } = useSettings();
  const dir = language === "ar" ? "rtl" : "ltr";
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  // Teal text under 14 px uses the darker token in light mode.
  const accentText = isDark ? "#2dd4bf" : "#0f766e";
  const muted = mutedIconColor(effectiveTheme);

  if (wird === null) {
    return (
      <Card elevation="low" className="mb-6 p-5 rounded-4xl" style={{ direction: "ltr" }}>
        <MirroredRow dir={dir} className="items-start gap-3">
          <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/15 items-center justify-center">
            <Sparkles size={18} color={accent} />
          </View>
          <View className="flex-1" style={{ gap: 4 }}>
            <Text dir={dir} style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }} className="text-charcoal dark:text-neutral-100">
              {s.hifzSetupTitle}
            </Text>
            <Text dir={dir} variant="caption" style={{ lineHeight: 18 }}>
              {s.hifzSetupBody}
            </Text>
          </View>
        </MirroredRow>
      </Card>
    );
  }

  // A page on a due learning step is in both lists; total counts each page once.
  const total = wird.total;
  const complete = wird.todo.length === 0 && total > 0;
  const recent = wird.todo.filter((page) => page.tier === "recent").length;
  const longTerm = wird.todo.length - recent;
  const showMemorize = newMemorizationOpen(wird);
  const secondLookLabel =
    secondLooksDue > 1 ? interpolate(s.hifzSecondLooksReady, { n: formatNumber(secondLooksDue, language) }) : s.hifzSecondLookReady;
  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;

  const partLabel = (part: TodayPart) =>
    part.kind === "review" ? s.studyStepReview : part.kind === "memorize" ? s.studyPartNewLines : deckTitle(part.deckId);
  const partCount = (part: TodayPart) =>
    part.kind === "review"
      ? part.unit === "ayahs"
        ? formatAyahs(part.count, language)
        : formatNumber(part.count, language)
      : part.kind === "memorize"
        ? formatLines(part.count, language)
        : formatCards(part.count, language);

  // Hand-mirrored alignSelf below pins LTR coordinates; under the RTL tab root it flipped twice.
  return (
    <Card elevation="low" className="mb-6 p-5 rounded-4xl" style={{ direction: "ltr" }}>
      <MirroredRow dir={dir} className="items-center justify-between gap-3">
        <MirroredRow dir={dir} className="items-center gap-2">
          <BookOpenCheck size={18} color={accent} />
          <Text dir={dir} style={{ fontFamily: "Manrope_700Bold", fontSize: 16 }} className="text-charcoal dark:text-neutral-100">
            {complete ? s.hifzWirdComplete : s.hifzWirdTitle}
          </Text>
        </MirroredRow>
        {total > 0 ? (
          <Text dir={dir} variant="caption">
            {`${formatNumber(wird.done.length, language)} / ${formatNumber(total, language)}`}
          </Text>
        ) : null}
      </MirroredRow>

      {complete ? (
        <Text dir={dir} className="mt-1.5 text-warm-700 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19 }}>
          {s.hifzWirdCompleteLine}
        </Text>
      ) : null}

      {total > 0 ? <Progress value={(wird.done.length / total) * 100} dir={dir} className="mt-3 h-1" /> : null}

      {!complete && recent + longTerm > 0 ? (
        <MirroredRow dir={dir} className="mt-3 flex-wrap gap-x-4 gap-y-1">
          {recent > 0 ? (
            <Text dir={dir} variant="caption">
              {interpolate(s.hifzWirdRecent, { n: formatNumber(recent, language) })}
            </Text>
          ) : null}
          {longTerm > 0 ? (
            <Text dir={dir} variant="caption">
              {interpolate(s.hifzWirdLongTerm, { n: formatNumber(longTerm, language) })}
            </Text>
          ) : null}
        </MirroredRow>
      ) : null}

      {parts && parts.length > 0 ? (
        <View className="mt-3" style={{ gap: 6 }}>
          {parts.map((part) => {
            const label = partLabel(part);
            const count = part.done ? null : partCount(part);
            return (
              <MirroredRow
                key={part.kind === "deck" ? part.deckId : part.kind}
                dir={dir}
                className="items-center gap-2"
                accessible
                accessibilityLabel={count ? `${label}, ${count}` : `${label}, ${s.flashcardsSummaryDone}`}
              >
                {part.done ? <CheckCircle2 size={15} color={accent} /> : <Circle size={15} color={muted} />}
                <Text
                  dir={dir}
                  className={`flex-1 ${part.done ? "text-warm-500 dark:text-neutral-400" : "text-charcoal dark:text-neutral-200"}`}
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
                >
                  {label}
                </Text>
                {count ? (
                  <Text dir={dir} className="text-warm-600 dark:text-neutral-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                    {count}
                  </Text>
                ) : null}
              </MirroredRow>
            );
          })}
        </View>
      ) : null}

      {wird.todo.length > 0 ? (
        <Text dir={dir} className="mt-3 text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}>
          {interpolate(s.hifzPagesLeft, {
            pages: formatPages(wird.todo.length, language),
            minutes: formatMinutes(Math.max(1, Math.round(wird.remainingMinutes)), language),
          })}
        </Text>
      ) : total === 0 && wird.plan.unit !== "ayah" ? (
        <Text dir={dir} className="mt-3" variant="caption">
          {s.hifzNothingDue}
        </Text>
      ) : null}

      {wird.daily.backlog ? (
        <Text dir={dir} className="mt-2" variant="caption" style={{ lineHeight: 18 }}>
          {s.hifzCatchUpFirst}
        </Text>
      ) : null}

      {/* Once today's lines are done, more stay on offer, but nothing more is pressed on the user. */}
      {showMemorize && wird.memorizeDoneToday ? (
        <MirroredRow dir={dir} className="mt-4">
          <Button
            variant="outline"
            size="sm"
            // Small text and width, but still a 44 px touch target.
            className="h-11 border border-warm-300 dark:border-neutral-700"
            label={s.hifzMemorizeMore}
            onPress={onStartMemorize}
          />
        </MirroredRow>
      ) : null}

      {/* SBQ-03: the second look is offered even with a backlog or a complete wird; the memorize screen shows it first. */}
      {secondLooksDue > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${secondLookLabel}, ${s.hifzSecondLookAction}`}
          onPress={onStartMemorize}
          // Capped on wide layouts so "Start" stays near its label.
          className="mt-3 w-full max-w-md min-h-[48px] justify-center rounded-2xl bg-primary-accent/10 dark:bg-primary-bright/15 px-4 py-2.5"
          style={{ alignSelf: dir === "rtl" ? "flex-end" : "flex-start" }}
        >
          <MirroredRow dir={dir} className="items-center justify-between gap-3">
            <MirroredRow dir={dir} className="flex-shrink items-center gap-2">
              <Eye size={15} color={accent} />
              <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className="flex-shrink text-charcoal dark:text-neutral-200">
                {secondLookLabel}
              </Text>
            </MirroredRow>
            <MirroredRow dir={dir} className="items-center gap-1">
              <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 13, color: accentText }}>{s.hifzSecondLookAction}</Text>
              <Chevron size={16} color={accentText} />
            </MirroredRow>
          </MirroredRow>
        </Pressable>
      ) : null}

      {/* Between the lesson and the look, Home says when it opens. */}
      {secondLooksDue === 0 && nextLookAt ? (
        <MirroredRow dir={dir} className="mt-3 items-center gap-2">
          <Eye size={14} color={muted} />
          <Text dir={dir} className="text-warm-700 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}>
            {interpolate(s.hifzSecondLookLater, {
              time: formatClockMinutesForDisplay(nextLookAt.getHours() * 60 + nextLookAt.getMinutes(), language),
            })}
          </Text>
        </MirroredRow>
      ) : null}
    </Card>
  );
}
