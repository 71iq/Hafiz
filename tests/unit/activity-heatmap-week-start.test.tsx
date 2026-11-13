import React from "react";
import { render } from "@testing-library/react-native";
import { ActivityHeatmap } from "@/components/progress/ActivityHeatmap";
import type { DayStatus } from "@/lib/habit/types";
import { strings } from "@/lib/i18n/strings";

jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => ({ themeColors: { surfaceHigh: "#eeeeee", surfaceMid: "#f4f4f4" } }) };
});

// Saturday 14 November 2026, midday local time.
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

/** Every one of the last 120 days is done, so each past cell carries a dated accessibility label. */
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
  return view
    .getAllByLabelText(/^\d{4}-\d{2}-\d{2}: /)
    .map((node) => String(node.props.accessibilityLabel).slice(0, 10));
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

    // Columns run oldest first; the first cell of every column is the week start, today is in the last.
    for (let index = 0; index < dates.length; index += 7) expect(weekdayOf(dates[index])).toBe(weekStart);
    expect(dates[dates.length - 1]).toBe(dateKey(NOW));
    expect(dates.length).toBe(12 * 7 + ((NOW.getDay() - weekStart + 7) % 7) + 1);

    expect(view.getAllByText(/^(Mon|Wed|Fri)$/).map((node) => node.props.children)).toEqual(labelOrder);
  });

  it("keeps Sunday columns when no week start is given, as on a public profile", () => {
    const dates = cellDates(renderHeatmap());
    expect(weekdayOf(dates[0])).toBe(0);
  });
});
