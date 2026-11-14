import { Pressable, View } from "react-native";
import { BookOpenCheck, ChevronLeft, ChevronRight, Eye, PenLine, Sparkles } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Progress } from "@/components/ui/Progress";
import { Text } from "@/components/ui/Text";
import { newMemorizationOpen, type TodayWird } from "@/lib/hifz/pages";
import { formatLines, formatMinutes, formatNumber, formatPages } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";

type Props = {
  wird: TodayWird | null;
  inboxCount: number;
  /** SBQ-03: chunks memorized earlier today whose second look is due now. */
  secondLooksDue?: number;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
  onStartReview: () => void;
  onStartSabaq: () => void;
  onSetup: () => void;
  onDrill: () => void;
};

/**
 * Home's wird card (4.3, GOAL-01, GOAL-04): today's pages as recent and manzil counts, new lines,
 * the time left, and a clear "Wird complete" state with nothing more asked. Without a plan it offers
 * setup instead.
 */
export function WirdPlanCard({
  wird,
  inboxCount,
  secondLooksDue = 0,
  language,
  isDark,
  s,
  onStartReview,
  onStartSabaq,
  onSetup,
  onDrill,
}: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  // Teal text under 14 px uses the darker token in light mode.
  const accentText = isDark ? "#2dd4bf" : "#0f766e";

  if (wird === null) {
    return (
      <Card elevation="low" className="mb-6 p-5 rounded-4xl">
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
            <View className="mt-2" style={{ alignSelf: dir === "rtl" ? "flex-end" : "flex-start" }}>
              <Button size="sm" className="h-11" label={s.hifzSetupAction} onPress={onSetup} />
            </View>
          </View>
        </MirroredRow>
      </Card>
    );
  }

  const total = wird.todo.length + wird.done.length;
  const complete = wird.todo.length === 0 && total > 0;
  const sabqi = wird.todo.filter((page) => page.tier === "sabqi").length;
  const manzil = wird.todo.length - sabqi;
  const showSabaq = newMemorizationOpen(wird);
  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <Card elevation="low" className="mb-6 p-5 rounded-4xl">
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
        <Text dir={dir} className="mt-1.5 text-warm-600 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19 }}>
          {s.hifzWirdCompleteLine}
        </Text>
      ) : null}

      {total > 0 ? <Progress value={(wird.done.length / total) * 100} dir={dir} className="mt-3 h-1" /> : null}

      {!complete ? (
        <MirroredRow dir={dir} className="mt-3 flex-wrap gap-x-4 gap-y-1">
          {sabqi > 0 ? (
            <Text dir={dir} variant="caption">
              {interpolate(s.hifzWirdSabqi, { n: formatNumber(sabqi, language) })}
            </Text>
          ) : null}
          {manzil > 0 ? (
            <Text dir={dir} variant="caption">
              {interpolate(s.hifzWirdManzil, { n: formatNumber(manzil, language) })}
            </Text>
          ) : null}
          {showSabaq ? (
            <Text dir={dir} variant="caption">
              {interpolate(s.hifzWirdNew, { lines: formatLines(wird.newLines, language) })}
            </Text>
          ) : null}
        </MirroredRow>
      ) : null}

      {wird.todo.length > 0 ? (
        <Text dir={dir} className="mt-2 text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}>
          {interpolate(s.hifzPagesLeft, {
            pages: formatPages(wird.todo.length, language),
            minutes: formatMinutes(Math.max(1, Math.round(wird.remainingMinutes)), language),
          })}
        </Text>
      ) : total === 0 ? (
        <Text dir={dir} className="mt-2" variant="caption">
          {s.hifzNothingDue}
        </Text>
      ) : null}

      {wird.daily.backlog ? (
        <Text dir={dir} className="mt-2" variant="caption" style={{ lineHeight: 18 }}>
          {s.hifzCatchUpFirst}
        </Text>
      ) : null}

      {complete ? (
        // Once the wird is complete, new lines stay on offer but nothing more is pressed on the user.
        showSabaq ? (
          <MirroredRow dir={dir} className="mt-4">
            <Button
              variant="outline"
              size="sm"
              // Small text and width, but still a 44 px touch target.
              className="h-11 border border-warm-300 dark:border-neutral-700"
              label={s.hifzSabaqStart}
              onPress={onStartSabaq}
            />
          </MirroredRow>
        ) : null
      ) : (
        <View className="mt-4" style={{ gap: 8 }}>
          {wird.todo.length > 0 ? (
            <Button label={wird.done.length > 0 ? s.hifzWirdContinue : s.hifzWirdStart} onPress={onStartReview} />
          ) : null}
          {showSabaq ? (
            <Button
              variant={wird.todo.length > 0 ? "outline" : "default"}
              className={wird.todo.length > 0 ? "border border-warm-300 dark:border-neutral-700" : undefined}
              label={s.hifzSabaqStart}
              onPress={onStartSabaq}
            />
          ) : null}
        </View>
      )}

      {/* SBQ-03: the second look is offered even with a backlog or a complete wird; sabaq shows it first. */}
      {secondLooksDue > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${s.hifzSecondLookReady}, ${s.hifzSecondLookAction}`}
          onPress={onStartSabaq}
          className="mt-3 min-h-[48px] justify-center rounded-2xl bg-primary-accent/10 dark:bg-primary-bright/15 px-4"
        >
          <MirroredRow dir={dir} className="items-center justify-between gap-3">
            <MirroredRow dir={dir} className="flex-shrink items-center gap-2">
              <Eye size={15} color={accent} />
              <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className="flex-shrink text-charcoal dark:text-neutral-200">
                {s.hifzSecondLookReady}
              </Text>
            </MirroredRow>
            <MirroredRow dir={dir} className="items-center gap-1">
              <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 13, color: accentText }}>{s.hifzSecondLookAction}</Text>
              <Chevron size={16} color={accentText} />
            </MirroredRow>
          </MirroredRow>
        </Pressable>
      ) : null}

      {inboxCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={onDrill}
          className="mt-3 min-h-[48px] justify-center rounded-2xl bg-primary-accent/10 dark:bg-primary-bright/15 px-4"
        >
          <MirroredRow dir={dir} className="items-center justify-between gap-3">
            <MirroredRow dir={dir} className="flex-shrink items-center gap-2">
              <PenLine size={15} color={accent} />
              <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className="flex-shrink text-charcoal dark:text-neutral-200">
                {interpolate(s.hifzInboxCount, { n: formatNumber(inboxCount, language) })}
              </Text>
            </MirroredRow>
            <MirroredRow dir={dir} className="items-center gap-1">
              <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 13, color: accentText }}>{s.hifzInboxAction}</Text>
              <Chevron size={16} color={accentText} />
            </MirroredRow>
          </MirroredRow>
        </Pressable>
      ) : null}
    </Card>
  );
}
