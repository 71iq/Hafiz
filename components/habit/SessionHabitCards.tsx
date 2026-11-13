import { useState } from "react";
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

type CardKind = "goal" | "rest" | "struggle" | "reminders";

/**
 * SES-01: at most one prompt card after the streak card, so a summary never shows more than 3. Rest
 * and encouragement come first because they answer how the session went; the reminder offer (ONB-02)
 * comes before the streak goal.
 */
function promptCard(input: SessionHabitInput, reminderOffer: boolean): CardKind | null {
  if (input.durationMs >= REST_SUGGESTION_MS) return "rest";
  if (input.againCount >= 3 && input.total > 0 && input.againCount / input.total >= 0.3) return "struggle";
  if (reminderOffer) return "reminders";
  if (input.event && input.overview && !input.overview.goal && input.overview.streak.length >= 1) return "goal";
  return null;
}

/** 5.11: Zayt's mood for the session end, calm in every case (ZAY-01). */
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

  return (
    <View className="w-full max-w-sm" style={{ gap: 10 }}>
      {mood ? (
        <View className="items-center">
          <ZaytMood mood={mood} />
        </View>
      ) : null}
      {input.event ? (
        <Card elevation="low" className="px-5 py-4" accessibilityRole="summary">
          <MirroredRow dir={dir} className="items-center gap-2">
            {milestone ? <Sparkles size={16} color={accent} /> : <CalendarCheck2 size={16} color={accent} />}
            <Text dir={dir} className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }}>
              {milestone
                ? interpolate(s.habitMilestoneTitle, { days: formatDays(length, language) })
                : interpolate(s.habitStreakDay, { n: formatNumber(length, language) })}
            </Text>
          </MirroredRow>
          <Text dir={dir} className="mt-1.5 text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19 }}>
            {eventLine(input, language, s)}
          </Text>
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
                    className="min-h-[40px] justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15 px-3.5"
                  >
                    <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                      {formatDays(target, language)}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setGoalDismissed(true)}
                  className="min-h-[40px] justify-center rounded-full px-3.5"
                >
                  <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
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
          <MirroredRow dir={dir} className="items-start gap-2">
            <Coffee size={16} color={accent} />
            <Text dir={dir} className="flex-1 text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19 }}>
              {s.habitRestSuggestion}
            </Text>
          </MirroredRow>
        </Card>
      ) : null}

      {prompt === "struggle" ? (
        <Card elevation="low" className="px-5 py-4">
          <MirroredRow dir={dir} className="items-start gap-2">
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
