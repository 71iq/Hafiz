import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import HifzReviewRoute from "@/app/hifz/review";
import SabaqRoute from "@/app/hifz/sabaq";
import type { GradingButtons } from "@/components/flashcards/GradingButtons";
import type { SessionHabitInput } from "@/components/habit/SessionHabitCards";
import type { RecitationPage as RecitationPageView } from "@/components/hifz/RecitationPage";
import { endReviewSession, startReviewSession } from "@/lib/fsrs/review-sessions";
import { readDeckReviewSettings } from "@/lib/fsrs/queries";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { loadHabitOverview } from "@/lib/habit/queries";
import { readHabitSettings } from "@/lib/habit/settings";
import { emitHabitChanged } from "@/lib/habit/use-habit-overview";
import { dismissInboxItem, readMistakeInbox, recordDrillResult, type InboxItem } from "@/lib/hifz/errors";
import { loadRecitationPage, type PageToken, type RecitationPage } from "@/lib/hifz/page-data";
import { loadPageCards, loadTodayWird, readMemorizedPageNumbers, type PageCard } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN } from "@/lib/hifz/plan";
import { loadDueRemediation } from "@/lib/hifz/remediation";
import { recordReviewPace, savePageGrade } from "@/lib/hifz/review";
import { completeSabaqChunk, nextSabaqTarget, saveSabaqCleanRun, type SabaqTarget } from "@/lib/hifz/sabaq";
import { similarGroupsForAyahs, withMemorizedSiblings } from "@/lib/hifz/similar";
import { refreshWeakSpots } from "@/lib/hifz/use-weak-spots";
import { strings } from "@/lib/i18n/strings";
import { returnToTabs } from "@/lib/navigation/return-to-tabs";

type GradingProps = React.ComponentProps<typeof GradingButtons>;
type RecitationProps = React.ComponentProps<typeof RecitationPageView>;

const s = strings.en;
const mockDatabase = {
  getAllAsync: jest.fn(async () => []),
  getFirstAsync: jest.fn(async (): Promise<unknown> => null),
  runAsync: jest.fn(),
  execAsync: jest.fn(),
  withTransactionAsync: jest.fn(),
};
let mockParams: Record<string, string> = {};
let mockGrading: GradingProps | null = null;
/** What the review screen last passed to the recitation page. */
let mockRecitation: RecitationProps | null = null;
let mockHabitInput: SessionHabitInput | null = null;
// A stable object: the sabaq screen reloads whenever `stop` changes identity.
const mockAudio = {
  playRange: jest.fn(async () => undefined),
  rangeState: { active: false, paused: false },
  stop: jest.fn(),
  togglePause: jest.fn(),
};

type RemoveAction = { type: string };
type PreventRemove = { prevent: boolean; callback: (options: { data: { action: RemoveAction } }) => void };
/** What the screen last passed to usePreventRemove. The prevent flag is what native-stack uses to block the iOS swipe. */
let mockPreventRemove: PreventRemove | null = null;
const mockNavigation = { getState: () => undefined, dispatch: jest.fn() };
/** A hardware back press, a back gesture, or the pop native-stack sends after it blocks the iOS swipe. */
const BACK: RemoveAction = { type: "GO_BACK" };
/** The navigation returnToTabs dispatches when the screen leaves on purpose. */
const EXIT: RemoveAction = { type: "POP_TO" };

/**
 * Remove the screen as React Navigation does: when the latest render prevents removal, the action is
 * stopped and handed to the callback, which may continue it with navigation.dispatch. Returns whether
 * the screen stayed.
 */
function remove(action: RemoveAction): boolean {
  const guard = mockPreventRemove;
  if (!guard?.prevent) return false;
  const before = mockNavigation.dispatch.mock.calls.length;
  guard.callback({ data: { action } });
  return !mockNavigation.dispatch.mock.calls.slice(before).some(([dispatched]) => dispatched === action);
}
const back = () => remove(BACK);
const preventing = () => mockPreventRemove?.prevent ?? false;
/** Each time the screen left on purpose, whether React Navigation let it go or held it. */
let exits: ("left" | "held")[] = [];

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useNavigation: () => mockNavigation,
}));
/** Screen focus for useIsFocused; a test takes it away and gives it back like a screen pushed on top. */
const mockFocus = { focused: true, listeners: new Set<() => void>() };
jest.mock("@react-navigation/native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    ...jest.requireActual<typeof import("@react-navigation/native")>("@react-navigation/native"),
    usePreventRemove: (prevent: boolean, callback: PreventRemove["callback"]) => {
      mockPreventRemove = { prevent, callback };
    },
    useIsFocused: () =>
      React.useSyncExternalStore(
        (listener: () => void) => {
          mockFocus.listeners.add(listener);
          return () => mockFocus.listeners.delete(listener);
        },
        () => mockFocus.focused,
      ),
  };
});
jest.mock("@/lib/navigation/return-to-tabs", () => ({ returnToTabs: jest.fn() }));
jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDatabase,
  useDatabaseStatus: () => ({ isReady: true, progress: null, error: null }),
}));
let mockUiLanguage: "en" | "ar" = "en";
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return {
    ...actual,
    useSettings: () => ({
      ...actual.useSettings(),
      isDark: false,
      isRTL: mockUiLanguage === "ar",
      uiLanguage: mockUiLanguage,
      fontSize: 20,
      lineHeight: 40,
    }),
  };
});
jest.mock("@/lib/haptics", () => ({ hapticMedium: jest.fn(), hapticSuccess: jest.fn() }));
jest.mock("@/lib/audio/ayah-audio", () => ({ useAyahAudio: () => mockAudio }));
jest.mock("@/components/mushaf/MushafPage", () => ({ loadPageWordsData: jest.fn(async () => null) }));
jest.mock("@/components/hifz/RecitationPage", () => ({
  HIDDEN: { all: false, count: 0, touchedLines: new Set() },
  RecitationPage: (props: RecitationProps) => {
    mockRecitation = props;
    return null;
  },
  visibleLines: (page: RecitationPage, lineNumbers: ReadonlySet<number> | null) =>
    page.lines.filter((line) => lineNumbers === null || lineNumbers.has(line.lineNumber)),
  orderedTokens: (lines: RecitationPage["lines"]) => lines.flatMap((line) => line.tokens),
}));
jest.mock("@/components/flashcards/GradingButtons", () => ({
  // The grade handler is called directly, to tap twice before React renders the busy state.
  GradingButtons: (props: GradingProps) => {
    mockGrading = props;
    return null;
  },
  getGradeSchedulePreviews: () => ({}),
}));
jest.mock("@/components/flashcards/Qcf2AyahText", () => ({ Qcf2AyahText: () => null }));
jest.mock("@/components/hifz/MistakeTypeSheet", () => ({ MistakeTypeSheet: () => null, errorTypeLabel: () => "Wrong word" }));
jest.mock("@/components/habit/SessionHabitCards", () => ({
  SessionHabitCards: ({ input }: { input: SessionHabitInput }) => {
    mockHabitInput = input;
    return null;
  },
  showsCommitment: () => false,
  useCommitmentLabel: (_db: unknown, strings: { habitCommitTomorrow: string }) => strings.habitCommitTomorrow,
  strongerWirdEvent: (current: unknown, next: { kind: string }) => (next.kind === "none" ? current : next),
}));
jest.mock("@/components/habit/ZaytMood", () => ({ ZaytMood: () => null }));
jest.mock("@/components/ui/Toast", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return { Toast: ({ message }: { message: string }) => <Text>{message}</Text> };
});
jest.mock("@/lib/fsrs/review-sessions", () => ({ startReviewSession: jest.fn(), endReviewSession: jest.fn() }));
jest.mock("@/lib/fsrs/queries", () => ({
  ...jest.requireActual<typeof import("@/lib/fsrs/queries")>("@/lib/fsrs/queries"),
  readDeckReviewSettings: jest.fn(),
}));
jest.mock("@/lib/habit/queries", () => ({
  ...jest.requireActual<typeof import("@/lib/habit/queries")>("@/lib/habit/queries"),
  loadHabitOverview: jest.fn(),
}));
jest.mock("@/lib/habit/settings", () => ({
  ...jest.requireActual<typeof import("@/lib/habit/settings")>("@/lib/habit/settings"),
  readHabitSettings: jest.fn(),
}));
jest.mock("@/lib/habit/use-habit-overview", () => ({ emitHabitChanged: jest.fn() }));
jest.mock("@/lib/hifz/pages", () => ({
  newMemorizationOpen: jest.requireActual<typeof import("@/lib/hifz/pages")>("@/lib/hifz/pages").newMemorizationOpen,
  loadTodayWird: jest.fn(),
  loadPageCards: jest.fn(),
  toPlanPage: jest.fn(),
  readMemorizedPageNumbers: jest.fn(),
}));
jest.mock("@/lib/hifz/page-data", () => ({ loadRecitationPage: jest.fn() }));
jest.mock("@/lib/hifz/errors", () => ({
  ...jest.requireActual<typeof import("@/lib/hifz/errors")>("@/lib/hifz/errors"),
  readMistakeInbox: jest.fn(),
  dismissInboxItem: jest.fn(),
  recordDrillResult: jest.fn(),
}));
jest.mock("@/lib/hifz/remediation", () => ({
  ...jest.requireActual<typeof import("@/lib/hifz/remediation")>("@/lib/hifz/remediation"),
  loadDueRemediation: jest.fn(),
}));
jest.mock("@/lib/hifz/review", () => ({
  ...jest.requireActual<typeof import("@/lib/hifz/review")>("@/lib/hifz/review"),
  savePageGrade: jest.fn(),
  saveRemediationGrade: jest.fn(),
  recordReviewPace: jest.fn(),
}));
jest.mock("@/lib/hifz/sabaq", () => ({
  addCoveredSabaqPages: async () => 0,
  completeSabaqChunk: jest.fn(),
  nextSabaqTarget: jest.fn(),
  saveSabaqCleanRun: jest.fn(),
  // No second look is due in these lessons; tests/unit/hifz-second-look-screen.test.tsx covers them.
  loadSecondLooks: jest.fn(async () => ({ due: [], nextAt: null })),
  saveSecondLook: jest.fn(),
}));
jest.mock("@/lib/hifz/similar", () => ({
  ...jest.requireActual<typeof import("@/lib/hifz/similar")>("@/lib/hifz/similar"),
  similarGroupsForAyahs: jest.fn(),
  withMemorizedSiblings: jest.fn(),
  // No page in these reviews holds a similar verse (MUT-03); tests/unit/hifz-drift-screen.test.tsx covers them.
  similarGroupsOnPages: jest.fn(async () => []),
}));
jest.mock("@/lib/hifz/use-weak-spots", () => ({ refreshWeakSpots: jest.fn() }));

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function token(ayah: number, wordPos: number): PageToken {
  return { glyph: `g${ayah}-${wordPos}`, surah: 2, ayah, wordPos, isMarker: false, firstLetter: "ب" };
}
const pageData: RecitationPage = {
  page: 5,
  lines: [{ lineNumber: 1, kind: "ayah", centered: false, surahNumber: null, tokens: [token(1, 1), token(1, 2)] }],
  ayahs: [{ surah: 2, ayah: 1 }],
};
const row = { id: "page:madani15:5", deck_id: "hifz-pages", tier: "manzil" } as StudyCardRow;
const pageCard: PageCard = { row, page: 5, tier: "manzil", history: { declared: true, firstFluentDate: null, grades: [] } };
const saved = {
  wird: { kind: "none" },
  tier: "manzil",
  remediation: { half: null, seam: null },
  transition: { updatedCard: row, shouldRequeueInSession: false, reviewRecord: { rating: 3 } },
} as unknown as Awaited<ReturnType<typeof savePageGrade>>;
const inboxItem: InboxItem = {
  id: "err-1",
  cardId: "page:madani15:5",
  surah: 2,
  ayah: 1,
  word: 1,
  type: "wrong_word",
  corrected: "none",
  siblingRef: null,
  localDate: "2026-11-12",
  cleanCount: 0,
};

function Wrapper({ children }: React.PropsWithChildren) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
      {children}
    </SafeAreaProvider>
  );
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function grading(): GradingProps {
  if (!mockGrading) throw new Error("Grading buttons are not shown");
  return mockGrading;
}

const MINUTE = 60_000;
/** The device clock while a lifecycle test runs: Date.now reads it, and only the test moves it. */
let deviceTime = 0;
const appStateListeners = new Set<(state: AppStateStatus) => void>();
// React Native's Jest mock leaves currentState as a function; the screens read it as a state.
const appState = AppState as { currentState: unknown };
const mockedCurrentState = appState.currentState;
// The same mock serves every test, so a lifecycle test puts its default subscription back.
const addAppStateListener = jest.mocked(AppState.addEventListener);
const mockedAddAppStateListener = addAppStateListener.getMockImplementation();

/** Change AppState as the platform does: the current state first, then the change event. */
function setAppState(state: AppStateStatus) {
  appState.currentState = state;
  for (const listener of [...appStateListeners]) listener(state);
}
function setFocused(focused: boolean) {
  mockFocus.focused = focused;
  for (const listener of [...mockFocus.listeners]) listener();
}
/** Six minutes, or any other time, away from the screen: the app in the background, or another screen on top. */
type Away = "background" | "blur";
const AWAY_CASES: [string, Away][] = [
  ["the app is in the background", "background"],
  ["another screen covers it", "blur"],
];
function stayAway(how: Away, ms: number) {
  act(() => (how === "background" ? setAppState("background") : setFocused(false)));
  deviceTime += ms;
  act(() => (how === "background" ? setAppState("active") : setFocused(true)));
}
/** Hand Date.now, AppState and screen focus to the tests in the calling describe block. */
function controlDeviceLifecycle() {
  let nowSpy: jest.SpyInstance;
  beforeEach(() => {
    deviceTime = new Date(2026, 10, 14, 9, 0).getTime();
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => deviceTime);
    mockFocus.focused = true;
    appStateListeners.clear();
    appState.currentState = "active";
    addAppStateListener.mockImplementation((_type, listener) => {
      appStateListeners.add(listener as (state: AppStateStatus) => void);
      return {
        remove: () => appStateListeners.delete(listener as (state: AppStateStatus) => void),
      } as ReturnType<typeof AppState.addEventListener>;
    });
  });
  afterEach(() => {
    nowSpy.mockRestore();
    if (mockedAddAppStateListener) addAppStateListener.mockImplementation(mockedAddAppStateListener);
    appState.currentState = mockedCurrentState;
    mockFocus.focused = true;
  });
}

let warnings: jest.SpyInstance;
beforeEach(() => {
  mockPreventRemove = null;
  mockUiLanguage = "en";
  exits = [];
  jest.clearAllMocks();
  jest.mocked(returnToTabs).mockImplementation(() => {
    exits.push(remove(EXIT) ? "held" : "left");
  });
  mockParams = {};
  mockGrading = null;
  mockRecitation = null;
  mockHabitInput = null;
  warnings = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.mocked(startReviewSession).mockReturnValue({ id: "session-1" } as never);
  jest.mocked(endReviewSession).mockResolvedValue(null as never);
  jest.mocked(loadHabitOverview).mockResolvedValue(null as never);
  jest.mocked(readDeckReviewSettings).mockResolvedValue({} as never);
  jest.mocked(readHabitSettings).mockResolvedValue({ showZayt: false } as never);
  jest.mocked(recordReviewPace).mockResolvedValue(undefined);
  jest.mocked(refreshWeakSpots).mockResolvedValue(undefined);
});
afterEach(() => {
  warnings.mockRestore();
});

describe("hifz review screen", () => {
  beforeEach(() => {
    jest.mocked(loadTodayWird).mockResolvedValue({
      plan: DEFAULT_HIFZ_PLAN,
      minutesPerReviewPage: 3,
      done: [],
      todo: [{ cardId: row.id, page: 5, tier: "manzil", lastReviewDate: null, reviewedToday: false, dueDate: "2026-11-13", retrievability: 0.95 }],
      total: 1,
    } as never);
    jest.mocked(loadPageCards).mockResolvedValue([pageCard]);
    jest.mocked(readMistakeInbox).mockResolvedValue([]);
    jest.mocked(loadDueRemediation).mockResolvedValue([]);
    jest.mocked(loadRecitationPage).mockResolvedValue(pageData);
  });

  it("brings a page graded Again back after the other items while its step is due, and counts it once", async () => {
    const relearning = { ...row, state: 3, due: "2026-11-14T10:10:00.000Z" } as StudyCardRow;
    jest
      .mocked(savePageGrade)
      .mockResolvedValueOnce({
        ...saved,
        tier: "manzil.needs_work",
        transition: { updatedCard: relearning, shouldRequeueInSession: true, reviewRecord: { rating: 1 } },
      } as never)
      .mockResolvedValueOnce(saved);
    jest.mocked(readMistakeInbox).mockResolvedValue([inboxItem]);
    mockDatabase.getFirstAsync.mockResolvedValue({ text_qcf2: "a b", v2_page: 5 });
    const buttons = await openCheck();
    expect(screen.getByText("1 / 2")).toBeTruthy();
    await act(async () => {
      void buttons.onGrade(1);
    });
    await flush();
    // The drill that was already queued comes first; the page waits behind it, and the person is told.
    // The count is of items, so the page coming back does not add one.
    expect(screen.getByText("2 / 2")).toBeTruthy();
    expect(screen.getByText(s.hifzPageComesBack)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: s.hifzDrillShow }));
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: s.hifzDrillClean }));
    });
    await flush();
    expect(screen.getByText("2 / 2")).toBeTruthy();
    // The page back for its step says so, instead of its tier.
    expect(screen.getByText(s.hifzOnceMore)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: s.hifzDone }));
    await flush();
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(savePageGrade).toHaveBeenCalledTimes(2);
    expect(jest.mocked(savePageGrade).mock.calls[0][1]).toMatchObject({ card: row, firstGradeInSession: true });
    // The second recitation is graded from the row the first grade saved, as a later grade in the session.
    expect(jest.mocked(savePageGrade).mock.calls[1][1]).toMatchObject({ card: relearning, firstGradeInSession: false });
    expect(screen.getByText(s.hifzSummaryTitle)).toBeTruthy();
    // One page of the plan, recited twice: the plan and the pace count it once.
    expect(screen.getByText("Wird 1 of 1 pages")).toBeTruthy();
    expect(jest.mocked(recordReviewPace).mock.calls[0][1]).toMatchObject({ pages: 1 });
    mockDatabase.getFirstAsync.mockResolvedValue(null);
  });

  async function openCheck() {
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();
    fireEvent.press(screen.getByRole("button", { name: s.hifzDone }));
    await flush();
    return grading();
  }

  it("recites a page as its first half, then its second, and grades it once with the lower half's proposal (UNIT-02)", async () => {
    jest.mocked(loadTodayWird).mockResolvedValue({
      plan: { ...DEFAULT_HIFZ_PLAN, unit: "half" },
      minutesPerReviewPage: 3,
      done: [],
      todo: [{ cardId: row.id, page: 5, tier: "manzil", lastReviewDate: null, reviewedToday: false, dueDate: "2026-11-13", retrievability: 0.95 }],
      total: 1,
    } as never);
    const fourLines: RecitationPage = {
      page: 5,
      lines: [1, 2, 3, 4].map((n) => ({ lineNumber: n, kind: "ayah" as const, centered: false, surahNumber: null, tokens: [token(n, 1), token(n, 2)] })),
      ayahs: [1, 2, 3, 4].map((ayah) => ({ surah: 2, ayah })),
    };
    jest.mocked(loadRecitationPage).mockResolvedValue(fourLines);
    jest.mocked(savePageGrade).mockResolvedValue(saved);
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();

    // The title names the half; the count stays a count of pages.
    expect(screen.getByText("1 / 1")).toBeTruthy();
    expect(screen.getByText(`Page 5 · ${s.hifzHalfA}`)).toBeTruthy();
    expect([...mockRecitation!.lineNumbers!]).toEqual([1, 2]);
    expect(screen.getByText(s.hifzRecitePromptHalf)).toBeTruthy();
    expect(screen.getByText(s.hifzReciteInSalah)).toBeTruthy();
    // A peek in the first half, then its own check, with nothing graded yet.
    fireEvent.press(screen.getByText(s.hifzPeek));
    fireEvent.press(screen.getByRole("button", { name: s.hifzDone }));
    await flush();
    expect(screen.getByText(s.hifzMarkMistakesHalf)).toBeTruthy();
    expect(mockGrading).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: s.hifzNextHalf }));
    await flush();

    expect(screen.getByText(`Page 5 · ${s.hifzHalfB}`)).toBeTruthy();
    expect([...mockRecitation!.lineNumbers!]).toEqual([3, 4]);
    expect(screen.queryByText(s.hifzReciteInSalah)).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: s.hifzDone }));
    await flush();
    // The clean second half would propose Good; the page takes the first half's Hard.
    expect(grading().proposed).toBe(2);
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();

    expect(savePageGrade).toHaveBeenCalledTimes(1);
    const input = jest.mocked(savePageGrade).mock.calls[0][1];
    expect(input.attempt).toBeUndefined();
    expect(input).toMatchObject({ card: row, rating: 3, page: fourLines, firstToken: fourLines.lines[0].tokens[0] });
    expect(input.halves?.a.peeked).toEqual([fourLines.lines[0].tokens[0]]);
    expect(input.halves?.b).toMatchObject({ level: 4, peeked: [], shown: [] });
    expect(screen.getByText(s.hifzSummaryTitle)).toBeTruthy();
    expect(screen.getByText("Wird 1 of 1 pages")).toBeTruthy();
  });

  it("saves a page once when its grade is tapped twice before the busy state renders", async () => {
    const save = deferred<typeof saved>();
    jest.mocked(savePageGrade).mockReturnValue(save.promise);
    const buttons = await openCheck();
    await act(async () => {
      void buttons.onGrade(3);
      void buttons.onGrade(3);
    });
    expect(savePageGrade).toHaveBeenCalledTimes(1);
    await act(async () => save.resolve(saved));
    await flush();
    expect(savePageGrade).toHaveBeenCalledTimes(1);
  });

  it("holds the lock while the last page's summary loads, so another tap does not save it again", async () => {
    jest.mocked(savePageGrade).mockResolvedValue(saved);
    const overview = deferred<null>();
    jest.mocked(loadHabitOverview).mockReturnValue(overview.promise as never);
    const buttons = await openCheck();
    await act(async () => {
      void buttons.onGrade(3);
    });
    await flush();
    // The summary is still loading; the grade buttons of the saved page are still on screen.
    await act(async () => {
      void grading().onGrade(3);
    });
    expect(savePageGrade).toHaveBeenCalledTimes(1);
    await act(async () => overview.resolve(null));
    await flush();
    expect(screen.getByText(s.hifzSummaryTitle)).toBeTruthy();
  });

  it("finalizes a one-page session with the page it just saved (PLN-05)", async () => {
    jest.mocked(savePageGrade).mockResolvedValue(saved);
    const buttons = await openCheck();
    await act(async () => {
      void buttons.onGrade(3);
    });
    await flush();
    expect(recordReviewPace).toHaveBeenCalledTimes(1);
    expect(jest.mocked(recordReviewPace).mock.calls[0][1]).toMatchObject({ pages: 1, current: 3 });
    expect(mockHabitInput).toMatchObject({ total: 1 });
  });

  it("keeps the page open after a failed save and saves it on the next tap", async () => {
    jest.mocked(savePageGrade).mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(saved);
    const buttons = await openCheck();
    await act(async () => {
      void buttons.onGrade(3);
    });
    await flush();
    expect(screen.getByText(s.hifzSaveFailed)).toBeTruthy();
    expect(warnings).toHaveBeenCalled();
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(savePageGrade).toHaveBeenCalledTimes(2);
    expect(screen.getByText(s.hifzSummaryTitle)).toBeTruthy();
  });

  it("waits for an unresolved save before leaving on Close, then leaves once it is saved", async () => {
    const save = deferred<typeof saved>();
    jest.mocked(savePageGrade).mockReturnValue(save.promise);
    const buttons = await openCheck();
    await act(async () => {
      void buttons.onGrade(3);
    });
    // Nothing is counted yet, so Close would leave at once without asking.
    fireEvent.press(screen.getByRole("button", { name: s.genericClose }));
    expect(returnToTabs).not.toHaveBeenCalled();
    await act(async () => save.resolve(saved));
    await flush();
    // The screen leaves while removal is still prevented; its own exit goes through.
    expect(exits).toEqual(["left"]);
    expect(endReviewSession).toHaveBeenCalled();
  });

  it("prevents removal, the native swipe included, exactly while a save is unresolved", async () => {
    const first = deferred<typeof saved>();
    const second = deferred<typeof saved>();
    jest.mocked(savePageGrade).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const buttons = await openCheck();
    expect(preventing()).toBe(false);
    await act(async () => {
      void buttons.onGrade(3);
    });
    expect(preventing()).toBe(true);
    await act(async () => first.reject(new Error("disk full")));
    await flush();
    expect(preventing()).toBe(false);
    await act(async () => {
      void grading().onGrade(3);
    });
    expect(preventing()).toBe(true);
    await act(async () => second.resolve(saved));
    await flush();
    expect(screen.getByText(s.hifzSummaryTitle)).toBeTruthy();
    expect(preventing()).toBe(false);
  });

  it("holds a back press during an unresolved save, then leaves once it is saved", async () => {
    const save = deferred<typeof saved>();
    jest.mocked(savePageGrade).mockReturnValue(save.promise);
    const buttons = await openCheck();
    await act(async () => {
      void buttons.onGrade(3);
    });
    let held = false;
    act(() => {
      held = back();
    });
    expect(held).toBe(true);
    // Close is dimmed while the leave waits for the save.
    expect(screen.getByRole("button", { name: s.genericClose }).props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => save.resolve(saved));
    await flush();
    // The held back press goes on to where it was going, not to the tabs.
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(BACK);
    expect(returnToTabs).not.toHaveBeenCalled();
    expect(endReviewSession).toHaveBeenCalled();
  });

  it("asks before a back press leaves graded pages, and goes back once confirmed", async () => {
    // Two pages, so grading the first leaves the session open with graded work in it.
    const row6 = { ...row, id: "page:madani15:6" } as StudyCardRow;
    jest.mocked(loadTodayWird).mockResolvedValue({
      plan: DEFAULT_HIFZ_PLAN,
      minutesPerReviewPage: 3,
      done: [],
      todo: [5, 6].map((page) => ({
        cardId: `page:madani15:${page}`,
        page,
        tier: "manzil",
        lastReviewDate: null,
        reviewedToday: false,
        dueDate: "2026-11-13",
        retrievability: 0.95,
      })),
    } as never);
    jest.mocked(loadPageCards).mockResolvedValue([pageCard, { ...pageCard, row: row6, page: 6 }]);
    jest.mocked(savePageGrade).mockResolvedValue(saved);
    const buttons = await openCheck();
    await act(async () => {
      await buttons.onGrade(3);
    });
    await flush();
    // The page is saved, so leaving now would leave graded work: the screen holds the press and asks.
    let held = false;
    act(() => {
      held = back();
    });
    expect(held).toBe(true);
    expect(screen.getByText(s.habitExitTitle)).toBeTruthy();
    fireEvent.press(screen.getByText(s.habitExitLeave));
    await flush();
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(BACK);
    expect(endReviewSession).toHaveBeenCalled();
  });

  it("holds a back press during an unresolved save, and stays to show a failure without carrying the leave over", async () => {
    const save = deferred<typeof saved>();
    jest.mocked(savePageGrade).mockReturnValueOnce(save.promise).mockResolvedValueOnce(saved);
    const buttons = await openCheck();
    await act(async () => {
      void buttons.onGrade(3);
    });
    expect(back()).toBe(true);
    await act(async () => save.reject(new Error("disk full")));
    await flush();
    expect(returnToTabs).not.toHaveBeenCalled();
    expect(screen.getByText(s.hifzSaveFailed)).toBeTruthy();
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(screen.getByText(s.hifzSummaryTitle)).toBeTruthy();
    expect(returnToTabs).not.toHaveBeenCalled();
  });

  it("lets a back press through when nothing is saving", async () => {
    await openCheck();
    expect(back()).toBe(false);
  });

  it("stays on the page to show a failed save when Close was pressed while it was unresolved", async () => {
    const save = deferred<typeof saved>();
    jest.mocked(savePageGrade).mockReturnValueOnce(save.promise).mockResolvedValueOnce(saved);
    const buttons = await openCheck();
    await act(async () => {
      void buttons.onGrade(3);
    });
    fireEvent.press(screen.getByRole("button", { name: s.genericClose }));
    await act(async () => save.reject(new Error("disk full")));
    await flush();
    expect(returnToTabs).not.toHaveBeenCalled();
    expect(screen.getByText(s.hifzSaveFailed)).toBeTruthy();
    // The page is still open, and the cancelled Close does not carry over to the retry.
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(savePageGrade).toHaveBeenCalledTimes(2);
    expect(screen.getByText(s.hifzSummaryTitle)).toBeTruthy();
    expect(returnToTabs).not.toHaveBeenCalled();
  });

  it("dismisses a drill once and refreshes the reader's weak-spot markers (ERR-06)", async () => {
    mockParams = { mode: "mistakes" };
    jest.mocked(readMistakeInbox).mockResolvedValue([inboxItem]);
    mockDatabase.getFirstAsync.mockResolvedValue({ text_qcf2: "a b", v2_page: 5 });
    const dismissal = deferred<void>();
    jest.mocked(dismissInboxItem).mockReturnValue(dismissal.promise);
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();
    fireEvent.press(screen.getByRole("button", { name: s.hifzDrillShow }));
    const dismiss = screen.getByRole("button", { name: s.hifzDrillDismiss });
    await act(async () => {
      fireEvent.press(dismiss);
      fireEvent.press(dismiss);
    });
    expect(dismissInboxItem).toHaveBeenCalledTimes(1);
    expect(recordDrillResult).not.toHaveBeenCalled();
    await act(async () => dismissal.resolve());
    await flush();
    expect(refreshWeakSpots).toHaveBeenCalledWith(mockDatabase);
    expect(dismissInboxItem).toHaveBeenCalledTimes(1);
    mockDatabase.getFirstAsync.mockResolvedValue(null);
  });

  // Review time counts toward the daily minimum, so time away from the screen must not.
  describe("time away from the screen", () => {
    controlDeviceLifecycle();

    it.each(AWAY_CASES)("counts only time on screen toward the page, the pace and the summary when %s", async (_label, how) => {
      jest.mocked(savePageGrade).mockResolvedValue(saved);
      await openCheck();
      deviceTime += MINUTE;
      stayAway(how, 6 * MINUTE);
      deviceTime += 2 * MINUTE;
      await act(async () => {
        void grading().onGrade(3);
      });
      await flush();
      // Three minutes on screen, not the nine since the page was shown.
      expect(jest.mocked(savePageGrade).mock.calls[0][1].durationMs).toBe(3 * MINUTE);
      expect(jest.mocked(recordReviewPace).mock.calls[0][1].minutes).toBe(3);
      expect(mockHabitInput?.durationMs).toBe(3 * MINUTE);
    });

    it("starts each page's time when it is shown, while the session counts them all", async () => {
      const row6 = { ...row, id: "page:madani15:6" } as StudyCardRow;
      jest.mocked(loadTodayWird).mockResolvedValue({
        plan: DEFAULT_HIFZ_PLAN,
        minutesPerReviewPage: 3,
        done: [],
        todo: [5, 6].map((page) => ({
          cardId: `page:madani15:${page}`,
          page,
          tier: "manzil",
          lastReviewDate: null,
          reviewedToday: false,
          dueDate: "2026-11-13",
          retrievability: 0.95,
        })),
      } as never);
      jest.mocked(loadPageCards).mockResolvedValue([pageCard, { ...pageCard, row: row6, page: 6 }]);
      jest.mocked(savePageGrade).mockResolvedValue(saved);
      await openCheck();
      deviceTime += MINUTE;
      stayAway("background", 6 * MINUTE);
      deviceTime += MINUTE;
      await act(async () => {
        await grading().onGrade(3);
      });
      await flush();
      deviceTime += MINUTE;
      fireEvent.press(screen.getByRole("button", { name: s.hifzDone }));
      await flush();
      deviceTime += MINUTE;
      await act(async () => {
        void grading().onGrade(3);
      });
      await flush();
      expect(jest.mocked(savePageGrade).mock.calls.map(([, input]) => input.durationMs)).toEqual([2 * MINUTE, 2 * MINUTE]);
      expect(jest.mocked(recordReviewPace).mock.calls[0][1]).toMatchObject({ minutes: 4, pages: 2 });
      expect(mockHabitInput?.durationMs).toBe(4 * MINUTE);
    });
  });
});

describe("sabaq screen", () => {
  const target = {
    page: 5,
    pageData,
    fromLine: 1,
    toLine: 1,
    lineNumbers: new Set([1]),
    ayahs: [{ surah: 2, ayah: 1 }],
    linkAyahs: [],
    completesPage: false,
    assigned: false,
  } satisfies SabaqTarget;

  const press = (name: string) => fireEvent.press(screen.getByRole("button", { name }));
  type ChunkSave = Awaited<ReturnType<typeof completeSabaqChunk>>;
  type CleanRunSave = Awaited<ReturnType<typeof saveSabaqCleanRun>>;
  const chunkSaved = { wird: { kind: "none" }, pageAdded: false } as unknown as ChunkSave;
  const cleanRunSaved = { wird: { kind: "none" }, pageAdded: false } as unknown as CleanRunSave;

  beforeEach(() => {
    jest.mocked(loadTodayWird).mockResolvedValue({
      plan: DEFAULT_HIFZ_PLAN,
      newLines: 3,
      sabaqLinesToday: 0,
      daily: { backlog: false },
    } as never);
    jest.mocked(nextSabaqTarget).mockResolvedValue(target);
    jest.mocked(saveSabaqCleanRun).mockResolvedValue(cleanRunSaved);
    jest.mocked(similarGroupsForAyahs).mockResolvedValue([]);
    jest.mocked(withMemorizedSiblings).mockReturnValue([]);
    jest.mocked(readMemorizedPageNumbers).mockResolvedValue(new Set());
  });

  /** Walk the lesson to step 6 with its last clean recitation to go and the lines shown. */
  async function openSabaqCleanRun() {
    render(<SabaqRoute />, { wrapper: Wrapper });
    await flush();
    // Intention, listening and meaning, then ten readings while looking.
    for (let step = 0; step < 3; step += 1) press(s.hifzSabaqNext);
    for (let reading = 0; reading < 10; reading += 1) press(s.hifzSabaqReadOnce);
    press(s.hifzSabaqNext);
    // One ayah, then the whole chunk twice, each from memory.
    for (let clean = 0; clean < 3; clean += 1) {
      press(s.hifzDrillShow);
      press(s.hifzSabaqClean);
    }
    press(s.hifzDrillShow);
    expect(screen.getByText("Clean in a row: 2 of 3")).toBeTruthy();
  }

  /** Walk the session through step 6's save and the link to its graded fluent check, and return its grade buttons. */
  async function openSabaqCheck() {
    await openSabaqCleanRun();
    press(s.hifzSabaqClean);
    await flush();
    press(s.hifzDrillShow);
    press(s.hifzSabaqClean);
    press(s.hifzDrillShow);
    return grading();
  }

  it.each(["en", "ar"] as const)(
    "compares the similar verses already memorized, each with its meaning, before memorizing (%s)",
    async (language) => {
      mockUiLanguage = language;
      const t = strings[language];
      const verse = (surah: number, ayah: number, surahName: string, page: number) => ({
        surah,
        ayah,
        surahName,
        pre: "أُو۟لَٰٓئِكَ",
        similar: "عَلَىٰ هُدًى",
        post: "مِّن رَّبِّهِمْ",
        page,
      });
      jest.mocked(withMemorizedSiblings).mockReturnValue([
        { groupId: "g1", kind: "similar", self: verse(2, 5, "البقرة", 2), siblings: [verse(31, 5, "لقمان", 411)] },
      ]);
      // The translations and the Muyassar tafsir for 2:5 and 31:5, copied from the bundled database.
      const meanings = {
        en: [
          "Those are upon [right] guidance from their Lord, and it is those who are the successful",
          "Those are on [right] guidance from their Lord, and it is those who are the successful",
        ],
        ar: [
          "أصحاب هذه الصفات يسيرون على نور من ربهم وبتوفيق مِن خالقهم وهاديهم، وهم الفائزون الذين أدركوا ما طلبوا، ونَجَوا من شرِّ ما منه هربوا.",
          "أولئك المتصفون بالصفات السابقة على بيان مِن ربهم ونور، وأولئك هم الفائزون في الدنيا والآخرة.",
        ],
      }[language];
      const reads = mockDatabase.getAllAsync as unknown as jest.Mock<Promise<unknown[]>, [string]>;
      reads.mockImplementation(async (source) =>
        source.includes(language === "ar" ? "FROM tafseer WHERE source = 'muyassar'" : "FROM translations")
          ? [
              { surah: 2, ayah: 5, text: meanings[0] },
              { surah: 31, ayah: 5, text: meanings[1] },
            ]
          : [],
      );
      try {
        render(<SabaqRoute />, { wrapper: Wrapper });
        await flush();
        // Intention, listening and the chunk's meaning come first.
        for (let step = 0; step < 3; step += 1) press(t.hifzSabaqNext);
        expect(screen.getByText(t.hifzSimilarTitle)).toBeTruthy();
        // The chunk's verse shows its meaning; the memorized sibling's waits behind its button.
        expect(await screen.findByText(meanings[0])).toBeTruthy();
        expect(screen.queryByText(meanings[1])).toBeNull();
        press(t.hifzSimilarShowMeaning);
        expect(screen.getByText(meanings[1])).toBeTruthy();
        // Each verse's reference with its page, the context cue (MUT-01).
        expect(screen.getByText(language === "ar" ? "لقمان ٣١:٥، صفحة ٤١١" : "لقمان\u200E 31:5 · Page 411")).toBeTruthy();
      } finally {
        reads.mockImplementation(async () => []);
      }
    },
  );

  it("does not show the page and lines again under the intention heading", async () => {
    render(<SabaqRoute />, { wrapper: Wrapper });
    await flush();
    expect(screen.getByText(s.hifzSabaqIntention)).toBeTruthy();
    expect(screen.getAllByText(`Page 5 · Lines 1 to 1`)).toHaveLength(1);
  });

  it("saves the chunk once step 6's clean run is met, then moves on to the link (SBQ-02)", async () => {
    await openSabaqCleanRun();
    expect(saveSabaqCleanRun).not.toHaveBeenCalled();
    press(s.hifzSabaqClean);
    await flush();
    expect(saveSabaqCleanRun).toHaveBeenCalledTimes(1);
    expect(jest.mocked(saveSabaqCleanRun).mock.calls[0][1]).toEqual({
      target,
      plan: DEFAULT_HIFZ_PLAN,
      session: { id: "session-1" },
      durationMs: expect.any(Number),
    });
    expect(emitHabitChanged).toHaveBeenCalled();
    expect(screen.getByText(s.hifzSabaqStepLink)).toBeTruthy();
    expect(completeSabaqChunk).not.toHaveBeenCalled();
  });

  it("keeps the lesson's chunk and session when the language changes after step 6 saved it", async () => {
    // Loading again would choose the next lines, since step 6 memorized these.
    jest.mocked(nextSabaqTarget).mockResolvedValueOnce(target).mockResolvedValue({ ...target, fromLine: 2, toLine: 2, lineNumbers: new Set([2]) });
    await openSabaqCleanRun();
    press(s.hifzSabaqClean);
    await flush();
    mockUiLanguage = "ar";
    screen.rerender(<SabaqRoute />);
    await flush();
    mockUiLanguage = "en";
    screen.rerender(<SabaqRoute />);
    await flush();
    expect(nextSabaqTarget).toHaveBeenCalledTimes(1);
    expect(startReviewSession).toHaveBeenCalledTimes(1);
    // Only the meanings followed the language.
    expect(mockDatabase.getFirstAsync).toHaveBeenCalledWith(expect.stringContaining("FROM tafseer"), [2, 1]);
    expect(screen.getByText(s.hifzSabaqStepLink)).toBeTruthy();
    press(s.hifzDrillShow);
    press(s.hifzSabaqClean);
    press(s.hifzDrillShow);
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(jest.mocked(completeSabaqChunk).mock.calls[0][1]).toMatchObject({ target, session: { id: "session-1" } });
  });

  it("holds a back press during step 6's unresolved save, then goes back once it is saved, keeping the chunk", async () => {
    const save = deferred<CleanRunSave>();
    jest.mocked(saveSabaqCleanRun).mockReturnValue(save.promise);
    await openSabaqCleanRun();
    press(s.hifzSabaqClean);
    let held = false;
    act(() => {
      held = back();
    });
    expect(held).toBe(true);
    // During the save the press waits for it rather than asking.
    expect(screen.queryByText(s.hifzSabaqExitTitle)).toBeNull();
    await act(async () => save.resolve(cleanRunSaved));
    await flush();
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(BACK);
    expect(endReviewSession).toHaveBeenCalled();
    expect(emitHabitChanged).toHaveBeenCalled();
    expect(completeSabaqChunk).not.toHaveBeenCalled();
  });

  it("holds a back press during step 6's unresolved save, and stays on step 6 to show a failure and save again", async () => {
    const save = deferred<CleanRunSave>();
    jest.mocked(saveSabaqCleanRun).mockReturnValueOnce(save.promise).mockResolvedValueOnce(cleanRunSaved);
    await openSabaqCleanRun();
    press(s.hifzSabaqClean);
    let held = false;
    act(() => {
      held = back();
    });
    expect(held).toBe(true);
    await act(async () => save.reject(new Error("disk full")));
    await flush();
    expect(mockNavigation.dispatch).not.toHaveBeenCalledWith(BACK);
    expect(returnToTabs).not.toHaveBeenCalled();
    // No grade was given at step 6, so the error names the lines and the button that saves them.
    expect(screen.getByText(s.hifzSabaqCleanRunSaveFailed)).toBeTruthy();
    expect(screen.getByText(s.hifzSabaqStepChunk)).toBeTruthy();
    // The met clean run is saved again, not started over.
    expect(screen.getByRole("button", { name: s.hifzSabaqNotYet })).toBeDisabled();
    // Nothing of the lesson is saved, so leaving asks again.
    expect(preventing()).toBe(true);
    // The same button saves again, and the cancelled back press does not carry over.
    press(s.hifzSabaqClean);
    await flush();
    expect(saveSabaqCleanRun).toHaveBeenCalledTimes(2);
    expect(screen.getByText(s.hifzSabaqStepLink)).toBeTruthy();
    expect(screen.queryByText(s.hifzSabaqCleanRunSaveFailed)).toBeNull();
    // The link step's own "Not yet" is open again.
    press(s.hifzDrillShow);
    expect(screen.getByRole("button", { name: s.hifzSabaqNotYet })).toBeEnabled();
    expect(mockNavigation.dispatch).not.toHaveBeenCalledWith(BACK);
  });

  it("leaves the link without asking once step 6 saved the chunk", async () => {
    await openSabaqCleanRun();
    press(s.hifzSabaqClean);
    await flush();
    expect(screen.getByText(s.hifzSabaqStepLink)).toBeTruthy();
    expect(preventing()).toBe(false);
    press(s.genericClose);
    await flush();
    expect(screen.queryByText(s.hifzSabaqExitTitle)).toBeNull();
    expect(exits).toEqual(["left"]);
    expect(endReviewSession).toHaveBeenCalled();
    expect(completeSabaqChunk).not.toHaveBeenCalled();
  });

  it("waits for the check's unresolved grade before leaving on Close, then leaves once it is saved", async () => {
    const save = deferred<ChunkSave>();
    jest.mocked(completeSabaqChunk).mockReturnValue(save.promise);
    const buttons = await openSabaqCheck();
    await act(async () => {
      void buttons.onGrade(3);
    });
    press(s.genericClose);
    expect(returnToTabs).not.toHaveBeenCalled();
    await act(async () => save.resolve(chunkSaved));
    await flush();
    // The screen leaves while removal is still prevented; its own exit goes through.
    expect(exits).toEqual(["left"]);
    expect(endReviewSession).toHaveBeenCalled();
  });

  it("asks before Close or a back press leaves an unsaved lesson, and goes once confirmed", async () => {
    await openSabaqCleanRun();
    // Close asks, and staying keeps the lesson.
    press(s.genericClose);
    expect(screen.getByText(s.hifzSabaqExitTitle)).toBeTruthy();
    press(s.hifzSabaqExitStay);
    await flush();
    expect(returnToTabs).not.toHaveBeenCalled();
    // A back press asks the same, and leaving carries it out.
    let held = false;
    act(() => {
      held = back();
    });
    expect(held).toBe(true);
    press(s.hifzSabaqExitLeave);
    await flush();
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(BACK);
    expect(endReviewSession).toHaveBeenCalled();
    expect(saveSabaqCleanRun).not.toHaveBeenCalled();
  });

  it("prevents removal, the native swipe included, through the unsaved lesson and step 6's save, and not once the chunk is saved", async () => {
    const save = deferred<CleanRunSave>();
    jest.mocked(saveSabaqCleanRun).mockReturnValue(save.promise);
    await openSabaqCleanRun();
    expect(preventing()).toBe(true);
    press(s.hifzSabaqClean);
    expect(preventing()).toBe(true);
    await act(async () => save.resolve(cleanRunSaved));
    await flush();
    expect(preventing()).toBe(false);
    expect(back()).toBe(false);
  });

  it("prevents removal during the check's save, and not once it is saved while the summary loads", async () => {
    const save = deferred<ChunkSave>();
    jest.mocked(completeSabaqChunk).mockReturnValue(save.promise);
    const overview = deferred<null>();
    jest.mocked(loadHabitOverview).mockReturnValue(overview.promise as never);
    const buttons = await openSabaqCheck();
    expect(preventing()).toBe(false);
    await act(async () => {
      void buttons.onGrade(3);
    });
    expect(preventing()).toBe(true);
    await act(async () => save.resolve(chunkSaved));
    await flush();
    // Saved; the summary is still loading, and leaving now is not held.
    expect(preventing()).toBe(false);
    expect(back()).toBe(false);
    await act(async () => overview.resolve(null));
    await flush();
    expect(preventing()).toBe(false);
  });

  it("holds a back press during the check's unresolved grade, and stays to show a failure without carrying the leave over", async () => {
    const save = deferred<ChunkSave>();
    jest.mocked(completeSabaqChunk).mockReturnValueOnce(save.promise).mockResolvedValueOnce(chunkSaved);
    const buttons = await openSabaqCheck();
    await act(async () => {
      void buttons.onGrade(3);
    });
    let held = false;
    act(() => {
      held = back();
    });
    expect(held).toBe(true);
    // During the save the press waits for it rather than asking.
    expect(screen.queryByText(s.hifzSabaqExitTitle)).toBeNull();
    await act(async () => save.reject(new Error("disk full")));
    await flush();
    expect(returnToTabs).not.toHaveBeenCalled();
    expect(mockNavigation.dispatch).not.toHaveBeenCalledWith(BACK);
    expect(screen.getByText(s.hifzSaveFailed)).toBeTruthy();
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(screen.getByText(s.hifzSabaqDoneTitle)).toBeTruthy();
    expect(returnToTabs).not.toHaveBeenCalled();
  });

  it("stays on the check to show a failed grade when Close was pressed while it was unresolved", async () => {
    const save = deferred<ChunkSave>();
    jest.mocked(completeSabaqChunk).mockReturnValueOnce(save.promise).mockResolvedValueOnce(chunkSaved);
    const buttons = await openSabaqCheck();
    await act(async () => {
      void buttons.onGrade(3);
    });
    press(s.genericClose);
    await act(async () => save.reject(new Error("disk full")));
    await flush();
    expect(returnToTabs).not.toHaveBeenCalled();
    expect(screen.getByText(s.hifzSaveFailed)).toBeTruthy();
    // The check is still open, and the cancelled Close does not carry over to the retry.
    await act(async () => {
      void grading().onGrade(3);
    });
    await flush();
    expect(completeSabaqChunk).toHaveBeenCalledTimes(2);
    expect(screen.getByText(s.hifzSabaqDoneTitle)).toBeTruthy();
    expect(returnToTabs).not.toHaveBeenCalled();
  });

  it("does not call the lines memorized after a failed fluent check (SBQ-02)", async () => {
    jest.mocked(completeSabaqChunk).mockResolvedValueOnce(chunkSaved);
    const buttons = await openSabaqCheck();
    await act(async () => {
      void buttons.onGrade(1);
    });
    await flush();
    expect(screen.getByText(s.hifzSabaqNotFluentTitle)).toBeTruthy();
    expect(screen.getByText(s.hifzSabaqNotFluent)).toBeTruthy();
    expect(screen.queryByText(s.hifzSabaqDoneTitle)).toBeNull();
    expect(screen.queryByText(s.hifzSabaqDone)).toBeNull();
    expect(saveSabaqCleanRun).toHaveBeenCalledTimes(1);
  });

  it("says the second look is ready now after a check graded Again, instead of waiting for new lines (SBQ-03)", async () => {
    jest.mocked(completeSabaqChunk).mockResolvedValueOnce({ ...chunkSaved, secondLookAt: null, secondLookNow: true });
    const buttons = await openSabaqCheck();
    await act(async () => {
      void buttons.onGrade(1);
    });
    await flush();
    expect(screen.getByText(s.hifzSabaqNotFluentTitle)).toBeTruthy();
    expect(screen.getByText(s.hifzSabaqSecondLookNow)).toBeTruthy();
    expect(screen.queryByText(s.hifzSabaqNotFluent)).toBeNull();
  });

  it("saves the chunk once when the fluent check is graded twice, and not again after it is saved", async () => {
    const save = deferred<ChunkSave>();
    jest.mocked(completeSabaqChunk).mockReturnValue(save.promise);
    const buttons = await openSabaqCheck();
    await act(async () => {
      void buttons.onGrade(3);
      void buttons.onGrade(3);
    });
    expect(completeSabaqChunk).toHaveBeenCalledTimes(1);
    await act(async () => save.resolve(chunkSaved));
    await flush();
    await act(async () => {
      void buttons.onGrade(3);
    });
    expect(completeSabaqChunk).toHaveBeenCalledTimes(1);
  });

  // The lesson's time counts toward the daily minimum, so time away from the screen must not.
  describe("time away from the screen", () => {
    controlDeviceLifecycle();

    it.each(AWAY_CASES)("counts only time on screen toward step 6, the check and the summary when %s", async (_label, how) => {
      jest.mocked(saveSabaqCleanRun).mockResolvedValue({ wird: { kind: "minimum_met" }, pageAdded: false } as unknown as CleanRunSave);
      jest.mocked(completeSabaqChunk).mockResolvedValue(chunkSaved);
      await openSabaqCleanRun();
      deviceTime += 2 * MINUTE;
      stayAway(how, 5 * MINUTE);
      deviceTime += 2 * MINUTE;
      press(s.hifzSabaqClean);
      await flush();
      // Step 6 saves the lesson's four minutes on screen so far; the check's time starts after it.
      expect(jest.mocked(saveSabaqCleanRun).mock.calls[0][1].durationMs).toBe(4 * MINUTE);
      press(s.hifzDrillShow);
      press(s.hifzSabaqClean);
      press(s.hifzDrillShow);
      deviceTime += MINUTE;
      stayAway(how, 6 * MINUTE);
      deviceTime += 2 * MINUTE;
      await act(async () => {
        void grading().onGrade(3);
      });
      await flush();
      expect(jest.mocked(completeSabaqChunk).mock.calls[0][1].durationMs).toBe(3 * MINUTE);
      // The summary covers the whole lesson and keeps the minimum step 6 met, though the check met nothing new.
      expect(mockHabitInput?.durationMs).toBe(7 * MINUTE);
      expect(mockHabitInput?.event).toEqual({ kind: "minimum_met" });
    });
  });
});
