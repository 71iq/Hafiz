import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { HabitBreakSheet } from "@/components/habit/HabitBreakSheet";
import { WirdStreakCard } from "@/components/habit/WirdStreakCard";
import { addDays, atLocalTime, localDateOf } from "@/lib/habit/dates";
import { makeUpCutoffFor } from "@/lib/habit/cutoff";
import { DEFAULT_WIRD_MINIMUM } from "@/lib/habit/minimum";
import { readHabitDayRow, type HabitOverview } from "@/lib/habit/queries";
import { buildHabitSnapshot } from "@/lib/habit/snapshot";
import type { DayStatus, HabitDay } from "@/lib/habit/types";
import { strings } from "@/lib/i18n/strings";
import { DirectionProvider } from "@/lib/ui/direction";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const mockSettings = {
  isDark: false,
  isRTL: false,
  uiLanguage: "en",
  themeSurface: "#ffffff",
  effectiveTheme: "white",
  themeColors: { surfaceHigh: "#eeeeee", surfaceMid: "#f4f4f4" },
};
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => mockSettings };
});

const TODAY = "2026-11-13";
const afternoon = atLocalTime(TODAY, 15 * 60);

function run(last: string, length: number, status: DayStatus = "done"): HabitDay[] {
  return Array.from({ length }, (_, i) => ({ localDate: addDays(last, -(length - 1 - i)), status, fullMet: false }));
}

function overview(days: HabitDay[], extra: Partial<HabitOverview> = {}, now = afternoon): HabitOverview {
  const snapshot = buildHabitSnapshot({
    days,
    today: TODAY,
    now,
    makeUpCutoff: makeUpCutoffFor(addDays(TODAY, -1)),
    pause: null,
    goal: extra.settings?.goal ?? null,
  });
  return {
    ...snapshot,
    settings: { minimum: DEFAULT_WIRD_MINIMUM, studyCountsTowardMinimum: false, goal: null, pause: null, weekStart: null, showZayt: true },
    days,
    minimumProgressToday: 0.4,
    ...extra,
  };
}

function renderCard(value: HabitOverview, language: "en" | "ar" = "en", handlers: Partial<React.ComponentProps<typeof WirdStreakCard>> = {}) {
  return render(
    <DirectionProvider dir={language === "ar" ? "rtl" : "ltr"}>
      <WirdStreakCard
        overview={value}
        language={language}
        isDark={false}
        s={strings[language]}
        graceNoteDismissed={false}
        onDismissGraceNote={jest.fn()}
        onOpenBreak={jest.fn()}
        {...handlers}
      />
    </DirectionProvider>,
  );
}

describe("WirdStreakCard", () => {
  const s = strings.en;

  it("shows the alive streak on the at-risk day with progress toward the minimum (STR-03)", () => {
    const view = renderCard(overview(run(addDays(TODAY, -1), 12)));
    expect(view.getByText("12")).toBeTruthy();
    expect(view.getByText(s.habitAtRisk)).toBeTruthy();
    expect(view.getByText("Minimum: 1 page or 5 minutes")).toBeTruthy();
  });

  it("names the make-up window with its cutoff time", () => {
    const morning = atLocalTime(TODAY, 9 * 60);
    const view = renderCard(overview(run(addDays(TODAY, -2), 5), {}, morning));
    expect(view.getByText(/Yesterday's wird can still be made up before/)).toBeTruthy();
    expect(view.getByText("5")).toBeTruthy();
  });

  it("shows earn-back progress with three dots and frames a broken short streak as a fresh start", () => {
    const earnBack = renderCard(overview([...run(addDays(TODAY, -3), 9), ...run(TODAY, 1)]));
    expect(earnBack.getByText("Your 9-day streak paused. Recite on 3 days to bring it back.")).toBeTruthy();
    expect(earnBack.getByText("1 of 3 days")).toBeTruthy();
    const fresh = renderCard(overview(run(addDays(TODAY, -3), 4)));
    expect(fresh.getByText(/A new streak begins today|A fresh week and a new streak/)).toBeTruthy();
  });

  it("shows a grace note that can be dismissed, and opens the break sheet", () => {
    const onDismissGraceNote = jest.fn();
    const onOpenBreak = jest.fn();
    const days = [...run(addDays(TODAY, -2), 9), { localDate: addDays(TODAY, -1), status: "grace" as const, fullMet: false }];
    const view = renderCard(overview(days), "en", { onDismissGraceNote, onOpenBreak });
    expect(view.getByText(/A grace day kept your streak/)).toBeTruthy();
    fireEvent.press(view.getByLabelText(s.habitDismiss));
    expect(onDismissGraceNote).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByText(s.habitTakeBreak));
    expect(onOpenBreak).toHaveBeenCalledTimes(1);
  });

  it("uses Arabic digits and counted nouns in Arabic", () => {
    expect(renderCard(overview(run(addDays(TODAY, -1), 12)), "ar").getByText("١٢")).toBeTruthy();
    const earnBack = renderCard(overview(run(addDays(TODAY, -3), 12)), "ar");
    expect(earnBack.getByText(/توقّفت سلسلتك بعد ١٢ يومًا/)).toBeTruthy();
    const fresh = renderCard(overview(run(addDays(TODAY, -3), 5)), "ar");
    expect(fresh.getByText(/٥ أيام/)).toBeTruthy();
  });
});

describe("HabitBreakSheet", () => {
  let store: OutboxDatabase;
  const s = strings.en;

  beforeEach(async () => {
    store = await openOutboxDatabase();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
    jest.restoreAllMocks();
  });

  function renderSheet() {
    return render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <DirectionProvider dir="ltr">
          <HabitBreakSheet open onClose={jest.fn()} db={store.db} pause={null} language="en" isDark={false} s={s} />
        </DirectionProvider>
      </SafeAreaProvider>,
    );
  }

  it("marks excused days from today, lists them and withdraws one", async () => {
    const today = localDateOf(new Date());
    const view = renderSheet();
    fireEvent.press(view.getByText(s.habitExcuseTravel));
    fireEvent.press(view.getByText("2 days"));
    fireEvent.press(view.getByText(s.habitExcuseSave));
    await waitFor(() => expect(view.getByText(s.habitBreakSaved)).toBeTruthy());
    expect(await readHabitDayRow(store.db, today)).toMatchObject({ status: "excused", reason: "travel" });
    expect(await readHabitDayRow(store.db, addDays(today, 1))).toMatchObject({ status: "excused", reason: "travel" });
    const removeButtons = await view.findAllByLabelText(/Remove the excuse for/);
    expect(removeButtons).toHaveLength(2);
    fireEvent.press(removeButtons[0]);
    await waitFor(async () => expect(await readHabitDayRow(store.db, today)).toMatchObject({ status: null }));
  });

  it("shows the menstruation note without issuing a ruling", () => {
    const view = renderSheet();
    fireEvent.press(view.getByText(s.habitExcuseMenstruation));
    expect(view.getByText(s.habitMenstruationNote)).toBeTruthy();
  });

  it("starts a pause for the chosen length", async () => {
    const view = renderSheet();
    fireEvent.press(view.getByText(s.habitBreakTabPause));
    fireEvent.press(view.getByText("14 days"));
    fireEvent.press(view.getByText(s.habitPauseStart));
    await waitFor(() => expect(view.getByText(s.habitBreakSaved)).toBeTruthy());
    const setting = store.sql.prepare("SELECT value FROM user_settings WHERE key = 'habit_pause'").get();
    const today = localDateOf(new Date());
    expect(JSON.parse(String(setting?.value))).toEqual({ start: today, end: addDays(today, 13) });
    expect(await readHabitDayRow(store.db, today)).toMatchObject({ status: "paused" });
  });
});
