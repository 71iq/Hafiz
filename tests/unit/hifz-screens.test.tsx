import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import HifzReviewRoute from "@/app/hifz/review";
import SabaqRoute from "@/app/hifz/sabaq";
import type { GradingButtons } from "@/components/flashcards/GradingButtons";
import type { SessionHabitInput } from "@/components/habit/SessionHabitCards";
import { endReviewSession, startReviewSession } from "@/lib/fsrs/review-sessions";
import { readDeckReviewSettings } from "@/lib/fsrs/queries";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { loadHabitOverview } from "@/lib/habit/queries";
import { readHabitSettings } from "@/lib/habit/settings";
import { dismissInboxItem, readMistakeInbox, recordDrillResult, type InboxItem } from "@/lib/hifz/errors";
import { loadRecitationPage, type PageToken, type RecitationPage } from "@/lib/hifz/page-data";
import { loadPageCards, loadTodayWird, readMemorizedPageNumbers, type PageCard } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN } from "@/lib/hifz/plan";
import { loadDueRemediation } from "@/lib/hifz/remediation";
import { recordReviewPace, savePageGrade } from "@/lib/hifz/review";
import { completeSabaqChunk, nextSabaqTarget, type SabaqTarget } from "@/lib/hifz/sabaq";
import { similarGroupsForAyahs, withMemorizedSiblings } from "@/lib/hifz/similar";
import { refreshWeakSpots } from "@/lib/hifz/use-weak-spots";
import { strings } from "@/lib/i18n/strings";
import { returnToTabs } from "@/lib/navigation/return-to-tabs";

type GradingProps = React.ComponentProps<typeof GradingButtons>;

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
let mockHabitInput: SessionHabitInput | null = null;
// A stable object: the sabaq screen reloads whenever `stop` changes identity.
const mockAudio = {
  playRange: jest.fn(async () => undefined),
  rangeState: { active: false, paused: false },
  stop: jest.fn(),
  togglePause: jest.fn(),
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ getState: () => undefined }),
}));
jest.mock("@/lib/navigation/return-to-tabs", () => ({ returnToTabs: jest.fn() }));
jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDatabase,
  useDatabaseStatus: () => ({ isReady: true, progress: null, error: null }),
}));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return {
    ...actual,
    useSettings: () => ({ ...actual.useSettings(), isDark: false, isRTL: false, uiLanguage: "en", fontSize: 20, lineHeight: 40 }),
  };
});
jest.mock("@/lib/haptics", () => ({ hapticMedium: jest.fn(), hapticSuccess: jest.fn() }));
jest.mock("@/lib/audio/ayah-audio", () => ({ useAyahAudio: () => mockAudio }));
jest.mock("@/components/mushaf/MushafPage", () => ({ loadPageWordsData: jest.fn(async () => null) }));
jest.mock("@/components/hifz/RecitationPage", () => ({
  HIDDEN: { all: false, count: 0, touchedLines: new Set() },
  RecitationPage: () => null,
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
  strongerWirdEvent: (current: unknown, next: { kind: string }) => (next.kind === "none" ? current : next),
}));
jest.mock("@/components/habit/ZaytMood", () => ({ ZaytMood: () => null }));
jest.mock("@/components/ui/Toast", () => ({ Toast: () => null }));
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
jest.mock("@/lib/hifz/sabaq", () => ({ completeSabaqChunk: jest.fn(), nextSabaqTarget: jest.fn() }));
jest.mock("@/lib/hifz/similar", () => ({ similarGroupsForAyahs: jest.fn(), withMemorizedSiblings: jest.fn() }));
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
const saved = { wird: { kind: "none" }, tier: "manzil", remediation: { half: null, seam: null } } as unknown as Awaited<ReturnType<typeof savePageGrade>>;
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

let warnings: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockGrading = null;
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
    } as never);
    jest.mocked(loadPageCards).mockResolvedValue([pageCard]);
    jest.mocked(readMistakeInbox).mockResolvedValue([]);
    jest.mocked(loadDueRemediation).mockResolvedValue([]);
    jest.mocked(loadRecitationPage).mockResolvedValue(pageData);
  });

  async function openCheck() {
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();
    fireEvent.press(screen.getByRole("button", { name: s.hifzDone }));
    await flush();
    return grading();
  }

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
    expect(returnToTabs).toHaveBeenCalledTimes(1);
    expect(endReviewSession).toHaveBeenCalled();
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
  } satisfies SabaqTarget;

  beforeEach(() => {
    jest.mocked(loadTodayWird).mockResolvedValue({ plan: DEFAULT_HIFZ_PLAN, newLines: 3, sabaqLinesToday: 0 } as never);
    jest.mocked(nextSabaqTarget).mockResolvedValue(target);
    jest.mocked(similarGroupsForAyahs).mockResolvedValue([]);
    jest.mocked(withMemorizedSiblings).mockReturnValue([]);
    jest.mocked(readMemorizedPageNumbers).mockResolvedValue(new Set());
  });

  const press = (name: string) => fireEvent.press(screen.getByRole("button", { name }));
  type ChunkSave = Awaited<ReturnType<typeof completeSabaqChunk>>;
  const chunkSaved = { wird: { kind: "none" }, pageAdded: false } as unknown as ChunkSave;

  /** Walk the session to its graded fluent check and return its grade buttons. */
  async function openSabaqCheck() {
    render(<SabaqRoute />, { wrapper: Wrapper });
    await flush();
    // Intention, listening and meaning, then ten readings while looking.
    for (let step = 0; step < 3; step += 1) press(s.hifzSabaqNext);
    for (let reading = 0; reading < 10; reading += 1) press(s.hifzSabaqReadOnce);
    press(s.hifzSabaqNext);
    // One ayah, the whole chunk three times, then the link, each from memory.
    for (let clean = 0; clean < 5; clean += 1) {
      press(s.hifzDrillShow);
      press(s.hifzSabaqClean);
    }
    press(s.hifzDrillShow);
    return grading();
  }

  it("does not show the page and lines again under the intention heading", async () => {
    render(<SabaqRoute />, { wrapper: Wrapper });
    await flush();
    expect(screen.getByText(s.hifzSabaqIntention)).toBeTruthy();
    expect(screen.getAllByText(`Page 5 · Lines 1 to 1`)).toHaveLength(1);
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
    expect(returnToTabs).toHaveBeenCalledTimes(1);
    expect(endReviewSession).toHaveBeenCalled();
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
});
