import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { CalendarCheck2, Coffee, HeartHandshake, Sparkles, Target } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { ZaytMood, type ZaytMoodName } from "@/components/habit/ZaytMood";
import { ReminderPromptCard, useReminderOffer } from "@/components/notifications/ReminderPromptCard";
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
import { readReminderPrefs } from "@/lib/notifications/settings";
import { prayerLabel } from "@/lib/notifications/templates";
import type { ReminderAnchor } from "@/lib/notifications/types";

const REST_SUGGESTION_MS = 45 * 60_000;

export type SessionHabitInput = Readonly<{
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

export function strongerWirdEvent(
  current: SessionHabitInput["event"],
  next: WirdProgressEvent,
): SessionHabitInput["event"] {
  if (next.kind === "none") return current;
  if (!current || EVENT_RANK[next.kind] >= EVENT_RANK[current.kind]) return next;
  return current;
}

export function showsCommitment(input: SessionHabitInput): boolean {
  return input.event !== null && (input.overview?.streak.length ?? 0) <= 7;
}

export function useCommitmentLabel(db: AppDatabase, s: UIStrings, language: "en" | "ar"): string {
  const [anchor, setAnchor] = useState<ReminderAnchor | null>(null);
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
  if (!anchor) return s.habitCommitTomorrow;
  return anchor.kind === "prayer"
    ? interpolate(s.habitCommitTomorrowAfter, { prayer: prayerLabel(anchor.prayer, language) })
    : interpolate(s.habitCommitTomorrowAt, { time: formatClockMinutesForDisplay(anchor.minutes, language) });
}

type CardKind = "goal" | "rest" | "struggle" | "reminders";

function promptCard(input: SessionHabitInput, reminderOffer: boolean): CardKind | null {
  if (input.durationMs >= REST_SUGGESTION_MS) return "rest";
  if (input.againCount >= 3 && input.total > 0 && input.againCount / input.total >= 0.3) return "struggle";
  if (reminderOffer) return "reminders";
  if (input.event && input.overview && !input.overview.goal && input.overview.streak.length >= 1) return "goal";
  return null;
}

function sessionMood(input: SessionHabitInput, prompt: CardKind | null, milestone: boolean): ZaytMoodName | null {
  if (prompt === "rest") return "tired_low_energy";
  if (prompt === "struggle") return "compassionate_again";
  if (!input.event) return null;
  if (milestone) return "warm_glow_good";
  if (input.event.kind === "earned_back") return "recovering_calm";
  return "quiet_shimmer_easy";
}

function eventLine(input: SessionHabitInput, language: "en" | "ar", s: UIStrings): string {
  const event = input.event!;
  const length = event.length;
  const days = formatDays(length, language);
  if (event.kind === "made_up") return interpolate(s.habitMadeUp, { n: formatNumber(length, language), days });
  if (event.kind === "earned_back") return interpolate(s.habitEarnedBack, { days });
  return s.habitMinimumMet;
}

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
  const prompt = promptCard(input, reminderAnchor !== null);
  const length = input.event?.length ?? 0;
  const milestone = input.event !== null && isStreakMilestone(length);
  const mood = input.overview?.settings.showZayt === false ? null : sessionMood(input, prompt, milestone);

  const chooseGoal = (target: number) => {
    setGoalChoice(target);
    setStreakGoal(db, { target })
      .then(emitHabitChanged)
      .catch((error) => {
        console.warn("[Habit] Could not save the streak goal:", error);
        setGoalChoice(null);
      });
  };

  const zayt = mood ? (
    <View className="flex-shrink-0">
      <ZaytMood mood={mood} height={64} />
    </View>
  ) : null;

  return (
    <View className="w-full max-w-sm" style={{ gap: 10 }}>
      {input.event ? (
        <Card elevation="low" className="px-5 py-4" accessibilityRole="summary">
          <MirroredRow dir={dir} className="items-center gap-3">
            {zayt}
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

      {prompt === "rest" ? (
        <Card elevation="low" className="px-5 py-4">
          <MirroredRow dir={dir} className="items-center gap-2">
            {input.event ? null : zayt}
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
            {input.event ? null : zayt}
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
