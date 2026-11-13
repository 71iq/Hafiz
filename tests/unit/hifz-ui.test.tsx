import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { GradingButtons } from "@/components/flashcards/GradingButtons";
import { HifzSetupFlow } from "@/components/hifz/HifzSetupFlow";
import type { AppDatabase } from "@/lib/database/types";
import { Rating } from "@/lib/fsrs/scheduler";
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
