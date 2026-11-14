import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import SabaqRoute from "@/app/hifz/sabaq";
import type { GradingButtons } from "@/components/flashcards/GradingButtons";
import { endReviewSession, startReviewSession } from "@/lib/fsrs/review-sessions";
import { StudyCardDeletedError } from "@/lib/fsrs/card-errors";
import { loadHabitOverview } from "@/lib/habit/queries";
import { readHabitSettings } from "@/lib/habit/settings";
import { emitHabitChanged } from "@/lib/habit/use-habit-overview";
import type { PageToken, RecitationPage } from "@/lib/hifz/page-data";
import { loadTodayWird, readMemorizedPageNumbers } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN } from "@/lib/hifz/plan";
import {
  completeSabaqChunk,
  loadSecondLooks,
  nextSabaqTarget,
  saveSabaqCleanRun,
  saveSecondLook,
  type SabaqTarget,
  type SecondLook,
} from "@/lib/hifz/sabaq";
import { similarGroupsForAyahs, withMemorizedSiblings } from "@/lib/hifz/similar";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { returnToTabs } from "@/lib/navigation/return-to-tabs";

/** The sabaq screen's second look (SBQ-03): offered before new lines, saved like a chunk grade, and easy to skip. */

type GradingProps = React.ComponentProps<typeof GradingButtons>;
type RemoveAction = { type: string };
type PreventRemove = { prevent: boolean; callback: (options: { data: { action: RemoveAction } }) => void };

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
let mockGrading: GradingProps | null = null;
let mockPreventRemove: PreventRemove | null = null;

jest.mock("expo-router", () => ({ useNavigation: () => mockNavigation }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual<typeof import("@react-navigation/native")>("@react-navigation/native"),
  usePreventRemove: (prevent: boolean, callback: PreventRemove["callback"]) => {
    mockPreventRemove = { prevent, callback };
  },
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
jest.mock("@/components/flashcards/GradingButtons", () => ({
  // The grade handler is called directly, to tap twice before React renders the busy state.
  GradingButtons: (props: GradingProps) => {
    mockGrading = props;
    return null;
  },
}));
jest.mock("@/components/habit/SessionHabitCards", () => ({
  SessionHabitCards: () => null,
  showsCommitment: () => false,
  strongerWirdEvent: (current: unknown, next: { kind: string }) => (next.kind === "none" ? current : next),
}));
jest.mock("@/components/habit/ZaytMood", () => ({ ZaytMood: () => null }));
// The lesson's exit dialog is covered in hifz-screens.test.tsx; these tests never open it.
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
jest.mock("@/lib/hifz/sabaq", () => ({
  completeSabaqChunk: jest.fn(),
  nextSabaqTarget: jest.fn(),
  saveSabaqCleanRun: jest.fn(),
  loadSecondLooks: jest.fn(),
  saveSecondLook: jest.fn(),
}));
jest.mock("@/lib/hifz/similar", () => ({ similarGroupsForAyahs: jest.fn(), withMemorizedSiblings: jest.fn() }));

function token(ayah: number): PageToken {
  return { glyph: `g${ayah}`, surah: 2, ayah, wordPos: 1, isMarker: false, firstLetter: "ب" };
}
const pageData: RecitationPage = {
  page: 5,
  lines: [
    { lineNumber: 1, kind: "ayah", centered: false, surahNumber: null, tokens: [token(1)] },
    { lineNumber: 2, kind: "ayah", centered: false, surahNumber: null, tokens: [token(2)] },
  ],
  ayahs: [
    { surah: 2, ayah: 1 },
    { surah: 2, ayah: 2 },
  ],
};
const look = (fromLine: number): SecondLook => ({
  cardId: `chunk:madani15:5:${fromLine}-${fromLine}`,
  page: 5,
  fromLine,
  toLine: fromLine,
  pageData,
  lineNumbers: new Set([fromLine]),
});
const target = {
  page: 5,
  pageData,
  fromLine: 2,
  toLine: 2,
  lineNumbers: new Set([2]),
  ayahs: [{ surah: 2, ayah: 2 }],
  linkAyahs: [],
  completesPage: false,
} satisfies SabaqTarget;
type LookSave = Awaited<ReturnType<typeof saveSecondLook>>;
type ChunkSave = Awaited<ReturnType<typeof completeSabaqChunk>>;
const lookSaved = { wird: { kind: "none" } } as unknown as LookSave;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
function grading(): GradingProps {
  if (!mockGrading) throw new Error("Grading buttons are not shown");
  return mockGrading;
}
async function open() {
  render(<SabaqRoute />, { wrapper: Wrapper });
  await flush();
}

let warnings: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockGrading = null;
  mockPreventRemove = null;
  warnings = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.mocked(returnToTabs).mockImplementation(() => undefined);
  jest.mocked(startReviewSession).mockReturnValue({ id: "session-1" } as never);
  jest.mocked(endReviewSession).mockResolvedValue(null as never);
  jest.mocked(loadHabitOverview).mockResolvedValue(null as never);
  jest.mocked(readHabitSettings).mockResolvedValue({ showZayt: false } as never);
  jest.mocked(loadTodayWird).mockResolvedValue({
    plan: DEFAULT_HIFZ_PLAN,
    newLines: 3,
    sabaqLinesToday: 3,
    daily: { backlog: false },
  } as never);
  jest.mocked(nextSabaqTarget).mockResolvedValue(target);
  jest.mocked(loadSecondLooks).mockResolvedValue({ due: [look(1)], nextAt: null });
  jest.mocked(saveSecondLook).mockResolvedValue(lookSaved);
  jest.mocked(saveSabaqCleanRun).mockResolvedValue({ wird: { kind: "none" }, pageAdded: false } as Awaited<ReturnType<typeof saveSabaqCleanRun>>);
  jest.mocked(similarGroupsForAyahs).mockResolvedValue([]);
  jest.mocked(withMemorizedSiblings).mockReturnValue([]);
  jest.mocked(readMemorizedPageNumbers).mockResolvedValue(new Set());
});
afterEach(() => warnings.mockRestore());

describe("sabaq second look (SBQ-03)", () => {
  it("offers a due look before new lines, saves its grade as a review of the chunk, then starts the lesson", async () => {
    await open();
    expect(screen.getByText(s.hifzSecondLookTitle)).toBeTruthy();
    expect(screen.getByText("Page 5 · Lines 1 to 1")).toBeTruthy();
    expect(screen.queryByText(s.hifzSabaqIntention)).toBeNull();
    // Recited from memory first: grading appears only after the check.
    expect(mockGrading).toBeNull();
    press(s.hifzDrillShow);
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();

    expect(saveSecondLook).toHaveBeenCalledTimes(1);
    expect(jest.mocked(saveSecondLook).mock.calls[0][1]).toMatchObject({
      cardId: "chunk:madani15:5:1-1",
      plan: DEFAULT_HIFZ_PLAN,
      rating: 3,
      session: { id: "session-1" },
      durationMs: expect.any(Number),
    });
    expect(emitHabitChanged).toHaveBeenCalled();
    // A short end state first: the person came for a 2-minute look and chooses whether to go on.
    expect(screen.getByText(s.hifzSecondLookSaved)).toBeTruthy();
    expect(screen.queryByText(s.hifzSabaqIntention)).toBeNull();
    press(s.hifzSabaqStart);
    expect(screen.getByText(s.hifzSabaqIntention)).toBeTruthy();
  });

  it("chooses the lesson's lines again after a graded look, so a failed look's lines come first (SBQ-02)", async () => {
    // Loaded with the look still passed, the lesson was line 2. The failed look offers line 1 again.
    jest.mocked(nextSabaqTarget).mockResolvedValueOnce(target).mockResolvedValueOnce({ ...target, fromLine: 1, toLine: 1, lineNumbers: new Set([1]) });
    await open();
    expect(jest.mocked(saveSecondLook).mock.calls).toHaveLength(0);
    press(s.hifzDrillShow);
    await act(async () => {
      void grading().onGrade(1);
    });
    await flush();
    expect(jest.mocked(saveSecondLook).mock.calls[0][1]).toMatchObject({ cardId: "chunk:madani15:5:1-1", pageData });
    expect(nextSabaqTarget).toHaveBeenCalledTimes(2);
    press(s.hifzSabaqStart);
    expect(screen.getByText(s.hifzSabaqIntention)).toBeTruthy();
    expect(screen.getByText("Page 5 · Lines 1 to 1")).toBeTruthy();
  });

  it("keeps the loaded lesson when its lines cannot be chosen again after a look", async () => {
    jest.mocked(nextSabaqTarget).mockResolvedValueOnce(target).mockRejectedValueOnce(new Error("Synthetic read failure"));
    await open();
    press(s.hifzDrillShow);
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    press(s.hifzSabaqStart);
    expect(screen.getByText("Page 5 · Lines 2 to 2")).toBeTruthy();
  });

  it("leaves from the end state without starting a lesson", async () => {
    await open();
    press(s.hifzDrillShow);
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    press(s.flashcardsSummaryDone);
    await flush();
    expect(returnToTabs).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(s.hifzSabaqIntention)).toBeNull();
  });

  it("goes on to new lines when skipped, without saving anything", async () => {
    await open();
    expect(screen.getByText(s.hifzSecondLookSkipHint)).toBeTruthy();
    press(s.hifzSecondLookSkipToNew);
    expect(screen.getByText(s.hifzSabaqIntention)).toBeTruthy();
    expect(screen.queryByText(s.hifzSecondLookSaved)).toBeNull();
    expect(saveSecondLook).not.toHaveBeenCalled();
    // Leaving now asks nothing: no lesson step was taken.
    expect(mockPreventRemove?.prevent).toBe(false);
  });

  it("shows each due look in turn, counted", async () => {
    jest.mocked(loadSecondLooks).mockResolvedValue({ due: [look(1), look(2)], nextAt: null });
    await open();
    expect(screen.getByText("1 of 2")).toBeTruthy();
    // Skipping skips both, so the hint counts them.
    expect(screen.getByText(s.hifzSecondLooksSkipHint)).toBeTruthy();
    press(s.hifzDrillShow);
    await act(async () => {
      void grading().onGrade(4);
    });
    await flush();
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(screen.getByText(s.hifzSecondLookSkipHint)).toBeTruthy();
    expect(screen.getByText("Page 5 · Lines 2 to 2")).toBeTruthy();
    // The next look starts hidden again.
    mockGrading = null;
    expect(screen.getByRole("button", { name: s.hifzDrillShow })).toBeTruthy();
    expect(jest.mocked(saveSecondLook).mock.calls.map(([, input]) => input.cardId)).toEqual(["chunk:madani15:5:1-1"]);
  });

  it("saves a look once when graded twice, and waits for the save before Close leaves", async () => {
    const save = deferred<LookSave>();
    jest.mocked(saveSecondLook).mockReturnValue(save.promise);
    await open();
    press(s.hifzDrillShow);
    await act(async () => {
      void grading().onGrade(3);
      void grading().onGrade(3);
    });
    expect(saveSecondLook).toHaveBeenCalledTimes(1);
    expect(mockPreventRemove?.prevent).toBe(true);
    press(s.genericClose);
    expect(returnToTabs).not.toHaveBeenCalled();
    await act(async () => save.resolve(lookSaved));
    await flush();
    expect(returnToTabs).toHaveBeenCalledTimes(1);
    expect(endReviewSession).toHaveBeenCalled();
  });

  it("stays on the look to show a failed save, and saves on retry", async () => {
    jest.mocked(saveSecondLook).mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(lookSaved);
    await open();
    press(s.hifzDrillShow);
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(screen.getByText(s.hifzSaveFailed)).toBeTruthy();
    expect(screen.getByText(s.hifzSecondLookTitle)).toBeTruthy();
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(saveSecondLook).toHaveBeenCalledTimes(2);
    expect(screen.getByText(s.hifzSecondLookSaved)).toBeTruthy();
  });

  it("moves past a look whose chunk was deleted since the screen loaded", async () => {
    jest.mocked(saveSecondLook).mockRejectedValue(new StudyCardDeletedError());
    await open();
    press(s.hifzDrillShow);
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(screen.queryByText(s.hifzSaveFailed)).toBeNull();
    expect(screen.getByText(s.hifzSabaqIntention)).toBeTruthy();
  });

  it("offers a look with no new lines left, then says it is saved", async () => {
    jest.mocked(nextSabaqTarget).mockResolvedValue(null);
    await open();
    expect(screen.getByText(s.hifzSecondLookTitle)).toBeTruthy();
    press(s.hifzDrillShow);
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(screen.getByText(s.hifzSecondLookSaved)).toBeTruthy();
    expect(screen.queryByText(s.hifzSabaqNoNew)).toBeNull();
  });

  it.each([
    ["a review backlog", { newLines: 3, daily: { backlog: true } }],
    ["a day without new lines", { newLines: 0, daily: { backlog: false } }],
  ])("offers the look but no new lesson with %s (PLN-02)", async (label, wird) => {
    jest.mocked(loadTodayWird).mockResolvedValue({ plan: DEFAULT_HIFZ_PLAN, sabaqLinesToday: 0, ...wird } as never);
    await open();
    expect(screen.getByText(s.hifzSecondLookTitle)).toBeTruthy();
    expect(nextSabaqTarget).not.toHaveBeenCalled();
    // Graded, the look is saved and no lesson follows; with a backlog the screen says why.
    press(s.hifzDrillShow);
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(screen.queryByText(s.hifzSabaqIntention)).toBeNull();
    expect(screen.getByText(s.hifzSecondLookSaved)).toBeTruthy();
    if (label === "a review backlog") expect(screen.getByText(s.hifzCatchUpFirst)).toBeTruthy();
  });

  it("leaves when the look is skipped and no lesson follows", async () => {
    jest.mocked(nextSabaqTarget).mockResolvedValue(null);
    await open();
    press(s.hifzSecondLookSkipForNow);
    await flush();
    expect(returnToTabs).toHaveBeenCalledTimes(1);
    expect(saveSecondLook).not.toHaveBeenCalled();
  });

  it("says when a look not yet due will be, on a visit with no new lines", async () => {
    jest.mocked(nextSabaqTarget).mockResolvedValue(null);
    const nextAt = new Date(Date.now() + 40 * 60_000);
    jest.mocked(loadSecondLooks).mockResolvedValue({ due: [], nextAt });
    await open();
    expect(screen.getByText(s.hifzSabaqNoNew)).toBeTruthy();
    const time = nextAt.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
    expect(screen.getByText(interpolate(s.hifzSecondLookOpensAt, { time }))).toBeTruthy();
  });

  it("still starts the lesson when second looks cannot be read", async () => {
    jest.mocked(loadSecondLooks).mockRejectedValue(new Error("locked"));
    await open();
    expect(screen.getByText(s.hifzSabaqIntention)).toBeTruthy();
    expect(screen.queryByText(s.hifzLoadFailed)).toBeNull();
  });

  describe("after the fluent check", () => {
    /** Walk the lesson, step 6's save included, to its fluent check, grade it `rating` and save it with `result`. */
    async function finishLesson(result: Partial<ChunkSave>, rating: 1 | 2 | 3 | 4 = 3) {
      jest.mocked(loadSecondLooks).mockResolvedValue({ due: [], nextAt: null });
      jest
        .mocked(completeSabaqChunk)
        .mockResolvedValue({ wird: { kind: "none" }, pageAdded: false, secondLookAt: null, ...result } as ChunkSave);
      await open();
      for (let step = 0; step < 3; step += 1) press(s.hifzSabaqNext);
      for (let reading = 0; reading < 10; reading += 1) press(s.hifzSabaqReadOnce);
      press(s.hifzSabaqNext);
      for (let clean = 0; clean < 4; clean += 1) {
        press(s.hifzDrillShow);
        press(s.hifzSabaqClean);
      }
      await flush();
      press(s.hifzDrillShow);
      press(s.hifzSabaqClean);
      press(s.hifzDrillShow);
      await act(async () => {
        void grading().onGrade(rating);
      });
      await flush();
      expect(screen.getByText(rating >= 3 ? s.hifzSabaqDoneTitle : s.hifzSabaqNotFluentTitle)).toBeTruthy();
    }

    it("promises the second look with the time it comes due", async () => {
      const secondLookAt = new Date(Date.now() + 60 * 60_000);
      await finishLesson({ secondLookAt });
      const time = secondLookAt.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
      expect(screen.getByText(interpolate(s.hifzSabaqSecondLookAt, { time }))).toBeTruthy();
      // The lines do not complete their page, so they wait for it rather than joining review tomorrow.
      expect(screen.getByText(s.hifzSabaqDonePartial)).toBeTruthy();
    });

    it("promises no second look when none comes due today", async () => {
      await finishLesson({ secondLookAt: null });
      expect(screen.queryByText(/second look/)).toBeNull();
    });

    it("after a failed check, says when the lines come back for their second look instead of next time", async () => {
      const secondLookAt = new Date(Date.now() + 60 * 60_000);
      await finishLesson({ secondLookAt }, 2);
      const time = secondLookAt.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
      expect(screen.getByText(interpolate(s.hifzSabaqSecondLookAt, { time }))).toBeTruthy();
      expect(screen.queryByText(s.hifzSabaqNotFluent)).toBeNull();
      expect(screen.queryByText(s.hifzSabaqDonePartial)).toBeNull();
    });

    it("after a failed check with no look later today, says the lines come up again next time", async () => {
      await finishLesson({ secondLookAt: null }, 1);
      expect(screen.getByText(s.hifzSabaqNotFluent)).toBeTruthy();
      expect(screen.queryByText(/second look/)).toBeNull();
    });

    it("after a failed check of lines that completed their page, says they come up in tomorrow's review", async () => {
      jest.mocked(nextSabaqTarget).mockResolvedValue({ ...target, completesPage: true });
      jest.mocked(saveSabaqCleanRun).mockResolvedValue({ wird: { kind: "none" }, pageAdded: true } as Awaited<ReturnType<typeof saveSabaqCleanRun>>);
      await finishLesson({ secondLookAt: null }, 1);
      // Step 6 added the page, so the lines are not offered again as new lines.
      expect(screen.getByText(s.hifzSabaqNotFluentReview)).toBeTruthy();
      expect(screen.queryByText(s.hifzSabaqNotFluent)).toBeNull();
    });

    it("follows the page step 6 added, not the lines chosen at load, when an earlier chunk's look failed since", async () => {
      // Chosen as the page's last lines, but step 6 found earlier lines no longer memorized and added no page.
      jest.mocked(nextSabaqTarget).mockResolvedValue({ ...target, completesPage: true });
      await finishLesson({ secondLookAt: null }, 1);
      expect(screen.getByText(s.hifzSabaqNotFluent)).toBeTruthy();
      expect(screen.queryByText(s.hifzSabaqNotFluentReview)).toBeNull();
    });

    it("says the lines join review with their page when a passed lesson's page is still incomplete", async () => {
      jest.mocked(nextSabaqTarget).mockResolvedValue({ ...target, completesPage: true });
      await finishLesson({ secondLookAt: null }, 3);
      expect(screen.getByText(s.hifzSabaqDonePartial)).toBeTruthy();
    });
  });
});
