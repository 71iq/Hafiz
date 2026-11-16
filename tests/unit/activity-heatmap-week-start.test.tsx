import React from "react";
import { Platform } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { ActivityHeatmap } from "@/components/progress/ActivityHeatmap";
import type { DayStatus } from "@/lib/habit/types";
import { strings } from "@/lib/i18n/strings";

jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => ({ themeColors: { surfaceHigh: "#eeeeee", surfaceMid: "#f4f4f4" } }) };
});

const NOW = new Date(2026, 10, 14, 12);

function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function weekdayOf(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

function doneDays(): Map<string, DayStatus> {
  const map = new Map<string, DayStatus>();
  for (let back = 0; back < 120; back++) {
    const date = new Date(NOW);
    date.setDate(date.getDate() - back);
    map.set(dateKey(date), "done");
  }
  return map;
}

function renderHeatmap(weekStart?: number) {
  return render(
    <ActivityHeatmap data={[]} isDark={false} s={strings.en} dayStatuses={doneDays()} weekStart={weekStart} />,
  );
}

function cellDates(view: ReturnType<typeof render>): string[] {
  return view.getAllByTestId(/^heatmap-day-/).map((node) => String(node.props.testID).slice("heatmap-day-".length));
}

describe("ActivityHeatmap week start", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    [0, ["Mon", "Wed", "Fri"]],
    [1, ["Mon", "Wed", "Fri"]],
    [4, ["Fri", "Mon", "Wed"]],
    [6, ["Mon", "Wed", "Fri"]],
  ])("starts each column on day %i and labels the rows those days fall on", (weekStart, labelOrder) => {
    const view = renderHeatmap(weekStart);
    const dates = cellDates(view);

    for (let index = 0; index < dates.length; index += 7) expect(weekdayOf(dates[index])).toBe(weekStart);
    expect(dates[dates.length - 1]).toBe(dateKey(NOW));
    expect(dates.length).toBe(12 * 7 + ((NOW.getDay() - weekStart + 7) % 7) + 1);

    expect(view.getAllByLabelText(/^(Monday|Wednesday|Friday)$/).map((node) => node.props.children)).toEqual(
      labelOrder,
    );
  });

  it("keeps Sunday columns when no week start is given, as on a public profile", () => {
    const dates = cellDates(renderHeatmap());
    expect(weekdayOf(dates[0])).toBe(0);
  });
});

describe("ActivityHeatmap day access", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const data = [{ date: "2026-11-13", count: 3 }];
  const statuses = new Map<string, DayStatus>([["2026-11-13", "done"]]);

  it("inspects every day, including zero days, from the labeled selector with 44px controls", () => {
    const view = render(
      <ActivityHeatmap data={data} isDark={false} s={strings.en} dayStatuses={statuses} weekStart={6} />,
    );
    expect(view.getByText("Today · Sat, 14 Nov: 0 reviews")).toBeTruthy();
    const next = view.getByLabelText(strings.en.heatmapNextDay);
    expect(next.props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(view.getByLabelText(strings.en.heatmapPreviousDay));
    expect(view.getByText("Fri, 13 Nov: 3 reviews")).toBeTruthy();
    fireEvent.press(view.getByText("Fri, 13 Nov: 3 reviews"));
    expect(view.getByText("Friday, 13 November 2026")).toBeTruthy();
    expect(view.getByText("3 reviews · Wird")).toBeTruthy();

    const cell = view.getByTestId("heatmap-day-2026-11-13");
    expect(cell.props.accessibilityLabel).toBe("Friday, 13 November 2026: 3 reviews, Wird");
    expect(view.getByTestId("heatmap-day-2026-11-12").props.accessibilityLabel).toBe(
      "Thursday, 12 November 2026: 0 reviews",
    );
    expect(cell.props.hitSlop).toBeUndefined();
  });

  it("shows Less and More around the localized intensity ranges", () => {
    const arabic = render(<ActivityHeatmap data={data} isDark={false} s={strings.ar} isRTL />);
    for (const label of [strings.ar.heatmapLess, "٠", "١–١٠", "١١–٢٥", "٢٦+", strings.ar.heatmapMore]) {
      expect(arabic.getByText(label)).toBeTruthy();
    }
    expect(arabic.getByText(`${strings.ar.heatmapToday} · السبت ١٤ نوفمبر: ٠ مراجعة`)).toBeTruthy();
  });

  it.each([
    ["en", false, "ArrowLeft", "Sat, 7 Nov: 0 reviews"],
    ["ar", true, "ArrowRight", "السبت ٧ نوفمبر: ٠ مراجعة"],
  ] as const)("moves the roving focus by week with arrow keys in %s", (language, isRTL, earlierKey, label) => {
    jest.replaceProperty(Platform, "OS", "web");
    const view = render(
      <ActivityHeatmap data={data} isDark={false} s={strings[language]} isRTL={isRTL} weekStart={6} />,
    );
    const grid = view.getByLabelText(strings[language].heatmapCalendarLabel);
    const preventDefault = jest.fn();
    act(() => grid.props.onKeyDown({ key: earlierKey, preventDefault }));
    expect(preventDefault).toHaveBeenCalled();
    expect(view.getByText(label)).toBeTruthy();
    act(() => grid.props.onKeyDown({ key: "End", preventDefault }));
    expect(view.getByTestId("heatmap-day-2026-11-14").props.focusable).toBe(true);
    expect(view.getByTestId("heatmap-day-2026-11-07").props.focusable).toBe(false);
  });
});
