import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { SwitchRow, SwitchTrack } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import { SetupOptionCard } from "@/components/hifz/SetupOptionCard";
import {
  initialMeaningsDraft,
  loadStoredMeanings,
  MeaningsSetupStep,
  meaningsSetupOf,
  type MeaningsDraft,
  type StoredMeanings,
} from "@/components/hifz/MeaningsSetupStep";
import { MemorizedPortionPicker, type PortionMode, type SurahChoice } from "@/components/hifz/MemorizedPortionPicker";
import type { AppDatabase } from "@/lib/database/types";
import { applyHifzSetup } from "@/lib/hifz/setup";
import { Card } from "@/components/ui/Card";
import { CALCULATION_METHOD_LABEL_KEYS, PrayerTimesSetup } from "@/components/notifications/PrayerTimesSetup";
import { SittingChips } from "@/components/notifications/SittingChips";
import {
  applyPreset,
  DEFAULT_HIFZ_PLAN,
  DEFAULT_PLAN_PRESET,
  presetOf,
  MEMORIZE_REPETITION_BOUNDS,
  MEMORIZE_REPETITION_PRESETS,
  memorizeRepetitionPresetOf,
  type Anchor,
  type HifzPlan,
  type PlanPreset,
  type Prayer,
  type MemorizeRepetitionCount,
  type MemorizeRepetitionPreset,
  type MemorizeRepetitions,
} from "@/lib/hifz/plan";
import { formatMinutes, formatNumber, formatPages } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { deviceClock, formatClockMinutesForDisplay } from "@/lib/notifications/clock";
import {
  chipAnchor,
  chipOf,
  defaultReviewChip,
  reviewChipAllowed,
  type SittingChip,
  type SittingDay,
} from "@/lib/notifications/review-sitting";
import { anchorFromPlan, readReviewAnchor } from "@/lib/notifications/settings";
import type { ReminderAnchor } from "@/lib/notifications/types";
import { readPrayerLocation } from "@/lib/prayer/settings";
import { useSettings } from "@/lib/settings/context";
import { mutedIconColor } from "@/lib/ui/theme-icons";
import { VIEWPORT_BREAKPOINTS } from "@/lib/ui/viewport";
import { createPrayerTimesLookup, type PrayerLocation } from "@/lib/prayer/times";

type Goal = "memorize" | "keep" | "both";
type Step = "goal" | "memorized" | "tracks" | "meanings" | "pace" | "when";

const STEPS: readonly Step[] = ["goal", "memorized", "tracks", "meanings", "pace", "when"];
const PRESETS: readonly PlanPreset[] = ["part_time_beginner", "part_time_adult", "full_time", "maintenance", "short_surahs"];

/** The wizard's column width on every screen; onboarding and Settings both open it at this width. */
export const SETUP_MAX_WIDTH = 640;
/** Below this window height the framed card would be too short for its footer, so the wizard stays full height. */
const FRAMED_MIN_HEIGHT = 520;
/** On medium and wider windows that are tall enough, the wizard is a framed card no taller than this, so Continue stays near the options. */
// Tall enough for the whole juz grid with the title and footer, so tall windows never scroll it.
const SETUP_CARD_MAX_HEIGHT = 840;
const SETUP_CARD_MARGIN = 24;

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

/** The chosen time in words inside the implementation intention (ANC-01): "after Fajr", "in the morning". */
function anchorPhrase(anchor: Anchor, language: "en" | "ar", s: UIStrings): string {
  if (anchor.kind === "prayer") return interpolate(s.hifzAfterPrayerInline, { prayer: prayerLabel(anchor.prayer, s) });
  if (anchor.minutes === 8 * 60) return s.hifzWhenInMorning;
  if (anchor.minutes === 20 * 60) return s.hifzWhenInEvening;
  return interpolate(s.hifzWhenAtTime, { time: formatClockMinutesForDisplay(anchor.minutes, language) });
}

function planAnchorOf(chip: SittingChip): Anchor {
  const anchor = chipAnchor(chip);
  return anchor.kind === "prayer" ? { kind: "prayer", prayer: anchor.prayer, offsetMin: anchor.offsetMinutes } : anchor;
}

type StepEntry = Readonly<{
  plan: HifzPlan;
  preset: PlanPreset | null;
  surahs: Set<number>;
  juz: Set<number>;
  /** The unit chosen on the tracks step, so skipping that step does not leave its choice behind. */
  chosenUnit: HifzPlan["unit"];
  meanings: MeaningsDraft;
  /** Whether the word-meaning choices had been changed, so skipping that step does not save them. */
  meaningsTouched: boolean;
}>;

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
  count: MemorizeRepetitionCount;
  onChange: (value: number) => void;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
}) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const { min, max } = MEMORIZE_REPETITION_BOUNDS[count];
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
 * SBQ-01: how many times new memorization has the user listen, read while looking and recite cleanly. Two
 * presets or custom counts; custom stays chosen once opened, even when its counts match a preset.
 */
function MemorizeRepetitionsSection({
  value,
  onChange,
  language,
  isDark,
  s,
}: {
  value: MemorizeRepetitions;
  onChange: (value: MemorizeRepetitions) => void;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
}) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const [customOpen, setCustomOpen] = useState(false);
  const choice: MemorizeRepetitionPreset | "custom" = customOpen ? "custom" : (memorizeRepetitionPresetOf(value) ?? "custom");
  const choosePreset = (preset: MemorizeRepetitionPreset) => {
    setCustomOpen(false);
    onChange({ ...MEMORIZE_REPETITION_PRESETS[preset] });
  };
  const counts: readonly { count: MemorizeRepetitionCount; label: string }[] = [
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
        <SetupOptionCard
          title={s.hifzRepsLookingThenMemory}
          hint={s.hifzRepsLookingThenMemoryHint}
          selected={choice === "looking_then_memory"}
          onPress={() => choosePreset("looking_then_memory")}
        />
        <SetupOptionCard
          title={s.hifzRepsTwentyTimes}
          hint={s.hifzRepsTwentyTimesHint}
          selected={choice === "twenty_times"}
          onPress={() => choosePreset("twenty_times")}
        />
        <SetupOptionCard title={s.hifzRepsCustom} hint={s.hifzRepsCustomHint} selected={choice === "custom"} onPress={() => setCustomOpen(true)} />
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

/**
 * Wide screens frame the wizard in a card with one top edge on every step, so the title stays put while the card's
 * height follows the step. Phones keep the footer pinned at the bottom, in thumb reach on every step.
 */
function SetupFrame({ framed, top, maxHeight, children }: { framed: boolean; top: number; maxHeight: number; children: ReactNode }) {
  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {framed ? (
        <View style={{ flex: 1, alignItems: "center", paddingTop: top, paddingBottom: SETUP_CARD_MARGIN, paddingHorizontal: SETUP_CARD_MARGIN }}>
          {/* The card's dark fill matches the page so the surface-low controls inside keep the contrast they have on phones. */}
          <View
            className="overflow-hidden border border-surface-high bg-surface-bright dark:border-surface-dark-high dark:bg-surface-dark"
            style={{ width: "100%", maxWidth: SETUP_MAX_WIDTH, maxHeight, flexShrink: 1, borderRadius: 30 }}
          >
            {children}
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, width: "100%", maxWidth: SETUP_MAX_WIDTH, alignSelf: "center" }}>{children}</View>
      )}
    </KeyboardAvoidingView>
  );
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
 * Hifz setup (5.1 steps 2 to 6): goal, memorized portion, review tracks (UNIT-02), word meanings
 * (SPEC 3.6), pace (4.3.2) and the time anchor (ANC-01). Every step can be skipped with sensible
 * defaults (ONB-06).
 */
export function HifzSetupFlow({ db, language, isDark, s, initialPlan, onDone, onCancel }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const { width, height } = useWindowDimensions();
  // Short windows (web landscape phones) keep the full-height layout with the pinned footer.
  const framed = width >= VIEWPORT_BREAKPOINTS.mediumWindow && height >= FRAMED_MIN_HEIGHT;
  const scrollRef = useRef<ScrollView>(null);
  const [stepIndex, setStepIndex] = useState(0);
  // Editing starts from the saved plan as it is: its goal, and its preset only while it still matches.
  const [goal, setGoal] = useState<Goal>(initialPlan?.method === "review_only" ? "keep" : "both");
  const [plan, setPlan] = useState<HifzPlan>(initialPlan ?? applyPreset(DEFAULT_HIFZ_PLAN, DEFAULT_PLAN_PRESET));
  const [preset, setPreset] = useState<PlanPreset | null>(initialPlan ? presetOf(initialPlan) : DEFAULT_PLAN_PRESET);
  // The unit chosen on the tracks step. "Short surahs" reviews ayah by ayah; another pace brings this back.
  const [chosenUnit, setChosenUnit] = useState<HifzPlan["unit"]>(
    initialPlan && presetOf(initialPlan) !== "short_surahs" ? initialPlan.unit : DEFAULT_HIFZ_PLAN.unit,
  );
  const [surahs, setSurahs] = useState<SurahChoice[]>([]);
  const [surahsState, setSurahsState] = useState<"loading" | "ready" | "error">("loading");
  const [surahsAttempt, setSurahsAttempt] = useState(0);
  const [selectedSurahs, setSelectedSurahs] = useState<Set<number>>(new Set());
  const [selectedJuz, setSelectedJuz] = useState<Set<number>>(new Set());
  // Juz or surah view of the memorized step, kept here so Back and Continue return to the same view.
  const [portionMode, setPortionMode] = useState<PortionMode>("juz");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prayerTimesOpen, setPrayerTimesOpen] = useState(false);
  const [prayerLocation, setPrayerLocation] = useState<PrayerLocation | null>(null);
  // REMIND-07: the second sitting for review. A new setup starts with it off; a saved choice, "off" or
  // a time, is loaded and kept as it is, never recomputed from the pace or the main time.
  const [reviewAnchor, setReviewAnchor] = useState<ReminderAnchor | null>(null);
  const savedReview = useRef<ReminderAnchor | null | undefined>(undefined);
  const reviewTouched = useRef(false);
  // SPEC 3.6: the word-meaning choices start from the stored settings once they load. A failed load
  // leaves them unsaved unless the user changes the step.
  const { fontSize, lineHeight } = useSettings();
  const [meanings, setMeanings] = useState<MeaningsDraft>(() => initialMeaningsDraft(null));
  const [storedMeanings, setStoredMeanings] = useState<StoredMeanings | null>(null);
  const meaningsTouched = useRef(false);
  const changeMeanings = (update: (draft: MeaningsDraft) => MeaningsDraft) => {
    meaningsTouched.current = true;
    setMeanings(update);
  };
  // The level check opens below the fold on a phone, so what the level choice shows is scrolled into
  // view. measureLayout against the step's wrapper, whose own place in the scroll content onLayout gives.
  const meaningsStepRef = useRef<View>(null);
  const meaningsStepY = useRef(0);
  const revealInMeanings = useCallback((target: View | null) => {
    const wrapper = meaningsStepRef.current;
    if (!target || !wrapper) return;
    target.measureLayout(
      wrapper as never,
      (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, meaningsStepY.current + y - 12), animated: true }),
      () => {},
    );
  }, []);
  const step = STEPS[stepIndex];
  // What the current step showed when it opened, so "Not now" can leave it untouched.
  const stepEntry = useRef<StepEntry | null>(null);
  const goToStep = (index: number) => {
    stepEntry.current = { plan, preset, surahs: selectedSurahs, juz: selectedJuz, chosenUnit, meanings, meaningsTouched: meaningsTouched.current };
    setStepIndex(index);
  };

  // The surah list loads once per attempt; Retry starts a new attempt and a stale one is ignored.
  useEffect(() => {
    let active = true;
    setSurahsState("loading");
    // Each surah's first and last page let the surah list say which surahs a chosen juz already covers.
    db.getAllAsync<SurahChoice>(
      `SELECT s.number, s.name_arabic, s.name_english, s.ayah_count, MIN(q.v2_page) AS first_page, MAX(q.v2_page) AS last_page
       FROM surahs s LEFT JOIN quran_text q ON q.surah = s.number AND q.v2_page > 0
       GROUP BY s.number ORDER BY s.number`,
    )
      .then((rows) => {
        if (!active) return;
        setSurahs(rows);
        setSurahsState("ready");
      })
      .catch((loadError) => {
        console.warn("[HifzSetup] Surahs failed to load:", loadError);
        if (active) setSurahsState("error");
      });
    return () => {
      active = false;
    };
  }, [db, surahsAttempt]);

  // Each step opens at its top: the scroll view is shared, so a long surah list would leave the next step scrolled.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }, [stepIndex]);

  // Saving is announced once when it starts, beside the busy state on both buttons.
  useEffect(() => {
    if (saving) AccessibilityInfo.announceForAccessibility?.(s.setupSavingAnnouncement);
  }, [saving, s.setupSavingAnnouncement]);

  useEffect(() => {
    let active = true;
    readReviewAnchor(db)
      .then((saved) => {
        if (!active) return;
        savedReview.current = saved;
        if (!reviewTouched.current) setReviewAnchor(saved);
      })
      .catch((loadError) => console.warn("[HifzSetup] The second sitting failed to load:", loadError));
    return () => {
      active = false;
    };
  }, [db]);

  useEffect(() => {
    let active = true;
    loadStoredMeanings(db)
      .then((stored) => {
        if (!active) return;
        setStoredMeanings(stored);
        if (!meaningsTouched.current) setMeanings(initialMeaningsDraft(stored));
      })
      .catch((loadError) => console.warn("[HifzSetup] Word meaning settings failed to load:", loadError));
    return () => {
      active = false;
    };
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
    stepEntry.current = { plan, preset, surahs: selectedSurahs, juz: selectedJuz, chosenUnit, meanings, meaningsTouched: meaningsTouched.current };
    setStepIndex(stepIndex - 1);
  }, [chosenUnit, meanings, onCancel, plan, preset, selectedJuz, selectedSurahs, stepIndex]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // The atomic save is in flight: stay on this step until it finishes or fails.
      if (saving) return true;
      if (stepIndex === 0 && !onCancel) return false;
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back, onCancel, saving, stepIndex]);

  const chooseGoal = (next: Goal) => {
    // Tapping the goal already chosen changes nothing, so it does not reset the saved pace.
    if (next === goal) return;
    setGoal(next);
    const nextPreset: PlanPreset = next === "keep" ? "maintenance" : DEFAULT_PLAN_PRESET;
    setPreset(nextPreset);
    setPlan((value) => applyPreset(value, nextPreset));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const finalPlan: HifzPlan = goal === "keep" ? { ...plan, method: "review_only", newPerDay: 0 } : plan;
      // The second sitting is written with the plan, and only when this setup changed it. If the saved
      // value never loaded, a choice the user made is still written rather than dropped.
      const reviewChanged =
        savedReview.current === undefined
          ? reviewTouched.current
          : JSON.stringify(reviewAnchor) !== JSON.stringify(savedReview.current);
      const result = await applyHifzSetup(db, {
        plan: finalPlan,
        memorizedSurahs: [...selectedSurahs],
        memorizedJuz: [...selectedJuz],
        ...(reviewChanged ? { reviewAnchor } : {}),
        ...(storedMeanings || meaningsTouched.current ? { meanings: meaningsSetupOf(meanings, storedMeanings, language) } : {}),
      });
      if (reviewChanged) savedReview.current = reviewAnchor;
      onDone({
        plan: finalPlan,
        declaredPages: result.declaredPages,
        migratedPages: result.migratedPages,
        firstPlan: initialPlan === null,
        unitSwitched: initialPlan !== null && (initialPlan.unit === "ayah") !== (finalPlan.unit === "ayah"),
        unitChanged: initialPlan !== null && initialPlan.unit !== finalPlan.unit,
        repetitionsChanged:
          initialPlan !== null && JSON.stringify(initialPlan.memorizeRepetitions) !== JSON.stringify(finalPlan.memorizeRepetitions),
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
      // An untouched step shows the stored choices, which may have loaded after this snapshot was taken.
      const restoredMeanings = entry.meaningsTouched ? entry.meanings : initialMeaningsDraft(storedMeanings);
      setMeanings(restoredMeanings);
      meaningsTouched.current = entry.meaningsTouched;
      stepEntry.current = { ...entry, meanings: restoredMeanings };
    } else {
      stepEntry.current = { plan, preset, surahs: selectedSurahs, juz: selectedJuz, chosenUnit, meanings, meaningsTouched: meaningsTouched.current };
    }
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
      case "meanings":
        return s.meaningsStepTitle;
      case "pace":
        return s.hifzPaceTitle;
      case "when":
        return s.hifzWhenTitle;
    }
  }, [s, step]);

  // REMIND-07: second-sitting chips are later than the main sitting today, by the location chosen on
  // this step, the saved one or the fallback times. The picker uses the ordinary main time; a Ramadan
  // time is handled when reminders are planned.
  const sittingDay = useMemo<SittingDay>(
    () => ({ clock: deviceClock, prayers: createPrayerTimesLookup(prayerLocation), date: deviceClock.dateOf(new Date()) }),
    [prayerLocation],
  );
  const mainAnchor = anchorFromPlan(plan.anchor);
  const reviewDefault = defaultReviewChip(sittingDay, mainAnchor);
  const reviewSwitchDisabled = reviewAnchor === null && reviewDefault === null;
  const setReview = (value: ReminderAnchor | null) => {
    reviewTouched.current = true;
    setReviewAnchor(value);
  };
  const usesPrayer = plan.anchor.kind === "prayer" || reviewAnchor?.kind === "prayer";

  // The card sits at one top offset on every step and never runs past the bottom margin.
  const cardTop = Math.max(SETUP_CARD_MARGIN, Math.round((height - SETUP_CARD_MAX_HEIGHT) / 2));
  const cardMaxHeight = Math.min(SETUP_CARD_MAX_HEIGHT, height - cardTop - SETUP_CARD_MARGIN);

  return (
    // The footer stays above the keyboard while the surah search is focused; dragging the list closes it.
    <SetupFrame framed={framed} top={cardTop} maxHeight={cardMaxHeight}>
      <ScrollView
        ref={scrollRef}
        // Framed, the scroll view is only as tall as its step and gives up height to the footer when the step is long.
        style={framed ? { flexGrow: 0, flexShrink: 1 } : undefined}
        contentContainerStyle={{ padding: 20, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text dir={dir} variant="caption">
          {interpolate(s.hifzStepOf, { n: formatNumber(stepIndex + 1, language), total: formatNumber(STEPS.length, language) })}
        </Text>
        <Text dir={dir} style={{ fontFamily: "NotoSerif_700Bold", fontSize: 24, lineHeight: 34 }} className="text-charcoal dark:text-neutral-100">
          {title}
        </Text>

        {step === "goal" ? (
          <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ gap: 10 }}>
            <SetupOptionCard title={s.hifzGoalMemorize} selected={goal === "memorize"} onPress={() => chooseGoal("memorize")} />
            <SetupOptionCard title={s.hifzGoalKeep} selected={goal === "keep"} onPress={() => chooseGoal("keep")} />
            <SetupOptionCard title={s.hifzGoalBoth} selected={goal === "both"} onPress={() => chooseGoal("both")} />
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
              mode={portionMode}
              onModeChange={setPortionMode}
              onToggleSurah={(surah) => setSelectedSurahs((value) => toggle(value, surah))}
              onSetSurahs={(numbers, selected) =>
                setSelectedSurahs((value) => {
                  const copy = new Set(value);
                  for (const number of numbers) {
                    if (selected) copy.add(number);
                    else copy.delete(number);
                  }
                  return copy;
                })
              }
              onToggleJuz={(juz) => setSelectedJuz((value) => toggle(value, juz))}
              loadState={surahsState}
              onRetryLoad={() => setSurahsAttempt((attempt) => attempt + 1)}
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
                <SetupOptionCard
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
          </View>
        ) : null}

        {step === "meanings" ? (
          <View
            ref={meaningsStepRef}
            onLayout={(event) => {
              meaningsStepY.current = event.nativeEvent.layout.y;
            }}
          >
            <MeaningsSetupStep
              db={db}
              draft={meanings}
              stored={storedMeanings}
              onChange={changeMeanings}
              language={language}
              fontSize={fontSize}
              lineHeight={lineHeight}
              s={s}
              onReveal={revealInMeanings}
            />
          </View>
        ) : null}

        {step === "pace" ? (
          <View style={{ gap: 10 }}>
            <View accessibilityRole="radiogroup" accessibilityLabel={s.hifzPaceTitle} style={{ gap: 10 }}>
              {PRESETS.filter((candidate) => (goal === "keep" ? candidate === "maintenance" : candidate !== "maintenance")).map((candidate) => (
                <SetupOptionCard
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
              <MemorizeRepetitionsSection
                value={plan.memorizeRepetitions}
                onChange={(memorizeRepetitions) => setPlan((value) => ({ ...value, memorizeRepetitions }))}
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
            <SittingChips
              label={title}
              selected={chipOf(mainAnchor)}
              onSelect={(chip) => setPlan((value) => ({ ...value, anchor: planAnchorOf(chip) }))}
              dir={dir}
              language={language}
              s={s}
            />
            {/* REMIND-07: an optional second sitting for whatever review is left. Off unless chosen. The whole
                row is the switch, as in Settings, so its caption, including why it is off, is the hint. */}
            <SwitchRow
              label={s.notifReviewTitle}
              hint={reviewSwitchDisabled ? s.notifReviewNeedsEarlier : s.notifReviewHint}
              value={reviewAnchor !== null}
              disabled={reviewSwitchDisabled}
              onValueChange={(on) => {
                if (!on) setReview(null);
                else if (reviewDefault) setReview(chipAnchor(reviewDefault));
              }}
              className="mt-2 rounded-3xl bg-surface-low dark:bg-surface-dark-low px-4 py-3"
            >
              <MirroredRow dir={dir} className="items-center justify-between gap-3">
                <View className="flex-1">
                  <Text dir={dir} style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }} className="text-charcoal dark:text-neutral-100">
                    {s.notifReviewTitle}
                  </Text>
                  <Text dir={dir} variant="caption">
                    {reviewSwitchDisabled ? s.notifReviewNeedsEarlier : s.notifReviewHint}
                  </Text>
                </View>
                <SwitchTrack value={reviewAnchor !== null} disabled={reviewSwitchDisabled} />
              </MirroredRow>
            </SwitchRow>
            {reviewAnchor ? (
              <View style={{ gap: 8 }}>
                <SittingChips
                  label={s.notifReviewTitle}
                  selected={chipOf(reviewAnchor)}
                  onSelect={(chip) => setReview(chipAnchor(chip))}
                  allowed={(chip) => reviewChipAllowed(sittingDay, mainAnchor, chip)}
                  dir={dir}
                  language={language}
                  s={s}
                />
                {/* A saved clock time that no chip names stays visible, so it can be kept or replaced. */}
                {reviewAnchor.kind === "clock" && chipOf(reviewAnchor) === null ? (
                  <Text dir={dir} variant="body-sm">
                    {interpolate(s.notifClockValue, { time: formatClockMinutesForDisplay(reviewAnchor.minutes, language) })}
                  </Text>
                ) : null}
                <Text dir={dir} variant="caption">
                  {s.notifReviewSkipNote}
                </Text>
              </View>
            ) : null}
            {/* 5.1 step 7: a prayer anchor needs prayer times; without them it falls back to set clock times.
                The setup stays one optional row until asked for, so the anchor choice and Save lead the step.
                It shows when either sitting follows a prayer. */}
            {usesPrayer ? (
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

      <View
        className={framed ? "border-surface-high px-5 pb-5 pt-3 dark:border-surface-dark-high" : "px-5 pb-5 pt-2"}
        style={framed ? { gap: 8, borderTopWidth: StyleSheet.hairlineWidth } : { gap: 8 }}
      >
        <Button
          label={saving ? s.hifzSaving : stepIndex === STEPS.length - 1 ? s.hifzSaveMemorized : s.hifzContinue}
          onPress={next}
          disabled={saving}
          accessibilityState={{ busy: saving, disabled: saving }}
          // Long labels wrap and the button grows instead of shrinking the text.
          className="h-auto min-h-[44px] py-2.5"
        />
        <MirroredRow dir={dir} className="items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: saving, disabled: saving || (stepIndex === 0 && !onCancel) }}
            onPress={back}
            disabled={saving || (stepIndex === 0 && !onCancel)}
            className="min-h-[44px] justify-center px-2"
          >
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className={stepIndex === 0 && !onCancel ? "text-transparent" : "text-warm-500 dark:text-neutral-400"}>
              {s.hifzBack}
            </Text>
          </Pressable>
          {step !== "goal" && stepIndex < STEPS.length - 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              onPress={skip}
              disabled={saving}
              className="min-h-[44px] justify-center px-2"
            >
              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="text-warm-500 dark:text-neutral-400">
                {s.hifzNotNow}
              </Text>
            </Pressable>
          ) : null}
        </MirroredRow>
      </View>
    </SetupFrame>
  );
}
