import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import MemorizeRoute from "@/app/hifz/memorize";
import { endReviewSession, startReviewSession } from "@/lib/fsrs/review-sessions";
import { loadHabitOverview } from "@/lib/habit/queries";
import { readHabitSettings } from "@/lib/habit/settings";
import type { PageToken, RecitationPage } from "@/lib/hifz/page-data";
import { loadTodayWird, readMemorizedPageNumbers } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN, type HifzPlan } from "@/lib/hifz/plan";
import { loadSecondLooks, nextMemorizeTarget, saveMemorizeCleanRun, type MemorizeTarget } from "@/lib/hifz/memorize";
import { similarGroupsForAyahs, withMemorizedSiblings } from "@/lib/hifz/similar";
import { strings } from "@/lib/i18n/strings";

/** SBQ-01: the new memorization steps follow the repetition counts saved in the plan, not fixed numbers. */

const s = strings.en;
const mockDatabase = {
  getAllAsync: jest.fn(async () => []),
  getFirstAsync: jest.fn(async (): Promise<unknown> => null),
};
const mockAudio = {
  playRange: jest.fn(async () => undefined),
  rangeState: { active: false, paused: false },
  stop: jest.fn(),
  togglePause: jest.fn(),
};
const mockNavigation = { getState: () => undefined, dispatch: jest.fn() };

jest.mock("expo-router", () => ({ useNavigation: () => mockNavigation }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual<typeof import("@react-navigation/native")>("@react-navigation/native"),
  usePreventRemove: jest.fn(),
  useIsFocused: () => true,
}));
jest.mock("@/lib/navigation/return-to-tabs", () => ({ returnToTabs: jest.fn() }));
jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDatabase,
  useDatabaseStatus: () => ({ isReady: true, progress: null, error: null }),
}));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => ({ ...actual.useSettings(), isDark: false, isRTL: false, uiLanguage: "en" }) };
});
jest.mock("@/lib/audio/ayah-audio", () => ({ useAyahAudio: () => mockAudio }));
jest.mock("@/components/mushaf/MushafPage", () => ({ loadPageWordsData: jest.fn(async () => null) }));
jest.mock("@/components/hifz/RecitationPage", () => ({
  HIDDEN: { all: false, count: 0, touchedLines: new Set() },
  RecitationPage: () => null,
}));
jest.mock("@/components/flashcards/GradingButtons", () => ({ GradingButtons: () => null }));
jest.mock("@/components/habit/SessionHabitCards", () => ({
  SessionHabitCards: () => null,
  showsCommitment: () => false,
  useCommitmentLabel: (_db: unknown, strings: { habitCommitTomorrow: string }) => strings.habitCommitTomorrow,
  strongerWirdEvent: (current: unknown) => current,
}));
jest.mock("@/components/habit/ZaytAnimation", () => ({ ZaytAnimation: () => null, ZaytStill: () => null }));
jest.mock("@/components/ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("@/lib/fsrs/review-sessions", () => ({ startReviewSession: jest.fn(), endReviewSession: jest.fn() }));
jest.mock("@/lib/habit/queries", () => ({ loadHabitOverview: jest.fn() }));
jest.mock("@/lib/habit/settings", () => ({ readHabitSettings: jest.fn() }));
jest.mock("@/lib/habit/use-habit-overview", () => ({ emitHabitChanged: jest.fn() }));
jest.mock("@/lib/hifz/pages", () => ({
  newMemorizationOpen: jest.requireActual<typeof import("@/lib/hifz/pages")>("@/lib/hifz/pages").newMemorizationOpen,
  loadTodayWird: jest.fn(),
  readMemorizedPageNumbers: jest.fn(),
}));
jest.mock("@/lib/hifz/memorize", () => ({
  addCoveredMemorizedPages: async () => 0,
  completeMemorizeChunk: jest.fn(),
  nextMemorizeTarget: jest.fn(),
  saveMemorizeCleanRun: jest.fn(),
  loadSecondLooks: jest.fn(),
  saveSecondLook: jest.fn(),
}));
jest.mock("@/lib/hifz/similar", () => ({ similarGroupsForAyahs: jest.fn(), withMemorizedSiblings: jest.fn() }));

function token(ayah: number): PageToken {
  return { glyph: `g${ayah}`, surah: 2, ayah, wordPos: 1, isMarker: false, firstLetter: "ب" };
}
const pageData: RecitationPage = {
  page: 5,
  lines: [{ lineNumber: 1, kind: "ayah", centered: false, surahNumber: null, tokens: [token(1)] }],
  ayahs: [{ surah: 2, ayah: 1 }],
};
const target = {
  page: 5,
  pageData,
  fromLine: 1,
  toLine: 1,
  lineNumbers: new Set([1]),
  ayahs: [{ surah: 2, ayah: 1 }],
  linkAyahs: [],
  completesPage: false,
} satisfies MemorizeTarget;

function Wrapper({ children }: React.PropsWithChildren) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const press = (name: string) => fireEvent.press(screen.getByRole("button", { name }));
const nextShown = () => screen.queryByRole("button", { name: s.hifzMemorizeNext }) !== null;

async function openWith(memorizeRepetitions: HifzPlan["memorizeRepetitions"]) {
  jest.mocked(loadTodayWird).mockResolvedValue({
    plan: { ...DEFAULT_HIFZ_PLAN, memorizeRepetitions },
    newLines: 3,
    memorizeLinesToday: 0,
    daily: { backlog: false },
  } as never);
  render(<MemorizeRoute />, { wrapper: Wrapper });
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(startReviewSession).mockReturnValue({ id: "session-1" } as never);
  jest.mocked(endReviewSession).mockResolvedValue(null as never);
  jest.mocked(loadHabitOverview).mockResolvedValue(null as never);
  jest.mocked(readHabitSettings).mockResolvedValue({ showZayt: false } as never);
  jest.mocked(nextMemorizeTarget).mockResolvedValue(target);
  jest.mocked(loadSecondLooks).mockResolvedValue({ due: [], nextAt: null });
  jest.mocked(saveMemorizeCleanRun).mockResolvedValue({ wird: { kind: "none" }, pageAdded: false } as Awaited<ReturnType<typeof saveMemorizeCleanRun>>);
  jest.mocked(similarGroupsForAyahs).mockResolvedValue([]);
  jest.mocked(withMemorizedSiblings).mockReturnValue([]);
  jest.mocked(readMemorizedPageNumbers).mockResolvedValue(new Set());
});

describe("new memorization repetition counts (SBQ-01)", () => {
  it("plays, counts readings and asks for clean recitations as the plan's counts say", async () => {
    await openWith({ listen: 2, looking: 20, cleanInARow: 5 });
    press(s.hifzMemorizeNext);

    // Listening: the hint and the player use the plan's count.
    expect(screen.getByText("Listen while you follow the text. Repeats: 2.")).toBeTruthy();
    press(s.hifzMemorizePlay);
    expect(mockAudio.playRange).toHaveBeenCalledWith({ ayahs: target.ayahs, repeatRange: 2 });
    press(s.hifzMemorizeNext);
    press(s.hifzMemorizeNext);

    // Reading while looking: Next appears only after the 20th reading.
    expect(screen.getByText("0 of 20")).toBeTruthy();
    for (let reading = 0; reading < 19; reading += 1) press(s.hifzMemorizeReadOnce);
    expect(screen.getByText("19 of 20")).toBeTruthy();
    expect(nextShown()).toBe(false);
    press(s.hifzMemorizeReadOnce);
    expect(screen.getByText("20 of 20")).toBeTruthy();
    expect(nextShown()).toBe(true);
    press(s.hifzMemorizeNext);

    // The one ayah, then the whole lines five clean times in a row.
    press(s.hifzDrillShow);
    press(s.hifzMemorizeClean);
    expect(screen.getByText(s.hifzMemorizeStepChunk)).toBeTruthy();
    expect(screen.getByText("Clean in a row: 0 of 5")).toBeTruthy();
    for (let clean = 0; clean < 4; clean += 1) {
      press(s.hifzDrillShow);
      press(s.hifzMemorizeClean);
    }
    expect(screen.getByText("Clean in a row: 4 of 5")).toBeTruthy();
    expect(saveMemorizeCleanRun).not.toHaveBeenCalled();
    press(s.hifzDrillShow);
    press(s.hifzMemorizeClean);
    // The fifth saves the chunk (SBQ-02), then the lesson moves on.
    await flush();
    expect(saveMemorizeCleanRun).toHaveBeenCalledTimes(1);
    expect(screen.getByText(s.hifzMemorizeStepLink)).toBeTruthy();
  });

  it("moves on after a single reading and a single clean recitation when set to 1", async () => {
    await openWith({ listen: 1, looking: 1, cleanInARow: 1 });
    for (let step = 0; step < 3; step += 1) press(s.hifzMemorizeNext);
    expect(screen.getByText("0 of 1")).toBeTruthy();
    press(s.hifzMemorizeReadOnce);
    press(s.hifzMemorizeNext);
    press(s.hifzDrillShow);
    press(s.hifzMemorizeClean);
    press(s.hifzDrillShow);
    press(s.hifzMemorizeClean);
    await flush();
    expect(saveMemorizeCleanRun).toHaveBeenCalledTimes(1);
    expect(screen.getByText(s.hifzMemorizeStepLink)).toBeTruthy();
  });
});
