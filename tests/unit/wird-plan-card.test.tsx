import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { WirdPlanCard } from "@/components/hifz/WirdPlanCard";
import type { TodayWird } from "@/lib/hifz/pages";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";

const s = strings.en;

/** Only the fields the card reads. */
function wird(overrides: { backlog?: boolean; newLines?: number; todo?: number; unit?: "page" | "ayah" } = {}): TodayWird {
  const page = { cardId: "page:madani15:1", tier: "sabqi" } as TodayWird["todo"][number];
  return {
    plan: { unit: overrides.unit ?? "page" },
    daily: { backlog: overrides.backlog ?? false },
    todo: Array.from({ length: overrides.todo ?? 0 }, () => page),
    done: [page],
    total: 1 + (overrides.todo ?? 0),
    newLines: overrides.newLines ?? 0,
    remainingMinutes: 3,
    memorizedPages: 1,
  } as unknown as TodayWird;
}

function renderCard(props: { wird: TodayWird; secondLooksDue?: number; nextLookAt?: Date | null; ayahDue?: number; language?: "en" | "ar" }) {
  const handlers = { onStartReview: jest.fn(), onStartSabaq: jest.fn(), onSetup: jest.fn(), onDrill: jest.fn() };
  const view = render(
    <WirdPlanCard
      wird={props.wird}
      inboxCount={0}
      secondLooksDue={props.secondLooksDue}
      nextLookAt={props.nextLookAt}
      ayahDue={props.ayahDue}
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
    const page = { cardId: "page:madani15:1", tier: "manzil" } as TodayWird["todo"][number];
    const today = { ...wird(), todo: [page], done: [page], total: 1 } as unknown as TodayWird;
    expect(renderCard({ wird: today }).view.getByText("1 / 1")).toBeTruthy();
  });

  it("in ayah review, says how many ayah cards are due and offers Start", () => {
    const today = { ...wird({ unit: "ayah" }), done: [], total: 0 } as unknown as TodayWird;
    const { view, handlers } = renderCard({ wird: today, ayahDue: 12 });
    expect(view.getByText(interpolate(s.hifzAyahModeDue, { n: "12" }))).toBeTruthy();
    fireEvent.press(view.getByText(s.hifzWirdStart));
    expect(handlers.onStartReview).toHaveBeenCalledTimes(1);
    const none = renderCard({ wird: today, ayahDue: 0 }).view;
    expect(none.getByText(s.hifzAyahModeNone)).toBeTruthy();
    expect(none.queryByText(s.hifzWirdStart)).toBeNull();
  });
});
