import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Switch } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { HabitBreakSheet } from "@/components/habit/HabitBreakSheet";
import { useSettings } from "@/lib/settings/context";
import { mutedIconColor } from "@/lib/ui/theme-icons";
import type { AppDatabase } from "@/lib/database/types";
import { deleteUserSetting, writeUserSetting } from "@/lib/database/user-settings";
import { STREAK_GOAL_OPTIONS } from "@/lib/habit/milestones";
import { WIRD_MINIMUM_MINUTE_OPTIONS, WIRD_MINIMUM_PAGE_OPTIONS } from "@/lib/habit/minimum";
import { setStreakGoal } from "@/lib/habit/queries";
import { effectiveWeekStart, HABIT_SETTING_KEYS, readHabitSettings, type HabitSettings } from "@/lib/habit/settings";
import { emitHabitChanged, subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import { formatMinutesShort, formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";

type Props = {
  db: AppDatabase;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
  /** Opens the hifz plan and memorized portion setup. */
  onOpenPlan: () => void;
};

/** A short page count for a segmented chip: "½", "1" or "١", under a "Pages" caption. */
function shortPages(pages: number, language: "en" | "ar"): string {
  return pages === 0.5 ? "½" : formatNumber(pages, language);
}

function Row({ label, hint, dir, children }: { label: string; hint?: string; dir: "ltr" | "rtl"; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="text-charcoal dark:text-neutral-200">
        {label}
      </Text>
      {hint ? (
        <Text dir={dir} variant="caption" style={{ lineHeight: 18 }}>
          {hint}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/**
 * Wird settings (spec 7.6): the minimum wird, whether meaning reviews count toward it, the week
 * start for steady weeks (STR-28), the streak goal (STR-19) and the excused days and pause sheet.
 * All are synced settings, so a change follows the account.
 */
export function WirdSettingsSection({ db, language, isDark, s, onOpenPlan }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const mutedIcon = mutedIconColor(useSettings().effectiveTheme);
  const [settings, setSettings] = useState<HabitSettings | null>(null);
  const [breakOpen, setBreakOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await readHabitSettings(db));
    } catch (error) {
      console.warn("[Habit] Settings failed to load:", error);
    }
  }, [db]);

  useEffect(() => {
    load();
    return subscribeHabitChanged(load);
  }, [load]);

  const save = useCallback(
    async (work: () => Promise<void>) => {
      setFailed(false);
      try {
        await work();
        emitHabitChanged();
      } catch (error) {
        console.warn("[Habit] Setting failed to save:", error);
        setFailed(true);
        await load();
      }
    },
    [load],
  );

  if (!settings) return null;
  const weekStart = effectiveWeekStart(settings, language);
  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <Card elevation="low" className="p-5 mb-8">
      <View style={{ gap: 20 }}>
        <Row label={s.habitSettingsMinimum} hint={s.habitSettingsMinimumHint} dir={dir}>
          <Text dir={dir} variant="caption" className="text-warm-600 dark:text-neutral-400" style={{ fontSize: 13 }}>
            {s.habitSettingsPages}
          </Text>
          <ToggleGroup<string>
            dir={dir}
            value={String(settings.minimum.pages)}
            onValueChange={(value) =>
              save(() =>
                writeUserSetting(db, HABIT_SETTING_KEYS.minimum, JSON.stringify({ ...settings.minimum, pages: Number(value) })),
              )
            }
            items={WIRD_MINIMUM_PAGE_OPTIONS.map((pages) => ({ value: String(pages), label: shortPages(pages, language) }))}
            itemClassName="flex-auto px-2"
            accessibilityLabel={s.habitSettingsPages}
          />
          <Text dir={dir} variant="caption" className="text-warm-600 dark:text-neutral-400" style={{ fontSize: 13 }}>
            {s.habitSettingsOr}
          </Text>
          <ToggleGroup<string>
            dir={dir}
            value={String(settings.minimum.minutes)}
            onValueChange={(value) =>
              save(() =>
                writeUserSetting(db, HABIT_SETTING_KEYS.minimum, JSON.stringify({ ...settings.minimum, minutes: Number(value) })),
              )
            }
            items={WIRD_MINIMUM_MINUTE_OPTIONS.map((minutes) => ({
              value: String(minutes),
              label: formatMinutesShort(minutes, language),
            }))}
            itemClassName="flex-auto px-2"
            accessibilityLabel={s.habitSettingsMinutes}
          />
        </Row>

        <MirroredRow dir={dir} className="items-center justify-between gap-3">
          <View className="flex-1" style={{ gap: 4 }}>
            <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="text-charcoal dark:text-neutral-200">
              {s.habitSettingsMeanings}
            </Text>
            <Text dir={dir} variant="caption" style={{ lineHeight: 18 }}>
              {s.habitSettingsMeaningsHint}
            </Text>
          </View>
          <Switch
            value={settings.studyCountsTowardMinimum}
            onValueChange={(value) =>
              save(() =>
                value
                  ? writeUserSetting(db, HABIT_SETTING_KEYS.studyCountsTowardMinimum, "true")
                  : deleteUserSetting(db, HABIT_SETTING_KEYS.studyCountsTowardMinimum),
              )
            }
          />
        </MirroredRow>

        <MirroredRow dir={dir} className="items-center justify-between gap-3">
          <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="flex-1 text-charcoal dark:text-neutral-200">
            {s.habitSettingsZayt}
          </Text>
          <Switch
            value={settings.showZayt}
            onValueChange={(value) =>
              save(() => (value ? deleteUserSetting(db, HABIT_SETTING_KEYS.hideZayt) : writeUserSetting(db, HABIT_SETTING_KEYS.hideZayt, "true")))
            }
          />
        </MirroredRow>

        <MirroredRow dir={dir} className="items-center justify-between gap-3">
          <View className="flex-1">
            <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="text-charcoal dark:text-neutral-200">
              {s.habitSettingsWeakSpots}
            </Text>
            <Text dir={dir} variant="caption">
              {s.habitSettingsWeakSpotsHint}
            </Text>
          </View>
          <Switch
            value={settings.showWeakSpots}
            onValueChange={(value) =>
              save(() =>
                value ? deleteUserSetting(db, HABIT_SETTING_KEYS.hideWeakSpots) : writeUserSetting(db, HABIT_SETTING_KEYS.hideWeakSpots, "true"),
              )
            }
          />
        </MirroredRow>

        <Row label={s.habitSettingsWeekStart} dir={dir}>
          <ToggleGroup<string>
            dir={dir}
            value={String(weekStart)}
            onValueChange={(value) => save(() => writeUserSetting(db, HABIT_SETTING_KEYS.weekStart, value))}
            items={[
              { value: "6", label: s.habitWeekdaySaturday },
              { value: "0", label: s.habitWeekdaySunday },
              { value: "1", label: s.habitWeekdayMonday },
            ]}
          />
        </Row>

        <Row label={s.habitSettingsGoal} dir={dir}>
          <ToggleGroup<string>
            dir={dir}
            value={settings.goal ? String(settings.goal.target) : "none"}
            onValueChange={(value) => save(() => setStreakGoal(db, { target: value === "none" ? null : Number(value) }))}
            items={[
              { value: "none", label: s.habitSettingsGoalNone },
              ...STREAK_GOAL_OPTIONS.map((target) => ({ value: String(target), label: formatNumber(target, language) })),
            ]}
            itemClassName="flex-auto px-2"
          />
        </Row>

        <Pressable
          accessibilityRole="button"
          onPress={onOpenPlan}
          className="min-h-[44px] justify-center rounded-2xl bg-surface-high dark:bg-surface-dark-high px-4"
        >
          <MirroredRow dir={dir} className="items-center justify-between">
            <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="text-charcoal dark:text-neutral-200">
              {s.hifzPlanTitle}
            </Text>
            <Chevron size={16} color={mutedIcon} />
          </MirroredRow>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => setBreakOpen(true)}
          className="min-h-[44px] justify-center rounded-2xl bg-surface-high dark:bg-surface-dark-high px-4"
        >
          <MirroredRow dir={dir} className="items-center justify-between">
            <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="text-charcoal dark:text-neutral-200">
              {s.habitSettingsBreak}
            </Text>
            <Chevron size={16} color={mutedIcon} />
          </MirroredRow>
        </Pressable>

        {failed ? (
          <Text dir={dir} variant="caption" accessibilityLiveRegion="polite" className="text-red-600 dark:text-red-400">
            {s.habitBreakFailed}
          </Text>
        ) : null}
      </View>
      <HabitBreakSheet
        open={breakOpen}
        onClose={() => setBreakOpen(false)}
        db={db}
        pause={settings.pause}
        language={language}
        isDark={isDark}
        s={s}
      />
    </Card>
  );
}
