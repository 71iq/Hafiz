import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { WirdPlanCard } from "@/components/hifz/WirdPlanCard";
import type { TodayWird } from "@/lib/hifz/pages";
import { strings } from "@/lib/i18n/strings";

const s = strings.en;

/** Only the fields the card reads. */
function wird(overrides: { backlog?: boolean; newLines?: number; todo?: number } = {}): TodayWird {
  const page = { cardId: "page:madani15:1", tier: "sabqi" } as TodayWird["todo"][number];
  return {
    daily: { backlog: overrides.backlog ?? false },
    todo: Array.from({ length: overrides.todo ?? 0 }, () => page),
    done: [page],
    newLines: overrides.newLines ?? 0,
    remainingMinutes: 3,
    memorizedPages: 1,
  } as unknown as TodayWird;
}

function renderCard(props: { wird: TodayWird; secondLooksDue?: number; language?: "en" | "ar" }) {
  const handlers = { onStartReview: jest.fn(), onStartSabaq: jest.fn(), onSetup: jest.fn(), onDrill: jest.fn() };
  const view = render(
    <WirdPlanCard
      wird={props.wird}
      inboxCount={0}
      secondLooksDue={props.secondLooksDue}
      language={props.language ?? "en"}
      isDark={false}
      s={props.language === "ar" ? strings.ar : s}
      {...handlers}
    />,
  );
  return { view, handlers };
}

describe("Home's second-look cue (SBQ-03)", () => {
  it("is absent when no second look is due", () => {
    const { view } = renderCard({ wird: wird() });
    expect(view.queryByText(s.hifzSecondLookReady)).toBeNull();
  });

  it.each([
    ["a complete wird with no new lines", wird()],
    ["a backlog, which hides new lines", wird({ backlog: true, newLines: 5, todo: 2 })],
  ])("opens sabaq from %s", (_label, today) => {
    const { view, handlers } = renderCard({ wird: today, secondLooksDue: 1 });
    expect(view.queryByText(s.hifzSabaqStart)).toBeNull();
    fireEvent.press(view.getByRole("button", { name: `${s.hifzSecondLookReady}, ${s.hifzSecondLookAction}` }));
    expect(handlers.onStartSabaq).toHaveBeenCalledTimes(1);
  });

  it("reads in Arabic", () => {
    const { view } = renderCard({ wird: wird(), secondLooksDue: 2, language: "ar" });
    expect(view.getByText(strings.ar.hifzSecondLookReady)).toBeTruthy();
    expect(view.getByText(strings.ar.hifzSecondLookAction)).toBeTruthy();
  });
});
