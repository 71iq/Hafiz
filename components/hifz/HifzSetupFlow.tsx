import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, View } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Switch } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import { MemorizedPortionPicker, type SurahChoice } from "@/components/hifz/MemorizedPortionPicker";
import type { AppDatabase } from "@/lib/database/types";
import { applyHifzSetup } from "@/lib/hifz/setup";
import { Card } from "@/components/ui/Card";
import { CALCULATION_METHOD_LABEL_KEYS, PrayerTimesSetup } from "@/components/notifications/PrayerTimesSetup";
import {
  applyPreset,
  DEFAULT_HIFZ_PLAN,
  presetOf,
  PRAYERS,
  SABAQ_REPETITION_BOUNDS,
  SABAQ_REPETITION_PRESETS,
  sabaqRepetitionPresetOf,
  type Anchor,
  type HifzPlan,
  type PlanPreset,
  type Prayer,
  type SabaqRepetitionCount,
  type SabaqRepetitionPreset,
  type SabaqRepetitions,
} from "@/lib/hifz/plan";
import { formatMinutes, formatNumber, formatPages } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { readPrayerLocation } from "@/lib/prayer/settings";
import { useSettings } from "@/lib/settings/context";
import { mutedIconColor } from "@/lib/ui/theme-icons";
import type { PrayerLocation } from "@/lib/prayer/times";

type Goal = "memorize" | "keep" | "both";
type Step = "goal" | "memorized" | "tracks" | "pace" | "when";

const STEPS: readonly Step[] = ["goal", "memorized", "tracks", "pace", "when"];
const PRESETS: readonly PlanPreset[] = ["part_time_beginner", "part_time_adult", "full_time", "maintenance", "short_surahs"];

function presetLabel(preset: PlanPreset, s: UIStrings): string {
  switch (preset) {
    case "part_time_beginner":
      return s.hifzPresetBeginner;
    case "part_time_adult":
      return s.hifzPresetAdult;
    case "full_time":
      return s.hifzPresetFullTime;
    case "maintenance":
      return s.hifzPresetMaintenance;
    case "short_surahs":
      return s.hifzPresetShort;
  }
}

function prayerLabel(prayer: Prayer, s: UIStrings): string {
  switch (prayer) {
    case "fajr":
      return s.hifzPrayerFajr;
    case "dhuhr":
      return s.hifzPrayerDhuhr;
    case "asr":
      return s.hifzPrayerAsr;
    case "maghrib":
      return s.hifzPrayerMaghrib;
    case "isha":
      return s.hifzPrayerIsha;
  }
}

/** The chosen time in words for the implementation intention (ANC-01): "After Fajr", "In the morning". */
function anchorPhrase(anchor: Anchor, language: "en" | "ar", s: UIStrings): string {
  if (anchor.kind === "prayer") return interpolate(s.hifzAfterPrayer, { prayer: prayerLabel(anchor.prayer, s) });
  if (anchor.minutes === 8 * 60) return s.hifzWhenInMorning;
  if (anchor.minutes === 20 * 60) return s.hifzWhenInEvening;
  const at = new Date(2026, 0, 1, Math.floor(anchor.minutes / 60), anchor.minutes % 60);
  const time = at.toLocaleTimeString(language === "ar" ? "ar-u-nu-arab" : "en", { hour: "numeric", minute: "2-digit" });
  return interpolate(s.hifzWhenAtTime, { time });
}

type StepEntry = Readonly<{
  plan: HifzPlan;
  preset: PlanPreset | null;
  surahs: Set<number>;
  juz: Set<number>;
  /** The unit chosen on the tracks step, so skipping that step does not leave its choice behind. */
  chosenUnit: HifzPlan["unit"];
}>;

function OptionCard({ title, hint, selected, onPress }: { title: string; hint?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      className={`min-h-[56px] justify-center rounded-3xl px-4 py-3 ${selected ? "bg-primary-accent/10 dark:bg-primary-bright/15 border border-primary-accent dark:border-primary-bright" : "bg-surface-low dark:bg-surface-dark-low border border-transparent"}`}
    >
      <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }} className={selected ? "text-primary-muted dark:text-primary-bright" : "text-charcoal dark:text-neutral-100"}>
        {title}
      </Text>
      {hint ? (
        // Readable on the selected teal tint in both themes; the shared caption tone is lighter.
        <Text variant="caption" className="mt-0.5 text-warm-700 dark:text-neutral-400" style={{ lineHeight: 18 }}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A count with 44 px fewer and more buttons; the pair mirrors in RTL like the reading steppers. */
function CountStepper({
  label,
  value,
  count,
  onChange,
  language,
  isDark,
  s,
}: {
  label: string;
  value: number;
  count: SabaqRepetitionCount;
  onChange: (value: number) => void;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
}) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const { min, max } = SABAQ_REPETITION_BOUNDS[count];
  const { effectiveTheme } = useSettings();
  const iconColor = mutedIconColor(effectiveTheme);
  const step = (delta: -1 | 1, disabled: boolean, name: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={interpolate(name, { count: label })}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onChange(value + delta)}
      className="h-11 w-11 items-center justify-center rounded-full"
      style={({ pressed }) => ({ opacity: disabled ? 0.35 : pressed ? 0.68 : 1 })}
    >
      {delta < 0 ? <Minus size={17} color={iconColor} /> : <Plus size={17} color={iconColor} />}
    </Pressable>
  );
  return (
    <MirroredRow dir={dir} className="min-h-[44px] items-center justify-between gap-3">
      <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="flex-1 text-charcoal dark:text-neutral-200">
        {label}
      </Text>
      <MirroredRow dir={dir} className="items-center rounded-full bg-surface-high dark:bg-surface-dark-high p-1">
        {step(-1, value <= min, s.hifzRepsFewer)}
        <View
          className="min-w-12 items-center justify-center px-2"
          accessible
          accessibilityLabel={`${label}: ${formatNumber(value, language)}`}
          accessibilityLiveRegion="polite"
        >
          <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 14 }} className="text-charcoal dark:text-neutral-100">
            {formatNumber(value, language)}
          </Text>
          {/* A web live region reads its text, not its label, so the label travels with the value there. */}
          <Text style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }}>{`${label}: ${formatNumber(value, language)}`}</Text>
        </View>
        {step(1, value >= max, s.hifzRepsMore)}
      </MirroredRow>
    </MirroredRow>
  );
}

/**
 * SBQ-01: how many times sabaq has the user listen, read while looking and recite cleanly. Two
 * presets or custom counts; custom stays chosen once opened, even when its counts match a preset.
 */
function SabaqRepetitionsSection({
  value,
  onChange,
  language,
  isDark,
  s,
}: {
  value: SabaqRepetitions;
  onChange: (value: SabaqRepetitions) => void;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
}) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const [customOpen, setCustomOpen] = useState(false);
  const choice: SabaqRepetitionPreset | "custom" = customOpen ? "custom" : (sabaqRepetitionPresetOf(value) ?? "custom");
  const choosePreset = (preset: SabaqRepetitionPreset) => {
    setCustomOpen(false);
    onChange({ ...SABAQ_REPETITION_PRESETS[preset] });
  };
  const counts: readonly { count: SabaqRepetitionCount; label: string }[] = [
    { count: "listen", label: s.hifzRepsListen },
    { count: "looking", label: s.hifzRepsLooking },
    { count: "cleanInARow", label: s.hifzRepsClean },
  ];
  return (
    <View className="mt-4" style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text dir={dir} variant="title-sm">
          {s.hifzRepsTitle}
        </Text>
        <Text dir={dir} variant="caption" className="text-warm-700 dark:text-neutral-400" style={{ lineHeight: 18 }}>
          {s.hifzRepsHint}
        </Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={s.hifzRepsTitle} style={{ gap: 10 }}>
        <OptionCard
          title={s.hifzRepsLookingThenMemory}
          hint={s.hifzRepsLookingThenMemoryHint}
          selected={choice === "looking_then_memory"}
          onPress={() => choosePreset("looking_then_memory")}
        />
        <OptionCard
          title={s.hifzRepsTwentyTimes}
          hint={s.hifzRepsTwentyTimesHint}
          selected={choice === "twenty_times"}
          onPress={() => choosePreset("twenty_times")}
        />
        <OptionCard title={s.hifzRepsCustom} hint={s.hifzRepsCustomHint} selected={choice === "custom"} onPress={() => setCustomOpen(true)} />
      </View>
      {choice === "custom" ? (
        <View className="rounded-3xl bg-surface-low dark:bg-surface-dark-low px-4 py-2" style={{ gap: 8 }}>
          {counts.map(({ count, label }) => (
            <CountStepper
              key={count}
              label={label}
              value={value[count]}
              count={count}
              onChange={(next) => onChange({ ...value, [count]: next })}
              language={language}
              isDark={isDark}
              s={s}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** What a saved setup changed, for the screen that shows the saved notice. */
export type SetupSaved = Readonly<{
  plan: HifzPlan;
  declaredPages: number;
  /** Pages made from reviewed ayah cards by a switch to page review (7.6). */
  migratedPages: number;
  /** No plan was saved before: the wird starts today. */
  firstPlan: boolean;
  /** The recitation unit changed between page and ayah review. */
  unitSwitched: boolean;
  /** The recitation unit changed at all, page and half page included; it applies at once. */
  unitChanged: boolean;
  repetitionsChanged: boolean;
}>;

/** What the saved notice says after editing a plan: only what this save changes, and when (7.6). */
export function setupSavedNotice(saved: SetupSaved, s: UIStrings, language: "en" | "ar"): string {
  if (saved.firstPlan) return s.hifzPlanSavedFirst;
  if (saved.unitSwitched && saved.plan.unit === "ayah") return s.hifzPlanSavedToAyat;
  if (saved.unitSwitched && saved.migratedPages > 0) {
    return interpolate(s.hifzPlanSavedToPages, { pages: formatPages(saved.migratedPages, language) });
  }
  // A unit change applies to the next review at once, not from tomorrow.
  if (saved.unitChanged) return saved.plan.unit === "half" ? s.hifzPlanSavedUnitHalf : s.hifzPlanSavedUnitPage;
  return saved.repetitionsChanged && saved.plan.method !== "review_only" ? s.hifzPlanSaved : s.hifzPlanSavedReview;
}

type Props = {
  db: AppDatabase;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
  /** The plan to start from, when editing; null starts from the defaults. */
  initialPlan: HifzPlan | null;
  onDone: (result: SetupSaved) => void;
  onCancel?: () => void;
};

/**
 * Hifz setup (5.1 steps 2 to 6): goal, memorized portion, review tracks (UNIT-02), pace (4.3.2)
 * and the time anchor (ANC-01). Every step can be skipped with sensible defaults (ONB-06).
 */
export function HifzSetupFlow({ db, language, isDark, s, initialPlan, onDone, onCancel }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const [stepIndex, setStepIndex] = useState(0);
  // Editing starts from the saved plan as it is: its goal, and its preset only while it still matches.
  const [goal, setGoal] = useState<Goal>(initialPlan?.method === "review_only" ? "keep" : "both");
  const [plan, setPlan] = useState<HifzPlan>(initialPlan ?? applyPreset(DEFAULT_HIFZ_PLAN, "part_time_adult"));
  const [preset, setPreset] = useState<PlanPreset | null>(initialPlan ? presetOf(initialPlan) : "part_time_adult");
  // The unit chosen on the tracks step. "Short surahs" reviews ayah by ayah; another pace brings this back.
  const [chosenUnit, setChosenUnit] = useState<HifzPlan["unit"]>(
    initialPlan && presetOf(initialPlan) !== "short_surahs" ? initialPlan.unit : DEFAULT_HIFZ_PLAN.unit,
  );
  const [surahs, setSurahs] = useState<SurahChoice[]>([]);
  const [selectedSurahs, setSelectedSurahs] = useState<Set<number>>(new Set());
  const [selectedJuz, setSelectedJuz] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prayerTimesOpen, setPrayerTimesOpen] = useState(false);
  const [prayerLocation, setPrayerLocation] = useState<PrayerLocation | null>(null);
  const step = STEPS[stepIndex];
  // What the current step showed when it opened, so "Not now" can leave it untouched.
  const stepEntry = useRef<StepEntry | null>(null);
  const goToStep = (index: number) => {
    stepEntry.current = { plan, preset, surahs: selectedSurahs, juz: selectedJuz, chosenUnit };
    setStepIndex(index);
  };

  useEffect(() => {
    db.getAllAsync<SurahChoice>("SELECT number, name_arabic, name_english, ayah_count FROM surahs ORDER BY number")
      .then(setSurahs)
      .catch((loadError) => console.warn("[HifzSetup] Surahs failed to load:", loadError));
  }, [db]);

  // The optional prayer-times row says whether a location is already saved on this device.
  useEffect(() => {
    if (step !== "when") return;
    let active = true;
    readPrayerLocation(db)
      .then((saved) => {
        if (active) setPrayerLocation(saved);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [db, step]);

  const back = useCallback(() => {
    if (stepIndex === 0) {
      onCancel?.();
      return;
    }
    stepEntry.current = { plan, preset, surahs: selectedSurahs, juz: selectedJuz, chosenUnit };
    setStepIndex(stepIndex - 1);
  }, [chosenUnit, onCancel, plan, preset, selectedJuz, selectedSurahs, stepIndex]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stepIndex === 0 && !onCancel) return false;
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back, onCancel, stepIndex]);

  const chooseGoal = (next: Goal) => {
    // Tapping the goal already chosen changes nothing, so it does not reset the saved pace.
    if (next === goal) return;
    setGoal(next);
    const nextPreset: PlanPreset = next === "keep" ? "maintenance" : "part_time_adult";
    setPreset(nextPreset);
    setPlan((value) => applyPreset(value, nextPreset));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const finalPlan: HifzPlan = goal === "keep" ? { ...plan, method: "review_only", newPerDay: 0 } : plan;
      const result = await applyHifzSetup(db, {
        plan: finalPlan,
        memorizedSurahs: [...selectedSurahs],
        memorizedJuz: [...selectedJuz],
      });
      onDone({
        plan: finalPlan,
        declaredPages: result.declaredPages,
        migratedPages: result.migratedPages,
        firstPlan: initialPlan === null,
        unitSwitched: initialPlan !== null && (initialPlan.unit === "ayah") !== (finalPlan.unit === "ayah"),
        unitChanged: initialPlan !== null && initialPlan.unit !== finalPlan.unit,
        repetitionsChanged:
          initialPlan !== null && JSON.stringify(initialPlan.sabaqRepetitions) !== JSON.stringify(finalPlan.sabaqRepetitions),
      });
    } catch (saveError) {
      console.warn("[HifzSetup] Save failed:", saveError);
      setError(s.hifzSaveFailedGeneric);
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (stepIndex < STEPS.length - 1) goToStep(stepIndex + 1);
    else save();
  };

  /** Skip this step: undo any change made on it, then move on with what it showed when it opened. */
  const skip = () => {
    const entry = stepEntry.current;
    if (entry) {
      setPlan(entry.plan);
      setPreset(entry.preset);
      setSelectedSurahs(entry.surahs);
      setSelectedJuz(entry.juz);
      setChosenUnit(entry.chosenUnit);
    }
    stepEntry.current = entry ? { ...entry } : { plan, preset, surahs: selectedSurahs, juz: selectedJuz, chosenUnit };
    setStepIndex(stepIndex + 1);
  };

  const toggle = (set: Set<number>, value: number) => {
    const copy = new Set(set);
    if (copy.has(value)) copy.delete(value);
    else copy.add(value);
    return copy;
  };

  const title = useMemo(() => {
    switch (step) {
      case "goal":
        return s.hifzGoalTitle;
      case "memorized":
        return s.hifzMemorizedTitle;
      case "tracks":
        return s.hifzTracksTitle;
      case "pace":
        return s.hifzPaceTitle;
      case "when":
        return s.hifzWhenTitle;
    }
  }, [s, step]);

  return (
    <View className="flex-1">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text dir={dir} variant="caption">
          {interpolate(s.hifzStepOf, { n: formatNumber(stepIndex + 1, language), total: formatNumber(STEPS.length, language) })}
        </Text>
        <Text dir={dir} style={{ fontFamily: "NotoSerif_700Bold", fontSize: 24, lineHeight: 34 }} className="text-charcoal dark:text-neutral-100">
          {title}
        </Text>

        {step === "goal" ? (
          <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ gap: 10 }}>
            <OptionCard title={s.hifzGoalMemorize} selected={goal === "memorize"} onPress={() => chooseGoal("memorize")} />
            <OptionCard title={s.hifzGoalKeep} selected={goal === "keep"} onPress={() => chooseGoal("keep")} />
            <OptionCard title={s.hifzGoalBoth} selected={goal === "both"} onPress={() => chooseGoal("both")} />
          </View>
        ) : null}

        {step === "memorized" ? (
          <>
            <Text dir={dir} variant="muted">
              {s.hifzMemorizedSubtitle}
            </Text>
            <MemorizedPortionPicker
              surahs={surahs}
              selectedSurahs={selectedSurahs}
              selectedJuz={selectedJuz}
              onToggleSurah={(surah) => setSelectedSurahs((value) => toggle(value, surah))}
              onToggleJuz={(juz) => setSelectedJuz((value) => toggle(value, juz))}
              language={language}
              isDark={isDark}
              s={s}
            />
          </>
        ) : null}

        {step === "tracks" ? (
          <View style={{ gap: 10 }}>
            <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ gap: 10 }}>
              {(
                [
                  ["page", s.hifzUnitPage, s.hifzUnitPageHint],
                  ["half", s.hifzUnitHalf, s.hifzUnitHalfHint],
                  ["ayah", s.hifzUnitAyah, s.hifzUnitAyahHint],
                ] as const
              ).map(([unit, label, hint]) => (
                <OptionCard
                  key={unit}
                  title={label}
                  hint={hint}
                  selected={plan.unit === unit}
                  onPress={() => {
                    setChosenUnit(unit);
                    setPlan((value) => ({ ...value, unit }));
                  }}
                />
              ))}
            </View>
            {/* Editing a plan: a switch of unit keeps what was learned (7.6). */}
            {initialPlan ? (
              <Text dir={dir} variant="caption" className="text-warm-700 dark:text-neutral-400" style={{ lineHeight: 18 }}>
                {s.hifzUnitSwitchKeepsSchedule}
              </Text>
            ) : null}
            <MirroredRow dir={dir} className="mt-2 items-center justify-between gap-3 rounded-3xl bg-surface-low dark:bg-surface-dark-low px-4 py-3">
              <View className="flex-1">
                <Text dir={dir} style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }} className="text-charcoal dark:text-neutral-100">
                  {s.hifzReviewMeanings}
                </Text>
                <Text dir={dir} variant="caption">
                  {s.hifzTracksMeaningsHint}
                </Text>
              </View>
              <Switch
                accessibilityLabel={s.hifzReviewMeanings}
                value={plan.meanings}
                onValueChange={(meanings) => setPlan((value) => ({ ...value, meanings }))}
              />
            </MirroredRow>
          </View>
        ) : null}

        {step === "pace" ? (
          <View style={{ gap: 10 }}>
            <View accessibilityRole="radiogroup" accessibilityLabel={s.hifzPaceTitle} style={{ gap: 10 }}>
              {PRESETS.filter((candidate) => (goal === "keep" ? candidate === "maintenance" : candidate !== "maintenance")).map((candidate) => (
                <OptionCard
                  key={candidate}
                  title={presetLabel(candidate, s)}
                  hint={
                    interpolate(s.hifzPresetSummary, { minutes: formatMinutes(applyPreset(plan, candidate).dailyBudgetMin, language) }) +
                    // Said only while it is true: chosen, the card describes the plan as it will be saved.
                    (candidate === "short_surahs" && (preset !== candidate || plan.unit === "ayah") ? `. ${s.hifzPresetAyahByAyah}` : "")
                  }
                  selected={preset === candidate}
                  onPress={() => {
                    setPreset(candidate);
                    // "Short surahs" reviews ayah by ayah; any other pace keeps the unit chosen on step 3.
                    setPlan((value) => {
                      const next = applyPreset(value, candidate);
                      return candidate === "short_surahs" ? next : { ...next, unit: chosenUnit };
                    });
                  }}
                />
              ))}
            </View>
            {/* Only when editing a saved plan: onboarding keeps the default counts (5.1, ONB-01). */}
            {initialPlan && goal !== "keep" && plan.method !== "review_only" ? (
              <SabaqRepetitionsSection
                value={plan.sabaqRepetitions}
                onChange={(sabaqRepetitions) => setPlan((value) => ({ ...value, sabaqRepetitions }))}
                language={language}
                isDark={isDark}
                s={s}
              />
            ) : null}
          </View>
        ) : null}

        {step === "when" ? (
          <View style={{ gap: 10 }}>
            <Text dir={dir} variant="muted">
              {interpolate(s.hifzWhenHint, { when: anchorPhrase(plan.anchor, language, s) })}
            </Text>
            <MirroredRow dir={dir} className="flex-wrap gap-2" accessibilityRole="radiogroup" accessibilityLabel={title}>
              {PRAYERS.map((prayer) => {
                const selected = plan.anchor.kind === "prayer" && plan.anchor.prayer === prayer;
                return (
                  <Pressable
                    key={prayer}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setPlan((value) => ({ ...value, anchor: { kind: "prayer", prayer, offsetMin: 20 } }))}
                    className={`min-h-[44px] justify-center rounded-full px-4 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"}`}
                  >
                    <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className={selected ? "text-primary-muted dark:text-primary-bright" : "text-charcoal dark:text-neutral-200"}>
                      {interpolate(s.hifzAfterPrayer, { prayer: prayerLabel(prayer, s) })}
                    </Text>
                  </Pressable>
                );
              })}
              {[
                { label: s.hifzWhenMorning, minutes: 8 * 60 },
                { label: s.hifzWhenEvening, minutes: 20 * 60 },
              ].map((option) => {
                const selected = plan.anchor.kind === "clock" && plan.anchor.minutes === option.minutes;
                return (
                  <Pressable
                    key={option.minutes}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setPlan((value) => ({ ...value, anchor: { kind: "clock", minutes: option.minutes } }))}
                    className={`min-h-[44px] justify-center rounded-full px-4 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"}`}
                  >
                    <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className={selected ? "text-primary-muted dark:text-primary-bright" : "text-charcoal dark:text-neutral-200"}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </MirroredRow>
            {/* 5.1 step 7: a prayer anchor needs prayer times; without them it falls back to set clock times.
                The setup stays one optional row until asked for, so the anchor choice and Save lead the step. */}
            {plan.anchor.kind === "prayer" ? (
              <Card elevation="low" className="mt-2 px-4 py-3">
                <MirroredRow dir={dir} className="min-h-[44px] items-center gap-3">
                  <View className="min-w-0 flex-1">
                    <Text dir={dir} variant="title-sm">
                      {s.notifPrayerTimesOptional}
                    </Text>
                    <Text dir={dir} variant="caption">
                      {prayerLocation ? s[CALCULATION_METHOD_LABEL_KEYS[prayerLocation.method]] : s.notifPrayerTimesNotSet}
                    </Text>
                  </View>
                  <Button
                    variant="outline"
                    size="sm"
                    dir={dir}
                    className="h-11 border border-warm-300 dark:border-neutral-700"
                    accessibilityState={{ expanded: prayerTimesOpen }}
                    accessibilityLabel={`${s.notifPrayerTimesTitle}: ${prayerTimesOpen ? s.notifHide : prayerLocation ? s.notifChange : s.notifSetUp}`}
                    label={prayerTimesOpen ? s.notifHide : prayerLocation ? s.notifChange : s.notifSetUp}
                    onPress={() => setPrayerTimesOpen((open) => !open)}
                  />
                </MirroredRow>
                {prayerTimesOpen ? (
                  <View className="mt-3">
                    <PrayerTimesSetup onChange={setPrayerLocation} onDone={() => setPrayerTimesOpen(false)} />
                  </View>
                ) : null}
              </Card>
            ) : null}
          </View>
        ) : null}

        {error ? (
          <Text dir={dir} className="text-red-600 dark:text-red-400" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View className="px-5 pb-5 pt-2" style={{ gap: 8 }}>
        <Button label={saving ? s.hifzSaving : stepIndex === STEPS.length - 1 ? s.hifzSaveMemorized : s.hifzContinue} onPress={next} disabled={saving} />
        <MirroredRow dir={dir} className="items-center justify-between">
          <Pressable accessibilityRole="button" onPress={back} disabled={saving || (stepIndex === 0 && !onCancel)} className="min-h-[44px] justify-center px-2">
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className={stepIndex === 0 && !onCancel ? "text-transparent" : "text-warm-500 dark:text-neutral-400"}>
              {s.hifzBack}
            </Text>
          </Pressable>
          {step !== "goal" && stepIndex < STEPS.length - 1 ? (
            <Pressable accessibilityRole="button" onPress={skip} disabled={saving} className="min-h-[44px] justify-center px-2">
              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="text-warm-500 dark:text-neutral-400">
                {s.hifzNotNow}
              </Text>
            </Pressable>
          ) : null}
        </MirroredRow>
      </View>
    </View>
  );
}
