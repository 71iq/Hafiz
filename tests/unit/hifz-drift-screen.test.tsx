import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import HifzReviewRoute from "@/app/hifz/review";
import type { GradingButtons } from "@/components/flashcards/GradingButtons";
import { endReviewSession, startReviewSession } from "@/lib/fsrs/review-sessions";
import { readDeckReviewSettings } from "@/lib/fsrs/queries";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { loadHabitOverview } from "@/lib/habit/queries";
import { dismissInboxItem, loadDriftDrills, readMistakeInbox, type DriftDrill, type InboxItem } from "@/lib/hifz/errors";
import { INTERLEAVE_PROMPTS_PER_SESSION } from "@/lib/hifz/interleave";
import { loadRecitationPage, type RecitationPage } from "@/lib/hifz/page-data";
import { loadPageCards, loadTodayWird, readMemorizedPageNumbers, toPlanPage, type PageCard } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN } from "@/lib/hifz/plan";
import { loadDueRemediation } from "@/lib/hifz/remediation";
import { recordReviewPace, savePageGrade } from "@/lib/hifz/review";
import { similarGroupsOnPages, similarPair, type SimilarGroup, type SimilarRef } from "@/lib/hifz/similar";
import { refreshWeakSpots } from "@/lib/hifz/use-weak-spots";
import { formatNumber } from "@/lib/i18n/count";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";

/** A verse reference as English shows it: the Arabic surah name isolated so the digits keep their order. */
const refLabel = (surahName: string, ref: string) => `${surahName}\u200E ${ref}`;

/**
 * SCH-07 and MUT-04 on the review screen: a drift's sibling page, then the "Which one" prompt for the
 * pair, which leave the session when the drift is dismissed. MUT-03: a reviewed page with a memorized
 * similar verse brings the prompt two pages later. MUT-05: the prompt shows meanings once answered.
 */

type GradingProps = React.ComponentProps<typeof GradingButtons>;

/** MUT-05: the meanings the screen reads for its pair prompts, copied from the bundled database. */
const MEANINGS = [
  {
    surah: 2,
    ayah: 5,
    en: "Those are upon [right] guidance from their Lord, and it is those who are the successful",
    ar: "أصحاب هذه الصفات يسيرون على نور من ربهم وبتوفيق مِن خالقهم وهاديهم، وهم الفائزون الذين أدركوا ما طلبوا، ونَجَوا من شرِّ ما منه هربوا.",
  },
  {
    surah: 31,
    ayah: 5,
    en: "Those are on [right] guidance from their Lord, and it is those who are the successful",
    ar: "أولئك المتصفون بالصفات السابقة على بيان مِن ربهم ونور، وأولئك هم الفائزون في الدنيا والآخرة.",
  },
];

const mockDatabase = {
  getAllAsync: jest.fn(async (source: string): Promise<unknown[]> => {
    if (/FROM translations/.test(source)) return MEANINGS.map(({ surah, ayah, en }) => ({ surah, ayah, text: en }));
    if (/FROM tafseer/.test(source)) return MEANINGS.map(({ surah, ayah, ar }) => ({ surah, ayah, text: ar }));
    return [];
  }),
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
  loadDriftDrills: jest.fn(),
  dismissInboxItem: jest.fn(),
}));
jest.mock("@/lib/hifz/similar", () => ({
  ...jest.requireActual<typeof import("@/lib/hifz/similar")>("@/lib/hifz/similar"),
  similarGroupsOnPages: jest.fn(),
  similarPair: jest.fn(),
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
  return { errorId: "err-drift", errorIds: ["err-drift"], pair, siblingPage: sessionsSince === 0 ? 411 : null, sessionsSince };
}

/** The drift's own inbox item, which the session drills before the drift's follow-ups. */
function driftInbox(id: string): InboxItem {
  return {
    id,
    cardId: "page:madani15:2",
    surah: 2,
    ayah: 5,
    word: 3,
    type: "mutashabih_drift",
    corrected: "none",
    siblingRef: "31:5",
    localDate: "2026-11-12",
    cleanCount: 0,
  };
}

const saved = {
  wird: { kind: "none" },
  tier: "manzil",
  remediation: { half: null, seam: null },
  transition: { updatedCard: row, shouldRequeueInSession: false, reviewRecord: { rating: 3 } },
} as never;

function planCard(page: number): PageCard {
  const card = { id: `page:madani15:${page}`, deck_id: "hifz-pages", tier: "manzil" } as StudyCardRow;
  return { row: card, page, tier: "manzil", history: { declared: true, firstFluentDate: null, grades: [] } };
}

/** Today's wird of the given pages, in order. */
function planOf(pages: readonly number[]) {
  const cards = pages.map(planCard);
  jest.mocked(loadTodayWird).mockResolvedValue({
    plan: DEFAULT_HIFZ_PLAN,
    minutesPerReviewPage: 3,
    done: [],
    todo: cards.map((card) => ({ cardId: card.row.id, page: card.page, retrievability: 0.95 })),
    total: cards.length,
  } as never);
  jest.mocked(loadPageCards).mockResolvedValue([...cards, siblingCard]);
}

function group(self: SimilarRef, siblings: SimilarRef[], groupId = "g1"): SimilarGroup {
  return { groupId, kind: "similar", self, siblings };
}

/** Recite the page on screen and grade it Good. */
async function gradePage(language: "en" | "ar" = "en") {
  fireEvent.press(screen.getByRole("button", { name: strings[language].hifzDone }));
  await act(async () => {
    await mockGrading?.onGrade(3);
  });
  await flush();
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
  jest.mocked(loadDriftDrills).mockResolvedValue([]);
  jest.mocked(dismissInboxItem).mockResolvedValue(undefined);
  jest.mocked(refreshWeakSpots).mockResolvedValue(undefined);
  jest.mocked(readMemorizedPageNumbers).mockResolvedValue(new Set());
  jest.mocked(similarGroupsOnPages).mockResolvedValue([]);
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
    expect(screen.getByText(interpolate(s.hifzDriftPage, { sibling: "31:5", ref: "2:5" }))).toBeTruthy();
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
    expect(screen.getByText(refLabel("البقرة", "2:5"))).toBeTruthy();
    // The options hide their references until one is chosen, keeping their place.
    expect(screen.queryByText(refLabel("لقمان", "31:5"))).toBeNull();
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(2);
    // Next waits in the footer for a choice.
    expect(screen.getByRole("button", { name: s.hifzSabaqNext })).toBeDisabled();

    fireEvent.press(options[1]);
    expect(screen.getByText(s.hifzPairOther)).toBeTruthy();
    expect(screen.getByText(refLabel("لقمان", "31:5"))).toBeTruthy();
    expect(screen.getAllByText(refLabel("البقرة", "2:5"))).toHaveLength(2);
    // The wrong choice is named, and the verse asked for is marked.
    expect(within(options[1]).getByText(s.hifzPairYourChoice)).toBeTruthy();
    expect(within(options[0]).getByLabelText(s.hifzPairAnswer)).toBeTruthy();
    expect(screen.getByRole("button", { name: s.hifzSabaqNext })).toBeEnabled();
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

describe("a drift dismissed as not a mistake", () => {
  const s = strings.en;

  async function dismissDrill() {
    fireEvent.press(screen.getByRole("button", { name: s.hifzDrillShow }));
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: s.hifzDrillDismiss }));
    });
    await flush();
  }

  it("drops its sibling page and pair prompt from the session", async () => {
    jest.mocked(readMistakeInbox).mockResolvedValue([driftInbox("err-drift")]);
    jest.mocked(loadDriftDrills).mockResolvedValue([drift(0)]);
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();
    // The drill, then the sibling page and the prompt the drift added.
    expect(screen.getByText("1 / 3")).toBeTruthy();
    await dismissDrill();

    expect(dismissInboxItem).toHaveBeenCalledWith(mockDatabase, { id: "err-drift" });
    // Nothing the drift brought is left, so the session ends there.
    expect(screen.getByText(s.hifzSummaryTitle)).toBeTruthy();
    expect(screen.queryByText(s.hifzPairTitle)).toBeNull();
    expect(savePageGrade).not.toHaveBeenCalled();
  });

  it("keeps the pair's drills while an older drift into the same pair is live", async () => {
    jest.mocked(readMistakeInbox).mockResolvedValue([driftInbox("err-drift")]);
    // Two drifts into the same pair: an older one, and the newer one the inbox drills here.
    jest.mocked(loadDriftDrills).mockResolvedValue([{ ...drift(0), errorIds: ["err-older", "err-drift"] }]);
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();
    expect(screen.getByText("1 / 3")).toBeTruthy();
    await dismissDrill();
    expect(dismissInboxItem).toHaveBeenCalledWith(mockDatabase, { id: "err-drift" });
    // The older drift still needs the sibling page and the prompt.
    expect(screen.queryByText(s.hifzSummaryTitle)).toBeNull();
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("keeps a sibling page another drift of the session still needs, with that drift's prompt", async () => {
    const other = { groupId: "g2", self: ref(7, 52, "الأعراف", 157), sibling: ref(31, 3, "لقمان", 411) };
    jest.mocked(readMistakeInbox).mockResolvedValue([driftInbox("err-drift")]);
    jest.mocked(loadDriftDrills).mockResolvedValue([
      drift(0),
      { errorId: "err-other", errorIds: ["err-other"], pair: other, siblingPage: 411, sessionsSince: 0 },
    ]);
    jest.mocked(savePageGrade).mockResolvedValue(saved);
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();
    // Both drifts share page 411, so it is queued once, with a prompt for each.
    expect(screen.getByText("1 / 4")).toBeTruthy();
    await dismissDrill();

    expect(screen.getByText("2 / 3")).toBeTruthy();
    // The page now explains the drift that still needs it.
    expect(screen.getByText(interpolate(s.hifzDriftPage, { sibling: "31:3", ref: "7:52" }))).toBeTruthy();
    await gradePage();
    expect(jest.mocked(savePageGrade).mock.calls[0][1].card).toBe(row);
    expect(screen.getByText("3 / 3")).toBeTruthy();
    expect(screen.getByText(refLabel("الأعراف", "7:52"))).toBeTruthy();
    fireEvent.press(screen.getAllByRole("radio")[0]);
    fireEvent.press(screen.getByRole("button", { name: s.hifzSabaqNext }));
    await flush();
    expect(screen.getByText(s.hifzSummaryTitle)).toBeTruthy();
  });
});

describe("interleaved similar-verse prompts (MUT-03)", () => {
  it.each(["en", "ar"] as const)(
    "asks which one two pages after a page with a memorized similar verse, without counting it (%s)",
    async (language) => {
      mockLanguage = language;
      const s = strings[language];
      const n = (value: number) => formatNumber(value, language);
      planOf([2, 3, 4, 5]);
      jest.mocked(readMemorizedPageNumbers).mockResolvedValue(new Set([2, 3, 4, 5, 411]));
      jest.mocked(similarGroupsOnPages).mockResolvedValue([
        // Page 2 holds 2:5, whose sibling 31:5 is on memorized page 411.
        group(pair.self, [pair.sibling]),
        // Page 3 holds another verse of the same group: the group is asked about once.
        group(ref(2, 25, "البقرة", 3), [pair.sibling]),
        // Page 4's sibling is not memorized, so it brings no prompt.
        group(ref(2, 40, "البقرة", 4), [ref(40, 9, "غافر", 468)], "g3"),
      ]);
      jest.mocked(similarPair).mockResolvedValue(pair);
      jest.mocked(savePageGrade).mockResolvedValue(saved);
      render(<HifzReviewRoute />, { wrapper: Wrapper });
      await flush();
      expect(screen.getByText(`${n(1)} / ${n(4)}`)).toBeTruthy();

      await gradePage(language);
      // The prompt joins the session once page 2 is reviewed.
      expect(screen.getByText(`${n(2)} / ${n(5)}`)).toBeTruthy();
      expect(similarPair).toHaveBeenCalledWith(mockDatabase, pair.self, pair.sibling);
      await gradePage(language);
      expect(screen.getByText(`${n(3)} / ${n(5)}`)).toBeTruthy();
      await gradePage(language);

      // After two other pages, it asks for the verse of the page reviewed, with no meaning yet.
      expect(screen.getByText(`${n(4)} / ${n(5)}`)).toBeTruthy();
      expect(screen.getByText(s.hifzPairTitle)).toBeTruthy();
      // In English the Arabic surah name is isolated, so the digits after it keep their order.
      expect(screen.getByText(language === "ar" ? "البقرة ٢:٥" : "البقرة\u200E 2:5")).toBeTruthy();
      expect(screen.queryByText(MEANINGS[0][language])).toBeNull();
      fireEvent.press(screen.getAllByRole("radio")[0]);
      expect(screen.getByText(s.hifzPairRight)).toBeTruthy();
      // MUT-05: once answered, each verse shows its meaning in the interface language.
      expect(screen.getByText(MEANINGS[0][language])).toBeTruthy();
      expect(screen.getByText(MEANINGS[1][language])).toBeTruthy();
      fireEvent.press(screen.getByRole("button", { name: s.hifzSabaqNext }));
      await flush();

      expect(screen.getByText(`${n(5)} / ${n(5)}`)).toBeTruthy();
      await gradePage(language);
      expect(screen.getByText(s.hifzSummaryTitle)).toBeTruthy();
      // The prompt is not a review: four grades, four pages of the plan, four pages for the pace.
      expect(savePageGrade).toHaveBeenCalledTimes(4);
      expect(screen.getByText(interpolate(s.hifzSummaryPlan, { done: n(4), total: n(4) }))).toBeTruthy();
      expect(jest.mocked(recordReviewPace).mock.calls[0][1]).toMatchObject({ pages: 4 });
      expect(similarPair).toHaveBeenCalledTimes(1);
    },
  );

  it("puts the prompt at the end when fewer than two pages follow", async () => {
    planOf([2, 3]);
    jest.mocked(readMemorizedPageNumbers).mockResolvedValue(new Set([2, 3, 411]));
    jest.mocked(similarGroupsOnPages).mockResolvedValue([group(pair.self, [pair.sibling])]);
    jest.mocked(similarPair).mockResolvedValue(pair);
    jest.mocked(savePageGrade).mockResolvedValue(saved);
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();
    await gradePage();
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(screen.getByText(strings.en.hifzPageN.replace("{{n}}", "3"), { exact: false })).toBeTruthy();
    await gradePage();
    expect(screen.getByText("3 / 3")).toBeTruthy();
    expect(screen.getByText(strings.en.hifzPairTitle)).toBeTruthy();
  });

  it("adds none for a pair a drift follow-up already asks about", async () => {
    planOf([2, 3, 4]);
    jest.mocked(readMemorizedPageNumbers).mockResolvedValue(new Set([2, 3, 4, 411]));
    jest.mocked(similarGroupsOnPages).mockResolvedValue([group(pair.self, [pair.sibling])]);
    jest.mocked(loadDriftDrills).mockResolvedValue([drift(1)]);
    jest.mocked(savePageGrade).mockResolvedValue(saved);
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();
    expect(screen.getByText("1 / 4")).toBeTruthy();
    await gradePage();
    // Only the drift's prompt, at the end.
    expect(screen.getByText("2 / 4")).toBeTruthy();
    expect(similarPair).not.toHaveBeenCalled();
  });

  it(`adds at most ${INTERLEAVE_PROMPTS_PER_SESSION} prompts to a session`, async () => {
    const pages = [2, 3, 4, 5, 6, 7];
    planOf(pages);
    jest.mocked(readMemorizedPageNumbers).mockResolvedValue(new Set([...pages, 411]));
    jest
      .mocked(similarGroupsOnPages)
      .mockResolvedValue(pages.map((page) => group(ref(2, page * 10, "البقرة", page), [ref(31, page, "لقمان", 411)], `g-${page}`)));
    jest.mocked(similarPair).mockImplementation(async (_db, self, sibling) => ({
      groupId: `g-${self.ayah / 10}`,
      self: ref(self.surah, self.ayah, "البقرة", self.ayah / 10),
      sibling: ref(sibling.surah, sibling.ayah, "لقمان", 411),
    }));
    jest.mocked(savePageGrade).mockResolvedValue(saved);
    render(<HifzReviewRoute />, { wrapper: Wrapper });
    await flush();
    for (let graded = 0; graded < pages.length; graded += 1) {
      // Answer any prompt on the way to the next page.
      while (screen.queryByText(strings.en.hifzPairTitle)) {
        fireEvent.press(screen.getAllByRole("radio")[0]);
        fireEvent.press(screen.getByRole("button", { name: strings.en.hifzSabaqNext }));
        await flush();
      }
      await gradePage();
    }
    expect(similarPair).toHaveBeenCalledTimes(INTERLEAVE_PROMPTS_PER_SESSION);
    expect(savePageGrade).toHaveBeenCalledTimes(pages.length);
  });
});
