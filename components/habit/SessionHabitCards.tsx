import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { CalendarCheck2, Coffee, HeartHandshake, Sparkles, Target } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { ZaytAnimation } from "@/components/habit/ZaytAnimation";
import { ReminderPromptCard, useReminderOffer } from "@/components/notifications/ReminderPromptCard";
import { WidgetOfferCard, useWidgetOffer } from "@/components/habit/WidgetOfferCard";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import type { AppDatabase } from "@/lib/database/types";
import { isStreakMilestone, STREAK_GOAL_OPTIONS } from "@/lib/habit/milestones";
import { setStreakGoal, type HabitOverview, type WirdProgressEvent } from "@/lib/habit/queries";
import { emitHabitChanged } from "@/lib/habit/use-habit-overview";
import { formatDays, formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { formatClockMinutesForDisplay } from "@/lib/notifications/clock";
import { loadReviewSittingAhead } from "@/lib/notifications/review-today";
import { readReminderPrefs } from "@/lib/notifications/settings";
import { prayerLabel } from "@/lib/notifications/templates";
import type { ReminderAnchor } from "@/lib/notifications/types";
import type { ZaytSmallAnimation } from "@/lib/zayt/animations";
import { zaytResultEventId } from "@/lib/zayt/presentation";

/** ETH-05: suggest rest after this much review in one session. */
const REST_SUGGESTION_MS = 45 * 60_000;

export type SessionHabitInput = Readonly<{
  /** The strongest wird event this session produced, or null. */
  event: Exclude<WirdProgressEvent, { kind: "none" }> | null;
  overview: HabitOverview | null;
  againCount: number;
  total: number;
  durationMs: number;
}>;

const EVENT_RANK: Record<Exclude<WirdProgressEvent["kind"], "none">, number> = {
  minimum_met: 1,
  made_up: 2,
  earned_back: 3,
};

/** Keep the most notable event of a session for its summary. */
export function strongerWirdEvent(
  current: SessionHabitInput["event"],
  next: WirdProgressEvent,
): SessionHabitInput["event"] {
  if (next.kind === "none") return current;
  if (!current || EVENT_RANK[next.kind] >= EVENT_RANK[current.kind]) return next;
  return current;
}

/** STR-20: during the first week the session ends with a commitment instead of a plain Done. */
export function showsCommitment(input: SessionHabitInput): boolean {
  return input.event !== null && (input.overview?.streak.length ?? 0) <= 7;
}

/**
 * STR-20: the commitment names when the person comes back, the reminder's anchor (the hifz plan's,
 * or the reminder setting's without a plan): "I'll be back tomorrow after Fajr", or the time for a
 * clock anchor. Read once when the session screen mounts, so it is ready at the end; until then, or
 * when it cannot be read, the commitment has no anchor.
 *
 * With the second sitting on (REMIND-07), review still left and its time later today, it names that
 * sitting instead: "I'll finish my review after Maghrib". That is read again each time `sessionResult`
 * changes, so it reflects the review the session just did; while `sessionResult` is null it is not read.
 */
export function useCommitmentLabel(db: AppDatabase, s: UIStrings, language: "en" | "ar", sessionResult?: unknown): string {
  const [anchor, setAnchor] = useState<ReminderAnchor | null>(null);
  const [review, setReview] = useState<ReminderAnchor | null>(null);
  useEffect(() => {
    let current = true;
    setReview(null);
    if (sessionResult === null) return;
    loadReviewSittingAhead(db)
      .then((ahead) => {
        if (current) setReview(ahead);
      })
      .catch((error: unknown) => console.warn("[Habit] Could not read the second sitting:", error));
    return () => {
      current = false;
    };
  }, [db, sessionResult]);
  useEffect(() => {
    let current = true;
    readReminderPrefs(db)
      .then((prefs) => {
        if (current) setAnchor(prefs.anchor);
      })
      .catch((error: unknown) => console.warn("[Habit] Could not read the reminder anchor:", error));
    return () => {
      current = false;
    };
  }, [db]);
  if (review) {
    return review.kind === "prayer"
      ? interpolate(s.habitCommitReviewAfter, { prayer: prayerLabel(review.prayer, language) })
      : interpolate(s.habitCommitReviewAt, { time: formatClockMinutesForDisplay(review.minutes, language) });
  }
  if (!anchor) return s.habitCommitTomorrow;
  return anchor.kind === "prayer"
    ? interpolate(s.habitCommitTomorrowAfter, { prayer: prayerLabel(anchor.prayer, language) })
    : interpolate(s.habitCommitTomorrowAt, { time: formatClockMinutesForDisplay(anchor.minutes, language) });
}

type CardKind = "goal" | "rest" | "struggle" | "reminders" | "widget";

/** WIDGET-08: the widget offer comes only after a session that kept a streak of at least this many days. */
const WIDGET_OFFER_MIN_STREAK = 3;

/**
 * SES-01: at most one prompt card after the streak card, so a summary never shows more than 3. Rest
 * and encouragement come first because they answer how the session went; the reminder offer (ONB-02)
 * and then the one-time widget offer (WIDGET-08) come before the streak goal.
 */
export function promptCard(input: SessionHabitInput, reminderOffer: boolean, widgetOffer: boolean): CardKind | null {
  if (input.durationMs >= REST_SUGGESTION_MS) return "rest";
  if (input.againCount >= 3 && input.total > 0 && input.againCount / input.total >= 0.3) return "struggle";
  if (reminderOffer) return "reminders";
  if (widgetOffer && input.event && input.event.length >= WIDGET_OFFER_MIN_STREAK) return "widget";
  if (input.event && input.overview && !input.overview.goal && input.overview.streak.length >= 1) return "goal";
  return null;
}

/**
 * 5.11: Zayt's animation at the session end, calm in every case (ZAY-01). The first match wins:
 * rest, a hard session, a streak milestone, a streak earned back or a day made up, then today's
 * minimum. Rest and a hard session put Zayt in their prompt card; the rest put it in the streak card.
 * The reminder offer, the widget offer and the goal never hold Zayt, so the choice does not depend on them.
 */
export function sessionZayt(input: SessionHabitInput): Readonly<{ animation: ZaytSmallAnimation; card: "streak" | "rest" | "struggle" }> | null {
  const prompt = promptCard(input, false, false);
  if (prompt === "rest") return { animation: "A11", card: "rest" };
  if (prompt === "struggle") return { animation: "A10", card: "struggle" };
  if (!input.event) return null;
  if (isStreakMilestone(input.event.length)) return { animation: "A07", card: "streak" };
  if (input.event.kind === "earned_back" || input.event.kind === "made_up") return { animation: "A08", card: "streak" };
  return { animation: "A06", card: "streak" };
}

function eventLine(input: SessionHabitInput, language: "en" | "ar", s: UIStrings): string {
  const event = input.event!;
  const length = event.length;
  const days = formatDays(length, language);
  if (event.kind === "made_up") return interpolate(s.habitMadeUp, { n: formatNumber(length, language), days });
  if (event.kind === "earned_back") return interpolate(s.habitEarnedBack, { days });
  return s.habitMinimumMet;
}

/**
 * Session-end habit cards (5.10): the streak card when this session met today's minimum, made up
 * yesterday or earned a streak back, then one prompt: a streak goal, a rest suggestion, or a word of
 * encouragement after a hard session. Quiet, with no point totals (STR-23, ETH-05, FB-04).
 */
export function SessionHabitCards({
  input,
  db,
  language,
  isDark,
  s,
}: {
  input: SessionHabitInput;
  db: AppDatabase;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
}) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const [goalChoice, setGoalChoice] = useState<number | null>(null);
  const [goalDismissed, setGoalDismissed] = useState(false);
  const reminderAnchor = useReminderOffer(db);
  const widgetOffer = useWidgetOffer(db);
  const prompt = promptCard(input, reminderAnchor !== null, widgetOffer);
  const length = input.event?.length ?? 0;
  const milestone = input.event !== null && isStreakMilestone(length);
  // ZAY-02: no Zayt until the setting is known to be on.
  const placement = input.overview?.settings.showZayt === true ? sessionZayt(input) : null;

  const chooseGoal = (target: number) => {
    setGoalChoice(target);
    setStreakGoal(db, { target })
      .then(emitHabitChanged)
      .catch((error) => {
        console.warn("[Habit] Could not save the streak goal:", error);
        setGoalChoice(null);
      });
  };

  // Zayt sits inside the card whose text it accompanies, beside that text, never between cards.
  const zayt = placement ? (
    <View className="flex-shrink-0">
      <ZaytAnimation tier="S" animation={placement.animation} height={64} presentationId={zaytResultEventId(input)} />
    </View>
  ) : null;

  return (
    <View className="w-full max-w-sm" style={{ gap: 10 }}>
      {input.event ? (
        <Card elevation="low" className="px-5 py-4" accessibilityRole="summary">
          <MirroredRow dir={dir} className="items-center gap-3">
            {placement?.card === "streak" ? zayt : null}
            <View className="flex-1">
              <MirroredRow dir={dir} className="items-center gap-2">
                {milestone ? <Sparkles size={16} color={accent} /> : <CalendarCheck2 size={16} color={accent} />}
                <Text dir={dir} className="flex-shrink text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }}>
                  {milestone
                    ? interpolate(s.habitMilestoneTitle, { days: formatDays(length, language) })
                    : interpolate(s.habitStreakDay, { n: formatNumber(length, language) })}
                </Text>
              </MirroredRow>
              <Text dir={dir} className="mt-1.5 text-warm-600 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19 }}>
                {eventLine(input, language, s)}
              </Text>
            </View>
          </MirroredRow>
          {milestone ? (
            <Text dir={dir} variant="caption" className="mt-1.5">
              {length >= 30 ? s.habitMilestoneLine : s.habitMilestoneSmall}
            </Text>
          ) : null}
          {input.overview?.goal && !input.overview.goal.reached ? (
            <Text dir={dir} variant="caption" className="mt-1.5">
              {interpolate(s.habitGoalProgress, {
                done: formatNumber(input.overview.goal.done, language),
                target: formatNumber(input.overview.goal.target, language),
              })}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {prompt === "goal" && !goalDismissed ? (
        <Card elevation="low" className="px-5 py-4">
          <MirroredRow dir={dir} className="items-center gap-2">
            <Target size={16} color={accent} />
            <Text dir={dir} className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }}>
              {goalChoice ? interpolate(s.habitGoalSet, { days: formatDays(goalChoice, language) }) : s.habitGoalOfferTitle}
            </Text>
          </MirroredRow>
          {goalChoice === null ? (
            <>
              <Text dir={dir} variant="caption" className="mt-1.5" style={{ lineHeight: 18 }}>
                {s.habitGoalOfferBody}
              </Text>
              {/* The goals share one row; Not now has its own line instead of wrapping alone. */}
              <MirroredRow dir={dir} className="mt-3 flex-wrap gap-2">
                {STREAK_GOAL_OPTIONS.map((target) => (
                  <Pressable
                    key={target}
                    accessibilityRole="button"
                    onPress={() => chooseGoal(target)}
                    style={{ flexGrow: 1 }}
                    className="min-h-[44px] items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15 px-3"
                  >
                    <Text className="text-primary-muted dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                      {formatDays(target, language)}
                    </Text>
                  </Pressable>
                ))}
              </MirroredRow>
              <MirroredRow dir={dir}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setGoalDismissed(true)}
                  className="mt-1 min-h-[44px] justify-center px-1"
                >
                  <Text className="text-warm-600 dark:text-neutral-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                    {s.habitGoalNotNow}
                  </Text>
                </Pressable>
              </MirroredRow>
            </>
          ) : null}
        </Card>
      ) : null}

      {prompt === "reminders" && reminderAnchor ? (
        <ReminderPromptCard db={db} anchor={reminderAnchor} language={language} isDark={isDark} s={s} />
      ) : null}

      {prompt === "widget" ? <WidgetOfferCard db={db} language={language} isDark={isDark} s={s} /> : null}

      {prompt === "rest" ? (
        <Card elevation="low" className="px-5 py-4">
          <MirroredRow dir={dir} className="items-center gap-2">
            {placement?.card === "rest" ? zayt : null}
            <Coffee size={16} color={accent} />
            <Text dir={dir} className="flex-1 text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19 }}>
              {s.habitRestSuggestion}
            </Text>
          </MirroredRow>
        </Card>
      ) : null}

      {prompt === "struggle" ? (
        <Card elevation="low" className="px-5 py-4">
          <MirroredRow dir={dir} className="items-center gap-2">
            {placement?.card === "struggle" ? zayt : null}
            <HeartHandshake size={16} color={accent} />
            <Text dir={dir} className="flex-1 text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19 }}>
              {s.habitStruggleReward}
            </Text>
          </MirroredRow>
        </Card>
      ) : null}
    </View>
  );
}
