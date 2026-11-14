import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import HifzReviewRoute from "@/app/hifz/review";
import type { GradingButtons } from "@/components/flashcards/GradingButtons";
import { endReviewSession, startReviewSession } from "@/lib/fsrs/review-sessions";
import { readDeckReviewSettings } from "@/lib/fsrs/queries";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { loadHabitOverview } from "@/lib/habit/queries";
import { loadDriftDrills, readMistakeInbox, type DriftDrill } from "@/lib/hifz/errors";
import { loadRecitationPage, type RecitationPage } from "@/lib/hifz/page-data";
import { loadPageCards, loadTodayWird, toPlanPage, type PageCard } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN } from "@/lib/hifz/plan";
import { loadDueRemediation } from "@/lib/hifz/remediation";
import { recordReviewPace, savePageGrade } from "@/lib/hifz/review";
import type { SimilarRef } from "@/lib/hifz/similar";
import { strings } from "@/lib/i18n/strings";

/** SCH-07 and MUT-04 on the review screen: a drift's sibling page, then the "Which one" prompt for the pair. */

type GradingProps = React.ComponentProps<typeof GradingButtons>;

const mockDatabase = {
  getAllAsync: jest.fn(async () => []),
  getFirstAsync: jest.fn(async (): Promise<unknown> => null),
};
const mockNavigation = { getState: () => undefined, dispatch: jest.fn() };
let mockGrading: GradingProps | null = null;
let mockLanguage: "en" | "ar" = "en";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({}), useNavigation: () => mockNavigation }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual<typeof import("@react-navigation/native")>("@react-navigation/native"),
  usePreventRemove: () => undefined,
  useIsFocused: () => true,
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
    useSettings: () => ({
      ...actual.useSettings(),
      isDark: false,
      isRTL: mockLanguage === "ar",
      uiLanguage: mockLanguage,
      fontSize: 20,
      lineHeight: 40,
    }),
  };
});
jest.mock("@/lib/haptics", () => ({ hapticMedium: jest.fn() }));
jest.mock("@/components/mushaf/MushafPage", () => ({ loadPageWordsData: jest.fn(async () => null) }));
jest.mock("@/components/hifz/RecitationPage", () => ({
  HIDDEN: { all: false, count: 0, touchedLines: new Set() },
  RecitationPage: () => null,
  visibleLines: (page: RecitationPage) => page.lines,
  orderedTokens: (lines: RecitationPage["lines"]) => lines.flatMap((line) => line.tokens),
}));
jest.mock("@/components/flashcards/GradingButtons", () => ({
  GradingButtons: (props: GradingProps) => {
    mockGrading = props;
    return null;
  },
  getGradeSchedulePreviews: () => ({}),
}));
jest.mock("@/components/flashcards/Qcf2AyahText", () => ({ Qcf2AyahText: () => null }));
jest.mock("@/components/hifz/MistakeTypeSheet", () => ({ MistakeTypeSheet: () => null, errorTypeLabel: () => "" }));
jest.mock("@/components/habit/SessionHabitCards", () => ({
  SessionHabitCards: () => null,
  showsCommitment: () => false,
  useCommitmentLabel: (_db: unknown, s: { habitCommitTomorrow: string }) => s.habitCommitTomorrow,
  strongerWirdEvent: (current: unknown) => current,
}));
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
jest.mock("@/lib/hifz/pages", () => ({ loadTodayWird: jest.fn(), loadPageCards: jest.fn(), toPlanPage: jest.fn() }));
jest.mock("@/lib/hifz/page-data", () => ({ loadRecitationPage: jest.fn() }));
jest.mock("@/lib/hifz/errors", () => ({
  ...jest.requireActual<typeof import("@/lib/hifz/errors")>("@/lib/hifz/errors"),
  readMistakeInbox: jest.fn(),
  loadDriftDrills: jest.fn(),
}));
jest.mock("@/lib/hifz/remediation", () => ({
  ...jest.requireActual<typeof import("@/lib/hifz/remediation")>("@/lib/hifz/remediation"),
  loadDueRemediation: jest.fn(),
}));
jest.mock("@/lib/hifz/review", () => ({
  ...jest.requireActual<typeof import("@/lib/hifz/review")>("@/lib/hifz/review"),
  savePageGrade: jest.fn(),
  recordReviewPace: jest.fn(),
}));
jest.mock("@/lib/hifz/use-weak-spots", () => ({ refreshWeakSpots: jest.fn() }));

const ref = (surah: number, ayah: number, surahName: string, page: number): SimilarRef => ({
  surah,
  ayah,
  surahName,
  pre: "أُو۟لَٰٓئِكَ",
  similar: "عَلَىٰ هُدًى",
  post: surah === 2 ? "مِّن رَّبِّهِمْ" : "مِّن رَّبِّهِمْ ۖ",
  page,
});
const pair = { groupId: "g1", self: ref(2, 5, "البقرة", 2), sibling: ref(31, 5, "لقمان", 411) };
const row = { id: "page:madani15:411", deck_id: "hifz-pages", tier: "manzil" } as StudyCardRow;
const siblingCard: PageCard = {
  row,
  page: 411,
  tier: "manzil",
  history: { declared: true, firstFluentDate: null, grades: [] },
};
const pageData: RecitationPage = {
  page: 411,
  lines: [
    {
      lineNumber: 1,
      kind: "ayah",
      centered: false,
      surahNumber: null,
      tokens: [{ glyph: "g", surah: 31, ayah: 5, wordPos: 1, isMarker: false, firstLetter: "أ" }],
    },
  ],
  ayahs: [{ surah: 31, ayah: 5 }],
};

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

function drift(sessionsSince: number): DriftDrill {
  return { errorId: "err-drift", pair, siblingPage: sessionsSince === 0 ? 411 : null, sessionsSince };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGrading = null;
  mockLanguage = "en";
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.mocked(startReviewSession).mockReturnValue({ id: "session-1" } as never);
  jest.mocked(endReviewSession).mockResolvedValue(null as never);
  jest.mocked(loadHabitOverview).mockResolvedValue(null as never);
  jest.mocked(readDeckReviewSettings).mockResolvedValue({} as never);
  jest.mocked(recordReviewPace).mockResolvedValue(undefined);
  jest
    .mocked(loadTodayWird)
    .mockResolvedValue({ plan: DEFAULT_HIFZ_PLAN, minutesPerReviewPage: 3, done: [], todo: [], total: 0 } as never);
  jest.mocked(loadPageCards).mockResolvedValue([siblingCard]);
  jest.mocked(toPlanPage).mockReturnValue({ retrievability: 0.95 } as never);
  jest.mocked(readMistakeInbox).mockResolvedValue([]);
  jest.mocked(loadDueRemediation).mockResolvedValue([]);
  jest.mocked(loadRecitationPage).mockResolvedValue(pageData);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("drift follow-ups on the review screen", () => {
  it("recites the sibling page, then asks which verse is which, in English", async () => {
    const s = strings.en;
    jest.mocked(loadDriftDrills).mockResolvedValue([drift(0)]);
    jest.mocked(savePageGrade).mockResolvedValue({
      wird: { kind: "none" },
      tier: "manzil",
      remediation: { half: null, seam: null },
      transition: { updatedCard: row, shouldRequeueInSession: false, reviewRecord: { rating: 3 } },
    } as never);
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();

    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(screen.getByText(s.hifzSimilarTitle)).toBeTruthy();
    expect(screen.getByText("Recite this page too. It holds 31:5, the verse similar to 2:5.")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: s.hifzDone }));
    await act(async () => {
      await mockGrading?.onGrade(3);
    });
    await flush();
    expect(jest.mocked(savePageGrade).mock.calls[0][1].card).toBe(row);

    // The first session after the drift asks for the verse that was being recited.
    expect(screen.getByText("2 / 2")).toBeTruthy();
    expect(screen.getByText(s.hifzPairTitle)).toBeTruthy();
    expect(screen.getByText(s.hifzPairPrompt)).toBeTruthy();
    expect(screen.getByText("البقرة 2:5")).toBeTruthy();
    // The options hide their references until one is chosen.
    expect(screen.queryByText("لقمان 31:5")).toBeNull();
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(2);
    expect(screen.queryByRole("button", { name: s.hifzSabaqNext })).toBeNull();

    fireEvent.press(options[1]);
    expect(screen.getByText(s.hifzPairOther)).toBeTruthy();
    expect(screen.getByText("لقمان 31:5")).toBeTruthy();
    expect(screen.getAllByText("البقرة 2:5")).toHaveLength(2);
    fireEvent.press(screen.getByRole("button", { name: s.hifzSabaqNext }));
    await flush();
    expect(screen.getByText(s.hifzSummaryTitle)).toBeTruthy();
  });

  it("asks for the sibling in a later session, in Arabic, without its page again", async () => {
    mockLanguage = "ar";
    const s = strings.ar;
    jest.mocked(loadDriftDrills).mockResolvedValue([drift(1)]);
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();

    // One item: the pair prompt, with no sibling page after the first session.
    expect(screen.getByText("١ / ١")).toBeTruthy();
    expect(screen.getByText(s.hifzPairTitle)).toBeTruthy();
    expect(screen.getByText(s.hifzPairPrompt)).toBeTruthy();
    expect(screen.getByText("لقمان ٣١:٥")).toBeTruthy();
    fireEvent.press(screen.getAllByRole("radio")[1]);
    expect(screen.getByText(s.hifzPairRight)).toBeTruthy();
    expect(screen.getByText("البقرة ٢:٥")).toBeTruthy();
    expect(screen.getByRole("button", { name: s.hifzSabaqNext })).toBeTruthy();
  });
});
