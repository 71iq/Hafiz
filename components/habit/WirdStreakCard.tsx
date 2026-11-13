import { Pressable, View } from "react-native";
import { CalendarCheck2, CalendarClock, Moon, PauseCircle, RotateCcw, Sprout, X as XIcon } from "lucide-react-native";
import { Text } from "@/components/ui/Text";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Progress } from "@/components/ui/Progress";
import type { HabitOverview } from "@/lib/habit/queries";
import { isEveOfStreakTier } from "@/lib/habit/milestones";
import { weekdayOf } from "@/lib/habit/dates";
import { formatDays, formatMinutes, formatNumber, formatPages } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";

type Props = {
  overview: HabitOverview;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
  /** Hide the grace note after the user has seen it. */
  graceNoteDismissed: boolean;
  onDismissGraceNote: () => void;
  onOpenBreak: () => void;
};

function formatClockTime(at: Date, language: "en" | "ar"): string {
  return at.toLocaleTimeString(language === "ar" ? "ar" : "en", { hour: "numeric", minute: "2-digit" });
}

export function formatShortDate(localDate: string, language: "en" | "ar"): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(language === "ar" ? "ar" : "en", {
    month: "short",
    day: "numeric",
  });
}

function headlineMessage(overview: HabitOverview, language: "en" | "ar", s: UIStrings): string {
  const { headline } = overview;
  switch (headline.kind) {
    case "done_today":
      return s.habitDoneToday;
    case "excused_today":
      return s.habitExcusedToday;
    case "paused":
      return interpolate(s.habitPausedUntil, { date: formatShortDate(headline.until, language) });
    case "make_up_open":
      return interpolate(s.habitMakeUpOpen, { time: formatClockTime(headline.cutoff, language) });
    case "earn_back":
      return interpolate(s.habitEarnBack, {
        n: formatNumber(headline.earnBack.brokenLength, language),
        days: formatDays(headline.earnBack.brokenLength, language),
      });
    case "fresh_start": {
      const template = weekdayOf(overview.today) === 1 ? s.habitFreshStartMonday : s.habitFreshStart;
      return interpolate(template, {
        n: formatNumber(headline.longest, language),
        days: formatDays(headline.longest, language),
      });
    }
    case "at_risk":
      return s.habitAtRisk;
    case "empty":
      return s.habitBeginToday;
  }
}

function HeadlineIcon({ kind, color }: { kind: HabitOverview["headline"]["kind"]; color: string }) {
  switch (kind) {
    case "paused":
      return <PauseCircle size={15} color={color} />;
    case "excused_today":
      return <Moon size={15} color={color} />;
    case "make_up_open":
      return <CalendarClock size={15} color={color} />;
    case "earn_back":
      return <RotateCcw size={15} color={color} />;
    case "fresh_start":
    case "empty":
      return <Sprout size={15} color={color} />;
    default:
      return <CalendarCheck2 size={15} color={color} />;
  }
}

/**
 * The Home streak card (5.3). The count shows the alive streak even before today's wird (STR-03),
 * with one calm message for today's state, progress toward the minimum, the streak goal, held grace
 * days and a way to mark an excuse or pause. No sad states, no fear.
 */
export function WirdStreakCard({ overview, language, isDark, s, graceNoteDismissed, onDismissGraceNote, onOpenBreak }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const muted = isDark ? "#a3a3a3" : "#8B8178";
  const { streak, headline, settings, goal } = overview;
  const showMinimum =
    headline.kind === "at_risk" ||
    headline.kind === "empty" ||
    headline.kind === "make_up_open" ||
    (headline.kind === "earn_back" && !streak.doneToday);
  const showGraceNote = overview.recentGraceDay !== null && !graceNoteDismissed;
  const tomorrowTier = streak.doneToday && isEveOfStreakTier(streak.length);

  return (
    <View
      className="mt-4 rounded-3xl bg-surface-low dark:bg-surface-dark-low px-4 py-3"
      accessibilityRole="summary"
      accessibilityLabel={`${s.habitStreakLabel}: ${formatDays(streak.length, language)}. ${headlineMessage(overview, language, s)}`}
    >
      <MirroredRow dir={dir} className="items-center justify-between gap-3">
        <MirroredRow dir={dir} className="items-center gap-1.5 flex-shrink-0">
          <HeadlineIcon kind={headline.kind} color={accent} />
          <Text dir={dir} className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 16 }}>
            {formatNumber(streak.length, language)}
          </Text>
          <Text dir={dir} className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}>
            {s.habitStreakLabel}
          </Text>
        </MirroredRow>
        <Text
          dir={dir}
          align="end"
          className="flex-shrink text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 17 }}
        >
          {headlineMessage(overview, language, s)}
        </Text>
      </MirroredRow>

      {headline.kind === "earn_back" ? (
        <MirroredRow dir={dir} className="mt-2.5 items-center gap-2">
          {[0, 1, 2].map((index) => (
            <View
              key={index}
              className={index < headline.earnBack.daysDone ? "bg-primary-accent dark:bg-primary-bright" : "bg-surface-high dark:bg-surface-dark-high"}
              style={{ width: 10, height: 10, borderRadius: 5 }}
            />
          ))}
          <Text dir={dir} variant="caption">
            {interpolate(s.habitEarnBackProgress, { done: formatNumber(headline.earnBack.daysDone, language) })}
          </Text>
        </MirroredRow>
      ) : null}

      {showMinimum ? (
        <View className="mt-3" style={{ gap: 6 }}>
          <Progress value={overview.minimumProgressToday * 100} dir={dir} className="h-1" />
          <Text dir={dir} variant="caption">
            {interpolate(s.habitMinimumHint, {
              pages: formatPages(settings.minimum.pages, language),
              minutes: formatMinutes(settings.minimum.minutes, language),
            })}
          </Text>
        </View>
      ) : null}

      {showGraceNote ? (
        <MirroredRow dir={dir} className="mt-3 items-start gap-2 rounded-2xl bg-surface-high dark:bg-surface-dark-high px-3 py-2">
          <Text dir={dir} className="flex-1 text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18 }}>
            {interpolate(s.habitGraceUsed, { n: formatNumber(overview.graceHeld, language) })}
          </Text>
          <Pressable
            onPress={onDismissGraceNote}
            accessibilityRole="button"
            accessibilityLabel={s.habitDismiss}
            hitSlop={12}
            className="w-6 h-6 items-center justify-center"
          >
            <XIcon size={13} color={muted} />
          </Pressable>
        </MirroredRow>
      ) : null}

      <MirroredRow dir={dir} className="mt-3 items-center justify-between gap-3">
        <MirroredRow dir={dir} className="flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {goal ? (
            <Text dir={dir} variant="caption">
              {goal.reached
                ? interpolate(s.habitGoalReached, { days: formatDays(goal.target, language) })
                : interpolate(s.habitGoalProgress, {
                    done: formatNumber(goal.done, language),
                    target: formatNumber(goal.target, language),
                  })}
            </Text>
          ) : null}
          {overview.graceHeld > 0 ? (
            <Text dir={dir} variant="caption">
              {interpolate(s.habitGraceHeld, { n: formatNumber(overview.graceHeld, language) })}
            </Text>
          ) : null}
          {tomorrowTier ? (
            <Text dir={dir} variant="caption">
              {interpolate(s.habitTomorrowTier, { n: formatNumber(streak.length + 1, language) })}
            </Text>
          ) : null}
        </MirroredRow>
        <Pressable
          onPress={onOpenBreak}
          accessibilityRole="button"
          hitSlop={8}
          className="min-h-[32px] justify-center"
        >
          <Text dir={dir} className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
            {s.habitTakeBreak}
          </Text>
        </Pressable>
      </MirroredRow>
    </View>
  );
}
