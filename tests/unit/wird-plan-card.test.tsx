import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { WirdPlanCard } from "@/components/hifz/WirdPlanCard";
import type { TodayWird } from "@/lib/hifz/pages";
import type { TodayPart } from "@/lib/study/today";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";

const s = strings.en;

/** Only the fields the card reads. */
function wird(
  overrides: { backlog?: boolean; newLines?: number; linesToday?: number; todo?: number; unit?: "page" | "ayah" } = {},
): TodayWird {
  const page = { cardId: "page:madani15:1", tier: "recent" } as TodayWird["todo"][number];
  return {
    plan: { unit: overrides.unit ?? "page" },
    daily: { backlog: overrides.backlog ?? false },
    todo: Array.from({ length: overrides.todo ?? 0 }, () => page),
    done: [page],
    total: 1 + (overrides.todo ?? 0),
    newLines: overrides.newLines ?? 0,
    memorizeLinesToday: overrides.linesToday ?? 0,
    memorizeDoneToday: (overrides.linesToday ?? 0) >= (overrides.newLines ?? 0) && (overrides.linesToday ?? 0) > 0,
    remainingMinutes: 3,
    memorizedPages: 1,
  } as unknown as TodayWird;
}

function renderCard(props: {
  wird: TodayWird | null;
  parts?: readonly TodayPart[] | null;
  secondLooksDue?: number;
  nextLookAt?: Date | null;
  language?: "en" | "ar";
}) {
  const handlers = { onStartMemorize: jest.fn() };
  const view = render(
    <WirdPlanCard
      wird={props.wird}
      parts={props.parts ?? null}
      deckTitle={(deckId) => `deck ${deckId}`}
      secondLooksDue={props.secondLooksDue}
      nextLookAt={props.nextLookAt}
      language={props.language ?? "en"}
      isDark={false}
      s={props.language === "ar" ? strings.ar : s}
      {...handlers}
    />,
  );
  return { view, handlers };
}

describe("the Today card's parts (SPEC 3.3)", () => {
  const parts: TodayPart[] = [
    { kind: "review", count: 2, unit: "pages", done: false },
    { kind: "memorize", count: 3, done: false },
    { kind: "deck", deckId: "mut", count: 0, done: true },
    { kind: "deck", deckId: "tails", count: 4, done: false },
  ];

  it("lists each part with what is left, and a finished part without a count", () => {
    const { view } = renderCard({ wird: wird({ newLines: 7, linesToday: 4, todo: 2 }), parts });
    expect(view.getByLabelText(`${s.studyStepReview}, 2`)).toBeTruthy();
    expect(view.getByLabelText(`${s.studyPartNewLines}, 3 lines`)).toBeTruthy();
    expect(view.getByLabelText(`deck mut, ${s.flashcardsSummaryDone}`)).toBeTruthy();
    expect(view.getByLabelText("deck tails, 4 cards")).toBeTruthy();
  });

  it("counts an ayah plan's review in ayat, in Arabic too", () => {
    const today = { ...wird({ unit: "ayah" }), done: [], total: 0 } as unknown as TodayWird;
    const ayahParts: TodayPart[] = [{ kind: "review", count: 12, unit: "ayahs", done: false }];
    expect(renderCard({ wird: today, parts: ayahParts }).view.getByLabelText(`${s.studyStepReview}, 12 ayahs`)).toBeTruthy();
    const ar = renderCard({ wird: today, parts: ayahParts, language: "ar" }).view;
    expect(ar.getByLabelText(`${strings.ar.studyStepReview}, ١٢ آية`)).toBeTruthy();
  });

  it("has no Start of its own: the Study button above starts the work", () => {
    const { view } = renderCard({ wird: wird({ newLines: 7, todo: 2 }), parts });
    expect(view.queryByText(s.hifzWirdStart)).toBeNull();
    expect(view.queryByText(s.hifzMemorizeStart)).toBeNull();
  });

  it("without a plan, explains the plan and leaves Set up to the header", () => {
    const { view } = renderCard({ wird: null });
    expect(view.getByText(s.hifzSetupTitle)).toBeTruthy();
    expect(view.queryByText(s.hifzSetupAction)).toBeNull();
  });
});

describe("Home's second-look cue (SBQ-03)", () => {
  it("is absent when no second look is due", () => {
    const { view } = renderCard({ wird: wird() });
    expect(view.queryByText(s.hifzSecondLookReady)).toBeNull();
  });

  it.each([
    ["a complete wird with no new lines", wird()],
    ["a backlog, which hides new lines", wird({ backlog: true, newLines: 5, todo: 2 })],
  ])("opens new memorization from %s", (_label, today) => {
    const { view, handlers } = renderCard({ wird: today, secondLooksDue: 1 });
    expect(view.queryByText(s.hifzMemorizeStart)).toBeNull();
    fireEvent.press(view.getByRole("button", { name: `${s.hifzSecondLookReady}, ${s.hifzSecondLookAction}` }));
    expect(handlers.onStartMemorize).toHaveBeenCalledTimes(1);
  });

  it("counts several due looks, in Arabic too", () => {
    expect(renderCard({ wird: wird(), secondLooksDue: 2 }).view.getByText("2 second looks ready")).toBeTruthy();
    const { view } = renderCard({ wird: wird(), secondLooksDue: 2, language: "ar" });
    expect(view.getByText(interpolate(strings.ar.hifzSecondLooksReady, { n: "٢" }))).toBeTruthy();
    expect(view.getByText(strings.ar.hifzSecondLookAction)).toBeTruthy();
  });

  it("says when the next look opens while none is due yet, and not once one is", () => {
    const nextLookAt = new Date(2026, 10, 14, 10, 0);
    expect(renderCard({ wird: wird(), nextLookAt }).view.getByText("Second look at 10:00 AM")).toBeTruthy();
    const due = renderCard({ wird: wird(), secondLooksDue: 1, nextLookAt }).view;
    expect(due.queryByText("Second look at 10:00 AM")).toBeNull();
    expect(due.getByText(s.hifzSecondLookReady)).toBeTruthy();
  });

  it("counts a page back on a learning step once in the day's total", () => {
    const page = { cardId: "page:madani15:1", tier: "long_term" } as TodayWird["todo"][number];
    const today = { ...wird(), todo: [page], done: [page], total: 1 } as unknown as TodayWird;
    expect(renderCard({ wird: today }).view.getByText("1 / 1")).toBeTruthy();
  });

  it("offers more lines once today's are done, and nothing before", () => {
    const { view: done, handlers } = renderCard({ wird: wird({ newLines: 7, linesToday: 12, todo: 2 }) });
    fireEvent.press(done.getByText(s.hifzMemorizeMore));
    expect(handlers.onStartMemorize).toHaveBeenCalledTimes(1);
    expect(renderCard({ wird: wird({ newLines: 7, todo: 2 }) }).view.queryByText(s.hifzMemorizeMore)).toBeNull();
  });
});
