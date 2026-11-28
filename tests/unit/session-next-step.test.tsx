import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SessionNextStep, useNextStudyStep } from "@/components/habit/SessionNextStep";
import type { AppDatabase } from "@/lib/database/types";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import type { DailyQueue } from "@/lib/study/daily-queue";
import { DAILY_SESSION_HREF, loadStudyState, type StudyState } from "@/lib/study/resolve";

jest.mock("@/lib/study/resolve", () => ({
  ...jest.requireActual<typeof import("@/lib/study/resolve")>("@/lib/study/resolve"),
  loadStudyState: jest.fn(),
}));

/** The session end screens' buttons (SPEC 3.1). */
const s = strings.en;
const queue = (heldBack: number, left = 0) =>
  ({ heldBack, baseBudget: 20, cards: Array.from({ length: left }, () => ({})) }) as unknown as DailyQueue;
const state = (step: StudyState["step"], held = 0, left = 0): StudyState => ({
  step,
  queue: queue(held, left),
  remediationDue: 0,
  memorizeOpen: false,
  secondLooksDue: 0,
  planLeft: 0,
});

function renderStep(props: Partial<React.ComponentProps<typeof SessionNextStep>> & { state: StudyState | null }) {
  const handlers = { onContinue: jest.fn(), onStudyMore: jest.fn(async () => {}), onDone: jest.fn() };
  const view = render(<SessionNextStep commitment={null} language="en" s={s} {...handlers} {...props} />);
  return { view, handlers };
}

describe("SessionNextStep", () => {
  it("shows Done alone while the resolver loads, so leaving never waits", () => {
    const { view, handlers } = renderStep({ state: null });
    fireEvent.press(view.getByText(s.flashcardsSummaryDone));
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
    expect(view.queryByText(s.studyContinue)).toBeNull();
  });

  it("offers Continue, naming the step, and Done for now when a step is left", () => {
    const step = { kind: "cards", href: DAILY_SESSION_HREF } as const;
    const { view, handlers } = renderStep({ state: state(step) });
    expect(view.getByText(interpolate(s.studyNext, { step: s.studyStepCards }))).toBeTruthy();
    fireEvent.press(view.getByText(s.studyContinue));
    expect(handlers.onContinue).toHaveBeenCalledWith(step);
    fireEvent.press(view.getByText(s.studyDoneForNow));
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
  });

  it("offers Study more with what it adds when only the budget holds cards back", async () => {
    const { view, handlers } = renderStep({ state: state({ kind: "home", reason: "done" }, 45) });
    expect(view.getByText(interpolate(s.studyMoreAdds, { cards: "20 cards" }))).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText(s.studyMore));
    });
    expect(handlers.onStudyMore).toHaveBeenCalledTimes(1);
    expect(view.getByText(s.flashcardsSummaryDone)).toBeTruthy();
  });

  it("never spends a Study more press while cards inside today's budget are left", () => {
    // A user without a plan reaches Home's step with the base budget unspent.
    const { view } = renderStep({ state: state({ kind: "home", reason: "no_plan" }, 5, 20) });
    expect(view.queryByText(s.studyMore)).toBeNull();
    expect(view.getByText(s.flashcardsSummaryDone)).toBeTruthy();
  });

  it("offers Done alone when nothing is left, and the commitment replaces its text", () => {
    const { view } = renderStep({ state: state({ kind: "home", reason: "done" }), commitment: "Back after Fajr" });
    expect(view.getByText("Back after Fajr")).toBeTruthy();
    expect(view.queryByText(s.studyMore)).toBeNull();
    expect(view.queryByText(s.studyContinue)).toBeNull();
  });

  it("leaves Continue out when the screen offers its own next step", () => {
    const { view } = renderStep({ state: state({ kind: "memorize", href: "/hifz/memorize" }), ownContinue: true });
    expect(view.queryByText(s.studyContinue)).toBeNull();
    expect(view.getByText(s.flashcardsSummaryDone)).toBeTruthy();
  });

  it("names the step in Arabic", () => {
    const view = render(
      <SessionNextStep
        state={state({ kind: "review", href: "/hifz/review" })}
        commitment={null}
        onContinue={jest.fn()}
        onStudyMore={jest.fn(async () => {})}
        onDone={jest.fn()}
        language="ar"
        s={strings.ar}
      />,
    );
    expect(view.getByText(interpolate(strings.ar.studyNext, { step: strings.ar.studyStepReview }))).toBeTruthy();
    expect(view.getByText(strings.ar.studyDoneForNow)).toBeTruthy();
  });
});

describe("useNextStudyStep", () => {
  const db = {} as AppDatabase;
  function Probe({ ready }: { ready: boolean }) {
    const next = useNextStudyStep(db, ready);
    return <>{next ? <TextProbe value={next.step.kind} /> : null}</>;
  }
  function TextProbe({ value }: { value: string }) {
    const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return <Text>{value}</Text>;
  }

  it("asks the resolver only on an end screen, and drops the answer when the screen moves on", async () => {
    jest.mocked(loadStudyState).mockResolvedValue(state({ kind: "cards", href: DAILY_SESSION_HREF }));
    const view = render(<Probe ready={false} />);
    expect(loadStudyState).not.toHaveBeenCalled();
    view.rerender(<Probe ready />);
    await waitFor(() => expect(view.getByText("cards")).toBeTruthy());
    view.rerender(<Probe ready={false} />);
    expect(view.queryByText("cards")).toBeNull();
  });
});
