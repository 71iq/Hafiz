import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { GradingButtons } from "@/components/flashcards/GradingButtons";
import { HifzSetupFlow, setupSavedNotice } from "@/components/hifz/HifzSetupFlow";
import type { AppDatabase } from "@/lib/database/types";
import { Rating } from "@/lib/fsrs/scheduler";
import { applyPreset, DEFAULT_HIFZ_PLAN, type HifzPlan } from "@/lib/hifz/plan";
import { applyHifzSetup } from "@/lib/hifz/setup";
import { strings } from "@/lib/i18n/strings";
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
    for (let step = 0; step < 4; step += 1) fireEvent.press(view.getByText(s.hifzContinue));
    expect(view.getByText(/^After Fajr, I will do my wird\./)).toBeTruthy();
    fireEvent.press(view.getByText(s.hifzWhenEvening));
    expect(view.getByText(/^In the evening, I will do my wird\./)).toBeTruthy();
  });
});

describe("HifzSetupFlow sabaq repetitions (SBQ-01)", () => {
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
    for (let step = 0; step < 3; step += 1) fireEvent.press(view.getByText(text.hifzContinue));
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
    expect(plan.sabaqRepetitions).toEqual({ listen: 3, looking: 20, cleanInARow: 3 });
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
    expect(plan.sabaqRepetitions).toEqual({ listen: 5, looking: 15, cleanInARow: 1 });
  });

  it("opens a plan's custom counts as custom, and a preset replaces them", async () => {
    const view = await openPace({ ...savedPlan, sabaqRepetitions: { listen: 2, looking: 12, cleanInARow: 4 } });
    expect(checked(view, s.hifzRepsCustom)).toBe(true);
    expect(view.getByText("12")).toBeTruthy();
    fireEvent.press(radio(view, s.hifzRepsLookingThenMemory));
    expect(view.queryByLabelText("More: Reads while looking")).toBeNull();
    const plan = await saveAndReadPlan(view);
    expect(plan.sabaqRepetitions).toEqual({ listen: 3, looking: 10, cleanInARow: 3 });
  });

  it("drops the counts when the goal is only to keep what is memorized", async () => {
    const view = render(
      <DirectionProvider dir="ltr">
        <HifzSetupFlow db={db} language="en" isDark={false} s={s} initialPlan={savedPlan} onDone={jest.fn()} onCancel={jest.fn()} />
      </DirectionProvider>,
    );
    await act(async () => {});
    fireEvent.press(view.getByText(s.hifzGoalKeep));
    for (let step = 0; step < 3; step += 1) fireEvent.press(view.getByText(s.hifzContinue));
    expect(view.getByText(s.hifzPaceTitle)).toBeTruthy();
    expect(view.queryByText(s.hifzRepsTitle)).toBeNull();
  });

  it("labels the counts in Arabic with Arabic digits", async () => {
    const ar = strings.ar;
    const view = await openPace({ ...savedPlan, sabaqRepetitions: { listen: 2, looking: 12, cleanInARow: 4 } }, "ar");
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
