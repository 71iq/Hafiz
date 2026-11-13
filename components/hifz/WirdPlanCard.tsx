import { Pressable, View } from "react-native";
import { BookOpenCheck, PenLine, Sparkles } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Progress } from "@/components/ui/Progress";
import { Text } from "@/components/ui/Text";
import type { TodayWird } from "@/lib/hifz/pages";
import { formatLines, formatMinutes, formatNumber, formatPages } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";

type Props = {
  wird: TodayWird | null;
  inboxCount: number;
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
export function WirdPlanCard({ wird, inboxCount, language, isDark, s, onStartReview, onStartSabaq, onSetup, onDrill }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const accent = isDark ? "#2dd4bf" : "#0d9488";

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
              <Button size="sm" label={s.hifzSetupAction} onPress={onSetup} />
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
  const showSabaq = wird.newLines > 0 && !wird.daily.backlog;

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

      <View className="mt-4" style={{ gap: 8 }}>
        {wird.todo.length > 0 ? (
          <Button label={wird.done.length > 0 ? s.hifzWirdContinue : s.hifzWirdStart} onPress={onStartReview} />
        ) : null}
        {showSabaq ? <Button variant={wird.todo.length > 0 ? "outline" : "default"} label={s.hifzSabaqStart} onPress={onStartSabaq} /> : null}
      </View>

      {inboxCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={onDrill}
          className="mt-3 min-h-[44px] justify-center rounded-2xl bg-surface-high dark:bg-surface-dark-high px-4"
        >
          <MirroredRow dir={dir} className="items-center justify-between gap-3">
            <MirroredRow dir={dir} className="items-center gap-2">
              <PenLine size={15} color={accent} />
              <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className="text-charcoal dark:text-neutral-200">
                {interpolate(s.hifzInboxCount, { n: formatNumber(inboxCount, language) })}
              </Text>
            </MirroredRow>
            <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: accent }}>{s.hifzInboxAction}</Text>
          </MirroredRow>
        </Pressable>
      ) : null}
    </Card>
  );
}
