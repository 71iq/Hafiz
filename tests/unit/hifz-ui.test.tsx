import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { GradingButtons } from "@/components/flashcards/GradingButtons";
import { HifzSetupFlow, setupSavedNotice } from "@/components/hifz/HifzSetupFlow";
import type { AppDatabase } from "@/lib/database/types";
import { Rating } from "@/lib/fsrs/scheduler";
import { applyPreset, DEFAULT_HIFZ_PLAN, type HifzPlan } from "@/lib/hifz/plan";
import { applyHifzSetup } from "@/lib/hifz/setup";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { formatClockMinutesForDisplay } from "@/lib/notifications/clock";
import { DirectionProvider } from "@/lib/ui/direction";

const mockSettings = {
  isDark: false,
  isRTL: false,
  uiLanguage: "en",
  effectiveTheme: "white",
  themeColors: { surface: "#ffffff", surfaceLow: "#f8fafc", surfaceMid: "#f4f4f5", surfaceHigh: "#e5e7eb", surfaceDim: "#d1d5db", surfaceBright: "#ffffff" },
};
// The prayer-times form needs the app database; the flow under test only needs it to render.
jest.mock("@/components/notifications/PrayerTimesSetup", () => ({ PrayerTimesSetup: () => null }));
// Saving writes the plan and the memorized portion; these tests check the plan the flow hands over.
jest.mock("@/lib/hifz/setup", () => ({ applyHifzSetup: jest.fn(async () => ({ declaredPages: 0 })) }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => mockSettings };
});

const s = strings.en;

describe("GradingButtons rubric caption (GRD-02, GRD-03)", () => {
  it("names the suggested grade and the support cap, and keeps the plain flashcard row without them", () => {
    const view = render(
      <GradingButtons onGrade={jest.fn()} previews={{}} isDark={false} s={s} proposed={Rating.Good} maxRating={Rating.Good} />,
    );
    expect(view.getByText(`${s.hifzSuggestedGrade}: ${s.flashcardsGood}`)).toBeTruthy();
    expect(view.getByText(`With this support, the highest grade is ${s.flashcardsGood}.`)).toBeTruthy();
    expect(view.getByRole("button", { name: s.flashcardsEasy }).props.accessibilityState).toMatchObject({ disabled: true });

    const plain = render(<GradingButtons onGrade={jest.fn()} previews={{}} isDark={false} s={s} />);
    expect(plain.queryByText(new RegExp(s.hifzSuggestedGrade))).toBeNull();
    expect(plain.queryByText(/highest grade/)).toBeNull();
  });
});

describe("HifzSetupFlow Not now", () => {
  const db = { getAllAsync: jest.fn(async () => []) } as unknown as AppDatabase;

  async function renderFlow() {
    const view = render(
      <DirectionProvider dir="ltr">
        <HifzSetupFlow db={db} language="en" isDark={false} s={s} initialPlan={null} onDone={jest.fn()} onCancel={jest.fn()} />
      </DirectionProvider>,
    );
    // Let the surah list load settle before interacting.
    await act(async () => {});
    return view;
  }

  it("skips a step without keeping the change made on it", async () => {
    const view = await renderFlow();
    fireEvent.press(view.getByText(s.hifzContinue));

    // Memorized portion: choose juz 30, then skip the step.
    fireEvent.press(view.getByLabelText("Juz 30"));
    expect(view.getByLabelText("Juz 30").props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(view.getByText(s.hifzNotNow));

    // Review tracks: choose ayah cards, then skip the step.
    fireEvent.press(view.getByText(s.hifzUnitAyah));
    fireEvent.press(view.getByText(s.hifzNotNow));

    // Going back shows both steps as they were before the skipped changes.
    fireEvent.press(view.getByText(s.hifzBack));
    expect(view.getByRole("radio", { name: new RegExp(s.hifzUnitPage) }).props.accessibilityState).toMatchObject({ checked: true });
    expect(view.getByRole("radio", { name: new RegExp(s.hifzUnitAyah) }).props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(view.getByText(s.hifzBack));
    expect(view.getByLabelText("Juz 30").props.accessibilityState).toMatchObject({ checked: false });
  });

  it("states the chosen time in the intention line", async () => {
    const view = await renderFlow();
    for (let step = 0; step < 5; step += 1) fireEvent.press(view.getByText(s.hifzContinue));
    expect(view.getByText(/^I'll start my wird after Fajr\. A fixed time makes the habit easier/)).toBeTruthy();
    fireEvent.press(view.getByText(interpolate(s.hifzWhenEvening, { time: formatClockMinutesForDisplay(20 * 60, "en") })));
    expect(view.getByText(/^I'll start my wird in the evening\./)).toBeTruthy();
  });
});

describe("HifzSetupFlow when step and the second sitting (START-02, REMIND-07)", () => {
  const MAGHRIB = { kind: "prayer", prayer: "maghrib", offsetMinutes: 20 };
  const morning = interpolate(s.hifzWhenMorning, { time: formatClockMinutesForDisplay(8 * 60, "en") });
  const evening = interpolate(s.hifzWhenEvening, { time: formatClockMinutesForDisplay(20 * 60, "en") });
  /** No saved prayer location, so prayer chips use the fallback clock times. */
  const dbWith = (saved: string | null = null) =>
    ({
      getAllAsync: jest.fn(async (sql: string) =>
        sql.includes("user_settings") && saved !== null ? [{ key: "notif_pref_review_anchor", value: saved }] : [],
      ),
    }) as unknown as AppDatabase;

  beforeEach(() => jest.mocked(applyHifzSetup).mockClear());

  async function openWhen(db: AppDatabase = dbWith()) {
    const view = render(
      <DirectionProvider dir="ltr">
        <HifzSetupFlow db={db} language="en" isDark={false} s={s} initialPlan={null} onDone={jest.fn()} onCancel={jest.fn()} />
      </DirectionProvider>,
    );
    await act(async () => {});
    for (let step = 0; step < 5; step += 1) fireEvent.press(view.getByText(s.hifzContinue));
    return view;
  }
  async function saved(view: ReturnType<typeof render>) {
    await act(async () => {
      fireEvent.press(view.getByText(s.hifzSaveMemorized));
    });
    return jest.mocked(applyHifzSetup).mock.calls.at(-1)![1];
  }
  const reviewSwitch = (view: ReturnType<typeof render>) => view.getByRole("switch", { name: s.notifReviewTitle });
  // The main sitting's seven chips come first, then the second sitting's seven while it is on.
  const mainChip = (view: ReturnType<typeof render>, name: string) => view.getAllByRole("radio", { name })[0];
  const reviewChip = (view: ReturnType<typeof render>, name: string) => {
    const chips = view.getAllByRole("radio", { name });
    expect(chips).toHaveLength(2);
    return chips[1];
  };

  it("groups the main chips, names the clock times, and starts with the second sitting off", async () => {
    const view = await openWhen();
    expect(view.getByText(s.hifzWhenTitle)).toBeTruthy();
    expect(view.getByText(s.hifzWhenAfterPrayerGroup)).toBeTruthy();
    expect(view.getByText(s.hifzWhenSetTimeGroup)).toBeTruthy();
    expect(view.getByText(morning)).toBeTruthy();
    expect(mainChip(view, "After Fajr").props.accessibilityState).toMatchObject({ checked: true });
    expect(reviewSwitch(view).props.accessibilityState).toMatchObject({ checked: false });
    expect(view.getByText(s.notifReviewHint)).toBeTruthy();
    expect("reviewAnchor" in (await saved(view))).toBe(false);
  });

  it("turns on after Maghrib for a Fajr main, offers only later chips, and saves with the plan", async () => {
    const view = await openWhen();
    fireEvent.press(reviewSwitch(view));
    expect(reviewSwitch(view).props.accessibilityState).toMatchObject({ checked: true });
    expect(reviewChip(view, "After Maghrib").props.accessibilityState).toMatchObject({ checked: true });
    expect(reviewChip(view, "After Fajr").props.accessibilityState).toMatchObject({ disabled: true });
    expect(reviewChip(view, morning).props.accessibilityState).toMatchObject({ disabled: false });
    expect(view.getByText(s.notifReviewSkipNote)).toBeTruthy();
    fireEvent.press(reviewChip(view, "After Isha"));
    expect((await saved(view)).reviewAnchor).toEqual({ kind: "prayer", prayer: "isha", offsetMinutes: 20 });
  });

  it("offers only Isha after a Maghrib main, so 20:00 is disabled", async () => {
    const view = await openWhen();
    fireEvent.press(mainChip(view, "After Maghrib"));
    fireEvent.press(reviewSwitch(view));
    expect(reviewChip(view, "After Isha").props.accessibilityState).toMatchObject({ checked: true, disabled: false });
    const reviewChips = view.getAllByRole("radio").slice(7);
    expect(reviewChips).toHaveLength(7);
    expect(reviewChips.filter((chip) => !chip.props.accessibilityState.disabled)).toHaveLength(1);
    expect(reviewChip(view, evening).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("keeps the switch off with a reason after Isha or 20:00", async () => {
    for (const choose of [(view: ReturnType<typeof render>) => fireEvent.press(mainChip(view, "After Isha")), (view: ReturnType<typeof render>) => fireEvent.press(mainChip(view, evening))]) {
      const view = await openWhen();
      choose(view);
      expect(reviewSwitch(view).props.accessibilityState).toMatchObject({ checked: false, disabled: true });
      expect(view.getByText(s.notifReviewNeedsEarlier)).toBeTruthy();
      view.unmount();
    }
  });

  it("loads a saved second sitting and writes it only when this setup changes it", async () => {
    const view = await openWhen(dbWith(JSON.stringify(MAGHRIB)));
    expect(reviewSwitch(view).props.accessibilityState).toMatchObject({ checked: true });
    expect(reviewChip(view, "After Maghrib").props.accessibilityState).toMatchObject({ checked: true });
    expect("reviewAnchor" in (await saved(view))).toBe(false);
    fireEvent.press(reviewSwitch(view));
    expect((await saved(view)).reviewAnchor).toBeNull();

    const off = await openWhen(dbWith("off"));
    expect(reviewSwitch(off).props.accessibilityState).toMatchObject({ checked: false });
    expect("reviewAnchor" in (await saved(off))).toBe(false);
  });

  it("still saves a second sitting the user chose when the saved one failed to load", async () => {
    const failing = () =>
      ({
        getAllAsync: jest.fn(async (sql: string) => {
          if (sql.includes("user_settings")) throw new Error("locked");
          return [];
        }),
      }) as unknown as AppDatabase;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const untouched = await openWhen(failing());
      expect("reviewAnchor" in (await saved(untouched))).toBe(false);
      untouched.unmount();

      const view = await openWhen(failing());
      fireEvent.press(reviewSwitch(view));
      expect((await saved(view)).reviewAnchor).toEqual(MAGHRIB);
    } finally {
      warn.mockRestore();
    }
  });

  it("shows a saved clock time that no chip names", async () => {
    const view = await openWhen(dbWith(JSON.stringify({ kind: "clock", minutes: 21 * 60 + 15 })));
    expect(reviewSwitch(view).props.accessibilityState).toMatchObject({ checked: true });
    expect(view.getByText(interpolate(s.notifClockValue, { time: formatClockMinutesForDisplay(21 * 60 + 15, "en") }))).toBeTruthy();
  });

  it("keeps a saved second sitting when the main time moves past it, with the skip note, and can turn it off", async () => {
    const view = await openWhen(dbWith(JSON.stringify(MAGHRIB)));
    fireEvent.press(mainChip(view, "After Isha"));
    expect(reviewSwitch(view).props.accessibilityState).toMatchObject({ checked: true, disabled: false });
    expect(reviewChip(view, "After Maghrib").props.accessibilityState).toMatchObject({ checked: true, disabled: true });
    expect(view.getByText(s.notifReviewSkipNote)).toBeTruthy();
    expect("reviewAnchor" in (await saved(view))).toBe(false);
    fireEvent.press(reviewSwitch(view));
    expect((await saved(view)).reviewAnchor).toBeNull();
  });

  it("shows the prayer-times row when only the second sitting follows a prayer", async () => {
    const view = await openWhen();
    fireEvent.press(mainChip(view, morning));
    expect(view.queryByText(s.notifPrayerTimesOptional)).toBeNull();
    fireEvent.press(reviewSwitch(view));
    expect(reviewChip(view, "After Maghrib").props.accessibilityState).toMatchObject({ checked: true });
    expect(view.getByText(s.notifPrayerTimesOptional)).toBeTruthy();
  });

  it("writes the Arabic step in natural Arabic", async () => {
    const ar = strings.ar;
    const view = render(
      <DirectionProvider dir="rtl">
        <HifzSetupFlow db={dbWith()} language="ar" isDark={false} s={ar} initialPlan={null} onDone={jest.fn()} onCancel={jest.fn()} />
      </DirectionProvider>,
    );
    await act(async () => {});
    for (let step = 0; step < 5; step += 1) fireEvent.press(view.getByText(ar.hifzContinue));
    expect(view.getByText("متى تجلس لوِردك؟")).toBeTruthy();
    expect(view.getByText(/^سأبدأ وِردي بعد الفجر\. الوقت الثابت يجعل العادة أيسر/)).toBeTruthy();
    expect(view.getByText("جلسة ثانية للمراجعة")).toBeTruthy();
    expect(view.getByText("بعد الصلاة")).toBeTruthy();
    expect(view.getByText("في وقت محدد")).toBeTruthy();
  });
});

describe("HifzSetupFlow default pace", () => {
  const db = { getAllAsync: jest.fn(async () => []) } as unknown as AppDatabase;
  const pace = (plan: HifzPlan) => ({ newPerDay: plan.newPerDay, recentEvery: plan.recentEvery, dailyBudgetMin: plan.dailyBudgetMin });
  const beginner = { newPerDay: 0.25, recentEvery: 2, dailyBudgetMin: 20 };

  beforeEach(() => jest.mocked(applyHifzSetup).mockClear());

  async function saveFrom(initialPlan: HifzPlan | null, beforeSaving: (view: ReturnType<typeof render>) => void = () => {}) {
    const view = render(
      <DirectionProvider dir="ltr">
        <HifzSetupFlow db={db} language="en" isDark={false} s={s} initialPlan={initialPlan} onDone={jest.fn()} onCancel={jest.fn()} />
      </DirectionProvider>,
    );
    await act(async () => {});
    beforeSaving(view);
    for (let step = 0; step < 5; step += 1) fireEvent.press(view.getByText(s.hifzContinue));
    await act(async () => {
      fireEvent.press(view.getByText(s.hifzSaveMemorized));
    });
    expect(applyHifzSetup).toHaveBeenCalledTimes(1);
    return jest.mocked(applyHifzSetup).mock.calls[0][1].plan;
  }

  it("starts a new setup on the part-time beginner pace", async () => {
    expect(pace(await saveFrom(null))).toEqual(beginner);
  });

  it("returns to the beginner pace when the goal moves away from keep", async () => {
    const plan = await saveFrom(null, (view) => {
      fireEvent.press(view.getByText(s.hifzGoalKeep));
      fireEvent.press(view.getByText(s.hifzGoalBoth));
    });
    expect(plan.method).toBe("standard");
    expect(pace(plan)).toEqual(beginner);
  });

  it("keeps the stored pace when a saved plan is edited", async () => {
    const stored = applyPreset(DEFAULT_HIFZ_PLAN, "part_time_adult");
    expect(pace(await saveFrom(stored))).toEqual({ newPerDay: 0.5, recentEvery: 1, dailyBudgetMin: 30 });
  });
});

describe("HifzSetupFlow new memorization repetitions (SBQ-01)", () => {
  const db = { getAllAsync: jest.fn(async () => []) } as unknown as AppDatabase;
  const savedPlan: HifzPlan = { ...DEFAULT_HIFZ_PLAN, newPerDay: 1 };

  beforeEach(() => jest.mocked(applyHifzSetup).mockClear());

  /** Open the flow on the pace step, where the counts are edited. */
  async function openPace(initialPlan: HifzPlan | null, language: "en" | "ar" = "en") {
    const text = strings[language];
    const view = render(
      <DirectionProvider dir={language === "ar" ? "rtl" : "ltr"}>
        <HifzSetupFlow db={db} language={language} isDark={false} s={text} initialPlan={initialPlan} onDone={jest.fn()} onCancel={jest.fn()} />
      </DirectionProvider>,
    );
    await act(async () => {});
    for (let step = 0; step < 4; step += 1) fireEvent.press(view.getByText(text.hifzContinue));
    expect(view.getByText(text.hifzPaceTitle)).toBeTruthy();
    return view;
  }

  async function saveAndReadPlan(view: Awaited<ReturnType<typeof openPace>>): Promise<HifzPlan> {
    fireEvent.press(view.getByText(s.hifzContinue));
    await act(async () => {
      fireEvent.press(view.getByText(s.hifzSaveMemorized));
    });
    expect(applyHifzSetup).toHaveBeenCalledTimes(1);
    return jest.mocked(applyHifzSetup).mock.calls[0][1].plan;
  }

  const radio = (view: Awaited<ReturnType<typeof openPace>>, name: string) => view.getByRole("radio", { name: new RegExp(name) });
  const checked = (view: Awaited<ReturnType<typeof openPace>>, name: string) => radio(view, name).props.accessibilityState?.checked;

  it("opens on the saved plan's goal and pace, and a review-only plan without repetition counts", async () => {
    const view = await openPace(applyPreset(savedPlan, "maintenance"));
    expect(checked(view, s.hifzPresetMaintenance)).toBe(true);
    expect(view.queryByText(s.hifzRepsTitle)).toBeNull();
  });

  it("does not bring back a unit chosen on a step that was skipped", async () => {
    const view = render(
      <DirectionProvider dir="ltr">
        <HifzSetupFlow db={db} language="en" isDark={false} s={s} initialPlan={{ ...savedPlan, unit: "page" }} onDone={jest.fn()} onCancel={jest.fn()} />
      </DirectionProvider>,
    );
    await act(async () => {});
    for (let step = 0; step < 2; step += 1) fireEvent.press(view.getByText(s.hifzContinue));
    // On the tracks step: choose ayah, then skip the step, which drops that choice.
    fireEvent.press(radio(view, s.hifzUnitAyah));
    fireEvent.press(view.getByText(s.hifzNotNow));
    expect(view.getByText(s.meaningsStepTitle)).toBeTruthy();
    fireEvent.press(view.getByText(s.hifzContinue));
    expect(view.getByText(s.hifzPaceTitle)).toBeTruthy();
    fireEvent.press(radio(view, s.hifzPresetFullTime));
    expect((await saveAndReadPlan(view)).unit).toBe("page");
  });

  it("restores the unit chosen earlier when a pace other than short surahs is picked", async () => {
    const view = await openPace({ ...savedPlan, unit: "page" });
    fireEvent.press(radio(view, s.hifzPresetShort));
    expect(view.getByText(new RegExp(s.hifzPresetAyahByAyah.replace(".", "\\.")))).toBeTruthy();
    fireEvent.press(radio(view, s.hifzPresetFullTime));
    expect((await saveAndReadPlan(view)).unit).toBe("page");
  });

  it("keeps onboarding on the default counts without asking", async () => {
    const view = await openPace(null);
    expect(view.queryByText(s.hifzRepsTitle)).toBeNull();
  });

  it("saves the 20-times preset with the edited plan", async () => {
    const view = await openPace(savedPlan);
    // Each set of choices is one labelled group for screen readers. The group is not itself an
    // accessible element (that would hide its options on iOS), so it is found by its props.
    const groups = view.UNSAFE_getAllByProps({ accessibilityRole: "radiogroup" }).map((node) => node.props.accessibilityLabel);
    expect(groups).toEqual(expect.arrayContaining([s.hifzPaceTitle, s.hifzRepsTitle]));
    expect(checked(view, s.hifzRepsLookingThenMemory)).toBe(true);
    expect(view.getByText(/Attributed to Shaykh 'Abd al-Muhsin al-Qasim\. We have not verified its exact wording\./)).toBeTruthy();
    fireEvent.press(radio(view, s.hifzRepsTwentyTimes));
    expect(checked(view, s.hifzRepsTwentyTimes)).toBe(true);
    expect(checked(view, s.hifzRepsLookingThenMemory)).toBe(false);
    const plan = await saveAndReadPlan(view);
    expect(plan.memorizeRepetitions).toEqual({ listen: 3, looking: 20, cleanInARow: 3 });
    expect(plan.newPerDay).toBe(1);
  });

  it("saves custom counts and stops each at the end of its range", async () => {
    const view = await openPace(savedPlan);
    expect(view.queryByLabelText("More: Reads while looking")).toBeNull();
    fireEvent.press(radio(view, s.hifzRepsCustom));
    expect(checked(view, s.hifzRepsCustom)).toBe(true);
    for (let tap = 0; tap < 5; tap += 1) fireEvent.press(view.getByLabelText("More: Reads while looking"));
    expect(view.getByText("15")).toBeTruthy();
    // Clean in a row stops at 1 and listening at 5.
    for (let tap = 0; tap < 3; tap += 1) fireEvent.press(view.getByLabelText("Fewer: Clean recitations"));
    expect(view.getByLabelText("Fewer: Clean recitations").props.accessibilityState).toMatchObject({ disabled: true });
    for (let tap = 0; tap < 3; tap += 1) fireEvent.press(view.getByLabelText("More: Listens"));
    expect(view.getByLabelText("More: Listens").props.accessibilityState).toMatchObject({ disabled: true });
    const plan = await saveAndReadPlan(view);
    expect(plan.memorizeRepetitions).toEqual({ listen: 5, looking: 15, cleanInARow: 1 });
  });

  it("opens a plan's custom counts as custom, and a preset replaces them", async () => {
    const view = await openPace({ ...savedPlan, memorizeRepetitions: { listen: 2, looking: 12, cleanInARow: 4 } });
    expect(checked(view, s.hifzRepsCustom)).toBe(true);
    expect(view.getByText("12")).toBeTruthy();
    fireEvent.press(radio(view, s.hifzRepsLookingThenMemory));
    expect(view.queryByLabelText("More: Reads while looking")).toBeNull();
    const plan = await saveAndReadPlan(view);
    expect(plan.memorizeRepetitions).toEqual({ listen: 3, looking: 10, cleanInARow: 3 });
  });

  it("drops the counts when the goal is only to keep what is memorized", async () => {
    const view = render(
      <DirectionProvider dir="ltr">
        <HifzSetupFlow db={db} language="en" isDark={false} s={s} initialPlan={savedPlan} onDone={jest.fn()} onCancel={jest.fn()} />
      </DirectionProvider>,
    );
    await act(async () => {});
    fireEvent.press(view.getByText(s.hifzGoalKeep));
    for (let step = 0; step < 4; step += 1) fireEvent.press(view.getByText(s.hifzContinue));
    expect(view.getByText(s.hifzPaceTitle)).toBeTruthy();
    expect(view.queryByText(s.hifzRepsTitle)).toBeNull();
  });

  it("labels the counts in Arabic with Arabic digits", async () => {
    const ar = strings.ar;
    const view = await openPace({ ...savedPlan, memorizeRepetitions: { listen: 2, looking: 12, cleanInARow: 4 } }, "ar");
    expect(view.getByText(ar.hifzRepsTitle)).toBeTruthy();
    expect(view.getByText("١٢")).toBeTruthy();
    expect(view.getByLabelText(`أكثر: ${ar.hifzRepsLooking}`)).toBeTruthy();
  });
});

describe("the notice after saving a plan (7.6)", () => {
  const base = {
    plan: DEFAULT_HIFZ_PLAN,
    declaredPages: 0,
    migratedPages: 0,
    firstPlan: false,
    unitSwitched: false,
    unitChanged: false,
    repetitionsChanged: false,
  };
  it("says only what the save changes", () => {
    expect(setupSavedNotice({ ...base, firstPlan: true }, strings.en, "en")).toBe(strings.en.hifzPlanSavedFirst);
    expect(setupSavedNotice(base, strings.en, "en")).toBe(strings.en.hifzPlanSavedReview);
    expect(setupSavedNotice({ ...base, repetitionsChanged: true }, strings.en, "en")).toBe(strings.en.hifzPlanSaved);
    expect(
      setupSavedNotice({ ...base, repetitionsChanged: true, plan: { ...DEFAULT_HIFZ_PLAN, method: "review_only" } }, strings.en, "en"),
    ).toBe(strings.en.hifzPlanSavedReview);
    expect(setupSavedNotice({ ...base, unitSwitched: true, migratedPages: 3 }, strings.en, "en")).toBe(
      "Plan saved. 3 pages you reviewed ayah by ayah now review as whole pages. Their schedule is kept.",
    );
    expect(setupSavedNotice({ ...base, unitSwitched: true, plan: { ...DEFAULT_HIFZ_PLAN, unit: "ayah" } }, strings.en, "en")).toBe(
      strings.en.hifzPlanSavedToAyat,
    );
    // Page to half page applies to the next review, not from tomorrow.
    expect(setupSavedNotice({ ...base, unitChanged: true, plan: { ...DEFAULT_HIFZ_PLAN, unit: "half" } }, strings.en, "en")).toBe(
      strings.en.hifzPlanSavedUnitHalf,
    );
  });
});

describe("HifzSetupFlow save and surah list recovery", () => {
  const surahRows = [
    { number: 1, name_arabic: "الفاتحة", name_english: "The Opening", ayah_count: 7 },
    { number: 67, name_arabic: "الملك", name_english: "The Sovereignty", ayah_count: 30 },
    { number: 68, name_arabic: "القلم", name_english: "The Pen", ayah_count: 52 },
  ];
  beforeEach(() => jest.mocked(applyHifzSetup).mockReset());

  function renderFlow(db: AppDatabase, onDone = jest.fn()) {
    return render(
      <DirectionProvider dir="ltr">
        <HifzSetupFlow db={db} language="en" isDark={false} s={s} initialPlan={null} onDone={onDone} onCancel={jest.fn()} />
      </DirectionProvider>,
    );
  }

  it("keeps the step and draft after a failed save, locks Back while saving and saves once on retry", async () => {
    const db = { getAllAsync: jest.fn(async () => surahRows) } as unknown as AppDatabase;
    const onDone = jest.fn();
    let failSave: (error: Error) => void = () => {};
    jest.mocked(applyHifzSetup).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failSave = reject;
        }),
    );
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const view = renderFlow(db, onDone);
    await act(async () => {});
    fireEvent.press(view.getByText(s.hifzContinue));
    fireEvent.press(view.getByLabelText("Juz 30"));
    for (let step = 0; step < 4; step += 1) fireEvent.press(view.getByText(s.hifzContinue));
    fireEvent.press(view.getByText(s.hifzSaveMemorized));
    // Pending: both controls report busy and Back cannot leave the step.
    expect(view.getByText(s.hifzSaving)).toBeTruthy();
    const back = view.getByRole("button", { name: s.hifzBack });
    expect(back.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await act(async () => failSave(new Error("synthetic save failure")));
    expect(view.getByText(s.hifzSaveFailedGeneric)).toBeTruthy();
    expect(view.getByText(s.hifzWhenTitle)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    jest.mocked(applyHifzSetup).mockResolvedValueOnce({ declaredPages: 20, migratedPages: 0 } as never);
    await act(async () => fireEvent.press(view.getByText(s.hifzSaveMemorized)));
    expect(applyHifzSetup).toHaveBeenCalledTimes(2);
    expect(jest.mocked(applyHifzSetup).mock.calls[1][1].memorizedJuz).toEqual([30]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("offers Retry when the surah list fails to load", async () => {
    const getAllAsync = jest.fn().mockRejectedValueOnce(new Error("synthetic load failure")).mockResolvedValue(surahRows);
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const view = renderFlow({ getAllAsync } as unknown as AppDatabase);
    await act(async () => {});
    fireEvent.press(view.getByText(s.hifzContinue));
    fireEvent.press(view.getByText(s.hifzBySurah));
    expect(view.getByText(s.setupSurahsLoadFailed)).toBeTruthy();
    await act(async () => fireEvent.press(view.getByText(s.setupRetry)));
    expect(view.queryByText(s.setupSurahsLoadFailed)).toBeNull();
    expect(view.getByText("67. Al-Mulk")).toBeTruthy();
    expect(view.getByText("30 ayahs")).toBeTruthy();
  });

  it("selects only the filtered surahs and keeps earlier choices", async () => {
    const view = renderFlow({ getAllAsync: jest.fn(async () => surahRows) } as unknown as AppDatabase);
    await act(async () => {});
    fireEvent.press(view.getByText(s.hifzContinue));
    fireEvent.press(view.getByText(s.hifzBySurah));
    fireEvent.press(view.getByText("1. Al-Fatiha"));
    fireEvent.changeText(view.getByPlaceholderText(s.setupSurahSearchPlaceholder), "Mulk");
    fireEvent.press(view.getByText(s.setupSelectResults));
    fireEvent.changeText(view.getByPlaceholderText(s.setupSurahSearchPlaceholder), "zzz");
    expect(view.getByText(s.setupNoSurahMatches.replace("{{query}}", "zzz"))).toBeTruthy();
    fireEvent.press(view.getByText(s.homeSearchClear));
    expect(view.getByText("2 surahs")).toBeTruthy();
    expect(view.getByLabelText("Remove Al-Fatiha")).toBeTruthy();
    expect(view.getByLabelText("Remove Al-Mulk")).toBeTruthy();
  });

  it("shows the selection above the surah list as removable chips in Quran order", async () => {
    const view = renderFlow({ getAllAsync: jest.fn(async () => surahRows) } as unknown as AppDatabase);
    await act(async () => {});
    fireEvent.press(view.getByText(s.hifzContinue));
    fireEvent.press(view.getByLabelText("Juz 30"));
    fireEvent.press(view.getByText(s.hifzBySurah));
    fireEvent.press(view.getByText("68. Al-Qalam"));
    fireEvent.press(view.getByText("1. Al-Fatiha"));

    // The count comes before the first surah row, so it is seen without scrolling the list.
    const tree = JSON.stringify(view.toJSON());
    expect(tree.indexOf("1 juz · 2 surahs")).toBeGreaterThan(-1);
    expect(tree.indexOf("1 juz · 2 surahs")).toBeLessThan(tree.indexOf("1. Al-Fatiha"));
    // Juz first, then surahs by number, whatever order they were chosen in.
    const chips = view.getAllByLabelText(/^Remove /).map((chip) => chip.props.accessibilityLabel);
    expect(chips).toEqual(["Remove Juz 30", "Remove Al-Fatiha", "Remove Al-Qalam"]);

    fireEvent.press(view.getByLabelText("Remove Al-Qalam"));
    expect(view.queryByLabelText("Remove Al-Qalam")).toBeNull();
    expect(view.getByRole("checkbox", { name: /68\. Al-Qalam/ }).props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(view.getByLabelText("Remove Juz 30"));
    expect(view.getByText("1 surah")).toBeTruthy();
  });

  it("collapses a long selection behind a +N chip", async () => {
    const view = renderFlow({ getAllAsync: jest.fn(async () => surahRows) } as unknown as AppDatabase);
    await act(async () => {});
    fireEvent.press(view.getByText(s.hifzContinue));
    for (const juz of [1, 2, 3, 4, 5, 6, 7, 8]) fireEvent.press(view.getByLabelText(`Juz ${juz}`));
    expect(view.getAllByLabelText(/^Remove /)).toHaveLength(6);
    fireEvent.press(view.getByText("+2"));
    expect(view.getAllByLabelText(/^Remove /)).toHaveLength(8);
    expect(view.getByLabelText(s.sharedShowLess)).toBeTruthy();
  });

  it("marks surahs a chosen juz includes, and keeps the surah view across Back and Continue", async () => {
    const rows = [
      { ...surahRows[0], first_page: 1, last_page: 1 },
      { ...surahRows[1], first_page: 562, last_page: 564 },
      { number: 78, name_arabic: "النبأ", name_english: "The Tidings", ayah_count: 40, first_page: 582, last_page: 583 },
    ];
    const view = renderFlow({ getAllAsync: jest.fn(async () => rows) } as unknown as AppDatabase);
    await act(async () => {});
    fireEvent.press(view.getByText(s.hifzContinue));
    fireEvent.press(view.getByLabelText("Juz 30"));
    fireEvent.press(view.getByText(s.hifzBySurah));
    expect(view.getByRole("checkbox", { name: /78\. An-Naba/ })).toBeTruthy();
    expect(view.getAllByText("Included in Juz 30")).toHaveLength(1);

    fireEvent.press(view.getByText(s.hifzContinue));
    fireEvent.press(view.getByText(s.hifzBack));
    expect(view.getByPlaceholderText(s.setupSurahSearchPlaceholder)).toBeTruthy();
  });
});

describe("HifzSetupFlow word meanings step (SPEC 3.6)", () => {
  beforeEach(() => jest.mocked(applyHifzSetup).mockReset());

  async function openMeanings(db: AppDatabase) {
    const view = render(
      <DirectionProvider dir="ltr">
        <HifzSetupFlow db={db} language="en" isDark={false} s={s} initialPlan={null} onDone={jest.fn()} onCancel={jest.fn()} />
      </DirectionProvider>,
    );
    await act(async () => {});
    for (let step = 0; step < 3; step += 1) fireEvent.press(view.getByText(s.hifzContinue));
    expect(view.getByText(s.meaningsStepTitle)).toBeTruthy();
    return view;
  }
  async function saveFrom(view: ReturnType<typeof render>) {
    for (let step = 0; step < 2; step += 1) fireEvent.press(view.getByText(s.hifzContinue));
    await act(async () => fireEvent.press(view.getByText(s.hifzSaveMemorized)));
    return jest.mocked(applyHifzSetup).mock.calls.at(-1)![1];
  }
  const radio = (view: ReturnType<typeof render>, name: string) => view.getByRole("radio", { name: new RegExp(`^${name}`) });

  it("saves the answers' level and language with the plan", async () => {
    const view = await openMeanings({ getAllAsync: jest.fn(async () => []) } as unknown as AppDatabase);
    fireEvent.press(radio(view, s.meaningsRateArabic2));
    fireEvent.press(radio(view, s.meaningsRateRecited2));
    fireEvent.press(radio(view, s.meaningsChooseForMe));
    // Two and two of six is level 3; simple sentences suggest Arabic meanings.
    expect(view.getByText("You know the commonest 700 words.")).toBeTruthy();
    expect((await saveFrom(view)).meanings).toEqual({ inDailyStudy: true, language: "ar", languagePicked: false, level: 3 });
  });

  it("drops the step's changes on Not now and saves the defaults", async () => {
    const view = await openMeanings({ getAllAsync: jest.fn(async () => []) } as unknown as AppDatabase);
    fireEvent.press(view.getByRole("switch", { name: s.studyDecksMeaningsHint }));
    fireEvent.press(view.getByText(s.hifzNotNow));
    fireEvent.press(view.getByText(s.hifzContinue));
    await act(async () => fireEvent.press(view.getByText(s.hifzSaveMemorized)));
    expect(jest.mocked(applyHifzSetup).mock.calls.at(-1)![1].meanings).toEqual({ inDailyStudy: true, language: "en", languagePicked: false, level: null });
  });

  it("keeps the stored choices that load after the first step when an earlier step is skipped", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stored = [
      { key: "habit_study_meanings", value: "false" },
      { key: "habit_meanings_language", value: "ar" },
      { key: "habit_meanings_level", value: "2" },
    ];
    const db = {
      getAllAsync: jest.fn(async (sql: string) => {
        if (!sql.includes("user_settings")) return [];
        await gate;
        return stored;
      }),
    } as unknown as AppDatabase;
    const view = render(
      <DirectionProvider dir="ltr">
        <HifzSetupFlow db={db} language="en" isDark={false} s={s} initialPlan={DEFAULT_HIFZ_PLAN} onDone={jest.fn()} onCancel={jest.fn()} />
      </DirectionProvider>,
    );
    await act(async () => {});
    // Continue on the goal step while the stored choices are still loading, then they arrive.
    fireEvent.press(view.getByText(s.hifzContinue));
    await act(async () => release());
    fireEvent.press(view.getByText(s.hifzNotNow));
    fireEvent.press(view.getByText(s.hifzContinue));
    expect(view.getByText(s.meaningsStepTitle)).toBeTruthy();
    expect(view.getByRole("switch", { name: s.studyDecksMeaningsHint }).props.accessibilityState).toMatchObject({ checked: false });
    expect((await saveFrom(view)).meanings).toEqual({ inDailyStudy: false, language: "ar", languagePicked: false, level: null });
  });

  it("leaves the stored choices alone when they did not load and the step was not changed", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const db = {
      getAllAsync: jest.fn(async (sql: string) => {
        if (sql.includes("user_settings")) throw new Error("synthetic settings failure");
        return [];
      }),
    } as unknown as AppDatabase;
    const view = await openMeanings(db);
    // A change undone by Not now counts as no change.
    fireEvent.press(view.getByRole("switch", { name: s.studyDecksMeaningsHint }));
    fireEvent.press(view.getByText(s.hifzNotNow));
    fireEvent.press(view.getByText(s.hifzContinue));
    await act(async () => fireEvent.press(view.getByText(s.hifzSaveMemorized)));
    expect(jest.mocked(applyHifzSetup).mock.calls.at(-1)![1].meanings).toBeUndefined();
  });
});
