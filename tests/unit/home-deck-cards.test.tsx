import { textStartStyle } from "@/lib/ui/direction";
import React from "react";
import { I18nManager, StyleSheet, useWindowDimensions } from "react-native";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { Languages, Layers } from "lucide-react-native";
import HomeScreen, { mergeUnlockQueue } from "@/app/(tabs)/home";
import { Card } from "@/components/ui/Card";
import { strings, type UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import type { useSettings } from "@/lib/settings/context";
import { VIEWPORT_BREAKPOINTS } from "@/lib/ui/viewport";
import { getDeckTodayStats, readDeckReviewSettings, MEANINGS_DECK_ID } from "@/lib/fsrs/queries";
import { readSmartDeckFilter, SMART_DECK_IDS, type BuiltInDeckFilter } from "@/lib/fsrs/smart-decks";
import type { DeckCardsSheet } from "@/components/flashcards/DeckCardsSheet";
import type { DeckReviewSettingsSheet } from "@/components/flashcards/DeckReviewSettingsSheet";
import type { SmartDeckFilterSheet } from "@/components/flashcards/SmartDeckFilterSheet";
import { toArabicNumber } from "@/lib/arabic";
import { consumePendingDeepLink } from "@/lib/deep-link";
import { clearAuthReturn, peekAuthReturn } from "@/lib/auth/return-origin";
import type { AchievementUnlock } from "@/lib/achievements/types";
import { DAILY_SESSION_HREF, loadStudyState, resolveStudy, type StudyState } from "@/lib/study/resolve";
import { readDailyDeckIds } from "@/lib/study/daily-decks";
import { addStudyMore, type DailyQueue, type DailyQueueItem } from "@/lib/study/daily-queue";
import { markFullWirdIfComplete, type HabitOverview } from "@/lib/habit/queries";
import type { TodayWird } from "@/lib/hifz/pages";

type CardsProps = React.ComponentProps<typeof DeckCardsSheet>;
type ReviewProps = React.ComponentProps<typeof DeckReviewSettingsSheet>;
type FilterProps = React.ComponentProps<typeof SmartDeckFilterSheet>;
type Stats = Awaited<ReturnType<typeof getDeckTodayStats>>;
const mockDismissAccountPromo = jest.fn();
const mockSettings: Pick<
  ReturnType<typeof useSettings>,
  "isDark" | "isRTL" | "uiLanguage" | "themeColors" | "accountPromoDismissed" | "dismissAccountPromo" | "effectiveTheme"
> = {
  isDark: false,
  isRTL: false,
  uiLanguage: "en",
  effectiveTheme: "white",
  accountPromoDismissed: false,
  dismissAccountPromo: () => mockDismissAccountPromo(),
  themeColors: {
    surface: "#ffffff",
    surfaceLow: "#eeeeee",
    surfaceMid: "#dddddd",
    surfaceHigh: "#cccccc",
    surfaceDim: "#123456",
    surfaceBright: "#ffffff",
  },
};
const mockDatabase = {
  getAllAsync: jest.fn(async () => [{ number: 7, name_arabic: "اسم تجريبي", name_english: "Fixture chapter" }]),
  getFirstAsync: jest.fn(async (_sql: string): Promise<unknown> => null),
  runAsync: jest.fn(() => {
    throw new Error("Database writes forbidden in home fixture");
  }),
};
const mockRouterPush = jest.fn();
let mockCards: CardsProps | undefined;
let mockReview: ReviewProps | undefined;
let mockFilter: FilterProps | undefined;
const ZERO: Stats = { total: 0, newCount: 0, dueCount: 0, learningCount: 0, reviewCount: 0, heldBack: 0 };
const smartStats: Stats = { ...ZERO, total: 17 };
const vocabStats: Stats = { total: 29, newCount: 7, dueCount: 11, learningCount: 3, reviewCount: 8, heldBack: 0 };

jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return { useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});
let mockParams: { section?: string } = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockRouterPush, setParams: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ getState: () => ({ type: "tab" }) }),
  router: { navigate: jest.fn() },
}));
const mockAuthState: { user: { id: string } | null; isLoading: boolean; isInitialized: boolean } = {
  user: { id: "isolated-home-user" },
  isLoading: false,
  isInitialized: true,
};
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: (selector?: (state: typeof mockAuthState) => unknown) => (selector ? selector(mockAuthState) : mockAuthState),
}));
let mockSyncConfigured = false;
jest.mock("@/lib/supabase", () => ({
  ...jest.requireActual("@/lib/supabase"),
  isSupabaseConfigured: () => mockSyncConfigured,
}));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => mockSettings }));
jest.mock("@/lib/fsrs/queries", () => ({
  ...jest.requireActual<typeof import("@/lib/fsrs/queries")>("@/lib/fsrs/queries"),
  getDeckTodayStats: jest.fn(),
  readDeckReviewSettings: jest.fn(),
  getMemorizedAyahCardCount: jest.fn(async () => 0),
}));
jest.mock("@/lib/fsrs/smart-decks", () => ({
  ...jest.requireActual<typeof import("@/lib/fsrs/smart-decks")>("@/lib/fsrs/smart-decks"),
  migrateLegacyRetentionDecks: jest.fn(async () => undefined),
  readSmartDeckFilter: jest.fn(),
}));
jest.mock("@/lib/fsrs/review-events", () => ({ subscribeReviewActivity: () => () => {} }));
jest.mock("@/lib/sync/events", () => ({ subscribeSyncCompleted: () => () => {} }));
jest.mock("@/lib/achievements/queries", () => ({
  getUnseenUnlocks: jest.fn(async () => []),
  markAchievementSeen: jest.fn(),
  subscribeAchievementUnlocks: () => () => {},
}));
jest.mock("@/lib/reflection-journey/queries", () => ({
  getReflectionJourneySummary: jest.fn(async () => ({
    totalLevels: 0,
    completedLevels: 0,
    currentLevelId: null,
    currentLevelTitle: null,
  })),
}));
jest.mock("@/components/ui/ScreenContent", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Screen: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    ScreenScrollView: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    TAB_SCREEN_BOTTOM_INSET: 0,
  };
});
jest.mock("@/components/flashcards/DeckCardsSheet", () => ({
  DeckCardsSheet: (props: CardsProps) => {
    mockCards = props;
    return null;
  },
}));
jest.mock("@/components/flashcards/DeckReviewSettingsSheet", () => ({
  DeckReviewSettingsSheet: (props: ReviewProps) => {
    mockReview = props;
    return null;
  },
}));
jest.mock("@/components/flashcards/SmartDeckFilterSheet", () => ({
  SmartDeckFilterSheet: (props: FilterProps) => {
    mockFilter = props;
    return null;
  },
}));
jest.mock("@/components/SearchCommand", () => ({ SearchCommand: () => null }));
// The wird card and break sheet have their own tests; this file covers the header and the deck rows.
let mockHabit: HabitOverview | null = null;
jest.mock("@/lib/habit/use-habit-overview", () => ({
  useHabitOverview: () => ({ overview: mockHabit, failed: false, refresh: async () => {} }),
}));
jest.mock("@/components/habit/HabitBreakSheet", () => ({ HabitBreakSheet: () => null }));
jest.mock("@/components/habit/WirdStreakCard", () => ({ WirdStreakCard: () => null }));
let mockWird: TodayWird | null | undefined = undefined;
let mockInbox = 0;
let mockLooksDue = 0;
jest.mock("@/lib/hifz/use-today-wird", () => ({
  useTodayWird: () => ({
    wird: mockWird,
    inboxCount: mockInbox,
    remediationDue: 0,
    monthlyCheckDue: false,
    secondLooksDue: mockLooksDue,
    nextLookAt: null,
    refresh: async () => {},
  }),
}));
jest.mock("@/lib/habit/queries", () => ({
  ...jest.requireActual<typeof import("@/lib/habit/queries")>("@/lib/habit/queries"),
  markFullWirdIfComplete: jest.fn(async () => undefined),
}));
jest.mock("@/lib/study/resolve", () => ({
  ...jest.requireActual<typeof import("@/lib/study/resolve")>("@/lib/study/resolve"),
  loadStudyState: jest.fn(),
  resolveStudy: jest.fn(),
}));
jest.mock("@/lib/study/daily-decks", () => ({
  ...jest.requireActual<typeof import("@/lib/study/daily-decks")>("@/lib/study/daily-decks"),
  readDailyDeckIds: jest.fn(),
  settleAutomaticDecks: jest.fn(async () => undefined),
}));
// The meanings deck's count adds generated candidates over the bundled word tables; here it is the
// plain deck count, so this file stays on the deck rows.
jest.mock("@/lib/meanings/candidates", () => ({
  getMeaningsTodayStats: (db: unknown, settings: unknown) =>
    jest.requireMock<typeof import("@/lib/fsrs/queries")>("@/lib/fsrs/queries").getDeckTodayStats(db as never, "meanings", settings as never),
}));
jest.mock("@/lib/meanings/settings", () => ({ settleMeaningsDefaults: jest.fn(async () => undefined) }));
jest.mock("@/lib/study/daily-queue", () => ({
  ...jest.requireActual<typeof import("@/lib/study/daily-queue")>("@/lib/study/daily-queue"),
  addStudyMore: jest.fn(async () => undefined),
}));
jest.mock("@/components/ui/Toast", () => ({ Toast: () => null }));
jest.mock("@/components/achievements/AchievementUnlockToast", () => ({ AchievementUnlockToast: () => null }));

function cards() {
  if (!mockCards) throw new Error("Cards sheet not rendered");
  return mockCards;
}
function review() {
  if (!mockReview) throw new Error("Review sheet not rendered");
  return mockReview;
}
function filter() {
  if (!mockFilter) throw new Error("Filter sheet not rendered");
  return mockFilter;
}
function card(view: ReturnType<typeof render>, title: string) {
  let node = view.getByText(title).parent;
  while (node && node.type !== Card) node = node.parent;
  if (!node) throw new Error("Missing real deck card");
  return node;
}
/** The deck's start target: a sibling behind the content, labeled with the deck title. */
function startTarget(view: ReturnType<typeof render>, title: string) {
  return within(card(view, title)).getByLabelText(title);
}
/** Home once loaded, with All decks opened unless the test looks at it closed. */
async function home({ openDecks = true }: { openDecks?: boolean } = {}) {
  const view = render(<HomeScreen />);
  await waitFor(() => expect(jest.mocked(loadStudyState)).toHaveBeenCalled());
  await act(async () => {});
  if (openDecks) {
    fireEvent.press(view.getByText(strings[mockSettings.uiLanguage].studyAllDecks));
    await waitFor(() => expect(jest.mocked(getDeckTodayStats)).toHaveBeenCalledTimes(6));
    await act(async () => {});
  }
  return view;
}

/** A page plan with nothing scheduled, enough for the Today card. */
function pagePlanWird(): TodayWird {
  return {
    plan: { unit: "page" },
    daily: { backlog: false },
    todo: [],
    done: [],
    total: 0,
    newLines: 0,
    memorizeLinesToday: 0,
    memorizeDoneToday: false,
    remainingMinutes: 0,
    memorizedPages: 3,
  } as unknown as TodayWird;
}

function queueOf(cards: { state: number; virtual?: boolean }[], overrides: Partial<DailyQueue> = {}): DailyQueue {
  const items = cards.map(
    ({ state, virtual = false }, index): DailyQueueItem =>
      ({ card: { id: `card-${index}`, deck_id: SMART_DECK_IDS.mutashabihat, state }, settings: {}, virtual }) as unknown as DailyQueueItem,
  );
  return {
    planCards: [],
    cards: items,
    heldBack: 0,
    streakCards: 10,
    baseBudget: 20,
    budget: 20,
    studiedToday: 0,
    deckIds: [SMART_DECK_IDS.mutashabihat, SMART_DECK_IDS.similarTails, MEANINGS_DECK_ID],
    perDeck: items.length > 0 ? { [SMART_DECK_IDS.mutashabihat]: items.length } : {},
    studiedPerDeck: {},
    leftAtBase: items.length,
    ...overrides,
  };
}

function habitOverview(doneToday: boolean, minimumProgressToday: number): HabitOverview {
  return { streak: { doneToday, makeUpPending: false }, minimumProgressToday, days: [], today: "2026-11-25", settings: { showZayt: false } } as unknown as HabitOverview;
}
function width(value: number) {
  jest.mocked(useWindowDimensions).mockReturnValue({ width: value, height: 900, scale: 1, fontScale: 1 });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockHabit = null;
  mockWird = undefined;
  mockInbox = 0;
  mockLooksDue = 0;
  jest.mocked(loadStudyState).mockResolvedValue({
    step: { kind: "home", reason: "no_plan" },
    queue: null,
    remediationDue: 0,
    memorizeOpen: false,
    secondLooksDue: 0,
    planLeft: 0,
  });
  jest.mocked(resolveStudy).mockResolvedValue({ kind: "home", reason: "no_plan" });
  jest
    .mocked(readDailyDeckIds)
    .mockResolvedValue([SMART_DECK_IDS.mutashabihat, SMART_DECK_IDS.similarTails, MEANINGS_DECK_ID]);
  mockCards = undefined;
  mockReview = undefined;
  mockFilter = undefined;
  Object.assign(mockSettings, { isDark: false, isRTL: false, uiLanguage: "en" });
  jest.spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useWindowDimensions");
  width(390);
  jest.replaceProperty(I18nManager, "isRTL", false);
  jest
    .mocked(getDeckTodayStats)
    .mockImplementation(async (_db, id) => ({ ...(id === MEANINGS_DECK_ID ? vocabStats : smartStats) }));
  jest.mocked(readSmartDeckFilter).mockResolvedValue({ type: "all" });
  // Home passes this untouched to the mocked stats adapter; scheduling is outside these tests.
  jest
    .mocked(readDeckReviewSettings)
    .mockImplementation(
      jest.requireActual<typeof import("@/lib/fsrs/queries")>("@/lib/fsrs/queries").readDeckReviewSettings,
    );
  mockDatabase.getFirstAsync.mockResolvedValue(null);
  mockAuthState.user = { id: "isolated-home-user" };
  mockSyncConfigured = false;
  mockSettings.accountPromoDismissed = false;
  consumePendingDeepLink();
  if (typeof globalThis.fetch === "function")
    jest.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Remote access forbidden in home fixture");
    });
});
afterEach(() => {
  cleanup();
  expect(mockDatabase.runAsync).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

describe.each(["en", "ar"] satisfies ("en" | "ar")[])("real home deck cards in %s", (language) => {
  // Arabic shows Arabic-Indic digits, matching the reader.
  const num = (value: number | string) => (language === "ar" ? toArabicNumber(Number(value)) : String(value));
  beforeEach(() => {
    Object.assign(mockSettings, { uiLanguage: language, isRTL: language === "ar" });
    jest.replaceProperty(I18nManager, "isRTL", language === "ar");
  });
  it.each([
    { compact: true, dark: false },
    { compact: true, dark: true },
    { compact: false, dark: false },
    { compact: false, dark: true },
  ])("preserves compact=$compact dark=$dark presentation and separate actions", async ({ compact, dark }) => {
    mockSettings.isDark = dark;
    width(compact ? 390 : 1280);
    const view = await home();
    const s = strings[language];
    const smart = card(view, s.smartDeckRetentionTitle);
    const vocab = card(view, s.vocabDeckTitle);
    for (const [node, title, subtitle, stats, Icon] of [
      [
        smart,
        s.smartDeckRetentionTitle,
        s.smartDeckRetentionSubtitle + " · " + s.smartDeckFilterAll,
        smartStats,
        Layers,
      ],
      [vocab, s.vocabDeckTitle, s.vocabDeckSubtitle, vocabStats, Languages],
    ] as const) {
      const scope = within(node);
      const heading = scope.getByText(title);
      const sub = scope.getByText(subtitle);
      expect(heading.props.numberOfLines).toBe(compact ? undefined : 1);
      expect(sub.props.numberOfLines).toBe(compact ? undefined : 1);
      expect(StyleSheet.flatten(heading.props.style)).toMatchObject({
        fontSize: 14,
        ...textStartStyle(language === "ar"),
        writingDirection: language === "ar" ? "rtl" : "ltr",
      });
      expect(StyleSheet.flatten(sub.props.style)).toMatchObject({
        fontSize: 11,
        lineHeight: 16,
        ...textStartStyle(language === "ar"),
      });
      expect(scope.UNSAFE_getByType(Icon).props).toMatchObject({ size: 18, color: dark ? "#2dd4bf" : "#0d9488" });
      expect(node.props).toMatchObject({
        elevation: "low",
        className: "px-4 py-3 rounded-3xl",
        style: { opacity: 1 },
      });
      const layout = React.Children.toArray(node.props.children)[1] as React.ReactElement<any>;
      expect(layout.props.className).toBe(compact ? "gap-3" : "items-center gap-3");
      expect(React.Children.count(layout.props.children)).toBe(compact ? 2 : 4);
      const row = (compact ? React.Children.toArray(layout.props.children)[0] : layout) as React.ReactElement<any>;
      expect(StyleSheet.flatten(row.props.style)).toMatchObject({
        direction: "ltr",
        flexDirection: language === "ar" ? "row-reverse" : "row",
      });
      // Today's new, learning and review cards, never the deck's size.
      expect(scope.queryByText(num(stats.total))).toBeNull();
      for (const label of [s.deckCardsFilterNew, s.deckCardsFilterLearning, s.deckCardsFilterReview]) {
        expect(scope.getByText(label)).toBeTruthy();
      }
      // Each count is colored only above zero; a zero stays muted.
      for (const [value, light, darkColor] of [
        [stats.newCount, "#16a34a", "#4ade80"],
        [stats.learningCount, "#d97706", "#fbbf24"],
        [stats.reviewCount, "#dc2626", "#f87171"],
      ] as const) {
        const nodes = scope.getAllByText(num(value));
        expect(nodes.some((n) => StyleSheet.flatten(n.props.style).color === (dark ? darkColor : light))).toBe(value > 0);
      }
      // Without cards for today the caption says so; with cards and nothing held back there is none.
      const nothingDue = scope.queryByText(s.homeDeckNothingDue, { includeHiddenElements: true });
      expect(nothingDue !== null).toBe(stats.newCount + stats.dueCount === 0);
      expect(
        scope.getByLabelText(
          [
            `${stats.newCount} ${s.deckCardsFilterNew}`,
            `${stats.learningCount} ${s.deckCardsFilterLearning}`,
            `${stats.reviewCount} ${s.deckCardsFilterReview}`,
            ...(nothingDue ? [s.homeDeckNothingDue] : []),
          ].join(", "),
        ),
      ).toBeTruthy();
      const start = startTarget(view, title);
      expect(start.props.accessibilityRole).toBe("button");
      expect(StyleSheet.flatten(start.props.style)).toMatchObject({ position: "absolute", backgroundColor: "transparent" });
      // The card-list control is a sibling of the start target, never a button nested inside it.
      let parent = scope.getByLabelText(s.deckCardsTitle).parent;
      while (parent && parent !== node) {
        expect(parent).not.toBe(start);
        parent = parent.parent;
      }
    }
    // Both settings controls are labeled buttons.
    const smartControl = within(smart).getByLabelText(s.smartDeckFilterTitle);
    expect(smartControl.props.accessibilityRole).toBe("button");
    const stop = jest.fn();
    fireEvent.press(within(smart).getByLabelText(s.deckCardsTitle), { stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(cards()).toMatchObject({
      visible: true,
      deckId: SMART_DECK_IDS.retention,
      deckTitle: s.smartDeckRetentionTitle,
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
    act(() => cards().onClose());
    expect(cards().visible).toBe(false);
    fireEvent.press(smartControl, { stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(2);
    expect(filter()).toMatchObject({ visible: true, deckId: SMART_DECK_IDS.retention });
    expect(review().visible).toBe(false);
    expect(mockRouterPush).not.toHaveBeenCalled();
    act(() => filter().onClose());
    fireEvent.press(within(vocab).getByLabelText(s.deckCardsTitle), { stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(3);
    expect(cards()).toMatchObject({ visible: true, deckId: MEANINGS_DECK_ID, deckTitle: s.vocabDeckTitle });
    act(() => cards().onClose());
    const vocabControl = within(vocab).getByLabelText(s.deckReviewSettingsTitle);
    expect(vocabControl.props.accessibilityRole).toBe("button");
    fireEvent.press(vocabControl, { stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(4);
    expect(review()).toMatchObject({
      visible: true,
      deckId: MEANINGS_DECK_ID,
      deckTitle: s.vocabDeckTitle,
    });
    expect(filter().visible).toBe(false);
    expect(mockRouterPush).not.toHaveBeenCalled();
    act(() => review().onClose());
    // All four handlers also accept an event without stopPropagation.
    fireEvent.press(within(smart).getByLabelText(s.deckCardsTitle), {});
    expect(cards().deckId).toBe(SMART_DECK_IDS.retention);
    act(() => cards().onClose());
    fireEvent.press(smartControl, {});
    expect(filter().deckId).toBe(SMART_DECK_IDS.retention);
    act(() => filter().onClose());
    fireEvent.press(within(vocab).getByLabelText(s.deckCardsTitle), {});
    expect(cards().deckId).toBe(MEANINGS_DECK_ID);
    act(() => cards().onClose());
    fireEvent.press(vocabControl, {});
    expect(review().deckId).toBe(MEANINGS_DECK_ID);
    act(() => review().onClose());
    expect(mockRouterPush).not.toHaveBeenCalled();
    // A deck with only future cards opens its card list instead of an empty session.
    fireEvent.press(startTarget(view, s.smartDeckRetentionTitle));
    expect(cards()).toMatchObject({ visible: true, deckId: SMART_DECK_IDS.retention });
    act(() => cards().onClose());
    fireEvent.press(startTarget(view, s.vocabDeckTitle));
    expect(mockRouterPush.mock.calls).toEqual([[{ pathname: "/flashcards/session", params: { deckId: MEANINGS_DECK_ID } }]]);
  });
  it("keeps an empty smart deck disabled even with nonzero due/new counts and omits empty vocabulary", async () => {
    jest.mocked(getDeckTodayStats).mockResolvedValue({ ...ZERO, newCount: 37, dueCount: 31, reviewCount: 31 });
    const view = await home();
    const s = strings[language];
    const node = card(view, s.smartDeckRetentionTitle);
    expect(node.props.style).toEqual({ opacity: 0.55 });
    const start = startTarget(view, s.smartDeckRetentionTitle);
    expect(start.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(start);
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(view.queryByText(s.vocabDeckTitle)).toBeNull();
    const stop = jest.fn();
    fireEvent.press(within(node).getByLabelText(s.deckCardsTitle), { stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(cards()).toMatchObject({ visible: true, deckId: SMART_DECK_IDS.retention });
  });
  it("says how many due cards wait past today's limit only when the limit holds some back", async () => {
    jest.mocked(getDeckTodayStats).mockImplementation(async (_db, id) =>
      id === SMART_DECK_IDS.retention
        ? { total: 995, newCount: 5, dueCount: 12, learningCount: 2, reviewCount: 10, heldBack: 30 }
        : id === MEANINGS_DECK_ID
          ? { ...vocabStats }
          : { ...ZERO },
    );
    const view = await home();
    const s = strings[language];
    const retention = within(card(view, s.smartDeckRetentionTitle));
    const heldBack = interpolate(s.deckHeldBackToday, { n: num(30) });
    expect(retention.getByText(heldBack, { includeHiddenElements: true })).toBeTruthy();
    expect(retention.queryByText(num(995))).toBeNull();
    expect(
      retention.getByLabelText(
        `5 ${s.deckCardsFilterNew}, 2 ${s.deckCardsFilterLearning}, 10 ${s.deckCardsFilterReview}, ${heldBack}`,
      ),
    ).toBeTruthy();
    // A deck with work today and nothing held back has no caption.
    const vocab = within(card(view, s.vocabDeckTitle));
    expect(vocab.queryByText(s.homeDeckNothingDue, { includeHiddenElements: true })).toBeNull();
    expect(vocab.queryByText(interpolate(s.deckHeldBackToday, { n: num(0) }), { includeHiddenElements: true })).toBeNull();
  });
  it("uses the shared phoneLarge breakpoint inclusively and changes layout after resize", async () => {
    width(VIEWPORT_BREAKPOINTS.phoneLarge);
    const view = await home();
    const s = strings[language];
    expect(view.getByText(s.smartDeckRetentionTitle).props.numberOfLines).toBeUndefined();
    width(VIEWPORT_BREAKPOINTS.phoneLarge + 1);
    view.rerender(<HomeScreen />);
    expect(view.getByText(s.smartDeckRetentionTitle).props.numberOfLines).toBe(1);
    expect(view.getByText(s.vocabDeckTitle).props.numberOfLines).toBe(1);
    expect(jest.mocked(getDeckTodayStats)).toHaveBeenCalledTimes(6);
  });
  it.each([
    { name: "all", value: { type: "all" }, tail: (s: UIStrings) => s.smartDeckFilterAll },
    {
      name: "surah range",
      value: { type: "surah", surahs: [7], ranges: [{ surah: 7, ayahStart: 3, ayahEnd: 5 }] },
      // English uses the transliterated surah name; the "Surah:" prefix is gone.
      tail: () => (language === "ar" ? "اسم تجريبي" : "Al-Araf") + ` ${num(3)}-${num(5)}`,
    },
    {
      name: "multiple ranges",
      value: {
        type: "surah",
        surahs: [7, 8],
        ranges: [
          { surah: 7, ayahStart: 3, ayahEnd: 5 },
          { surah: 8, ayahStart: 1, ayahEnd: 2 },
        ],
      },
      tail: () => (language === "ar" ? "سورتان" : "2 surahs"),
    },
    {
      name: "unknown single surah",
      value: { type: "surah", surahs: [99] },
      tail: () => num(99),
    },
    {
      name: "multiple surahs",
      value: { type: "surah", surahs: [7, 8] },
      tail: () => (language === "ar" ? "سورتان" : "2 surahs"),
    },
    {
      name: "juz",
      value: { type: "juz", juzNumbers: [2, 5] },
      // Arabic digits and comma in Arabic.
      tail: () => (language === "ar" ? `الجزء ${num(2)}، ${num(5)}` : "Juz 2, 5"),
    },
  ] satisfies { name: string; value: BuiltInDeckFilter; tail: (s: UIStrings) => string }[])(
    "keeps $name filter text only on smart cards",
    async ({ value, tail }) => {
      jest.mocked(readSmartDeckFilter).mockResolvedValue(value);
      const view = await home();
      const s = strings[language];
      expect(
        within(card(view, s.smartDeckRetentionTitle)).getByText(s.smartDeckRetentionSubtitle + " · " + tail(s)),
      ).toBeTruthy();
      expect(within(card(view, s.vocabDeckTitle)).getByText(s.vocabDeckSubtitle)).toBeTruthy();
    },
  );
});

describe.each(["en", "ar"] satisfies ("en" | "ar")[])("the daily study header in %s (SPEC 3.1 to 3.3)", (language) => {
  const num = (value: number) => (language === "ar" ? toArabicNumber(value) : String(value));
  const s = strings[language];
  const state = (step: StudyState["step"], queue: DailyQueue | null): StudyState => ({
    step,
    queue,
    remediationDue: 0,
    memorizeOpen: false,
    secondLooksDue: 0,
    planLeft: 0,
  });
  beforeEach(() => {
    Object.assign(mockSettings, { uiLanguage: language, isRTL: language === "ar" });
    jest.replaceProperty(I18nManager, "isRTL", language === "ar");
    mockWird = pagePlanWird();
  });

  it("counts the daily list cut at the budget, and Study opens the resolved step at once, once per visit", async () => {
    const cards = [...Array.from({ length: 7 }, () => ({ state: 2 })), ...Array.from({ length: 5 }, () => ({ state: 0, virtual: true }))];
    jest.mocked(loadStudyState).mockResolvedValue(state({ kind: "cards", href: DAILY_SESSION_HREF }, queueOf(cards)));
    const view = await home({ openDecks: false });
    expect(view.getByText(num(12))).toBeTruthy();
    expect(view.getByText(interpolate(s.homeDueNew, { due: num(7), new: num(5) }))).toBeTruthy();
    fireEvent.press(view.getByText(s.studyStart));
    fireEvent.press(view.getByText(s.studyStart));
    // The step Home resolved, without another read, and a second tap opens nothing more.
    expect(resolveStudy).not.toHaveBeenCalled();
    expect(mockRouterPush.mock.calls).toEqual([[DAILY_SESSION_HREF]]);
  });

  it("reads Continue once anything was graded today", async () => {
    mockHabit = habitOverview(false, 0.4);
    jest.mocked(loadStudyState).mockResolvedValue(state({ kind: "review", href: "/hifz/review" }, queueOf([])));
    const view = await home({ openDecks: false });
    expect(view.getByText(s.studyContinue)).toBeTruthy();
    expect(view.queryByText(s.studyStart)).toBeNull();
  });

  it("says All done for today only when nothing is left and the minimum is met", async () => {
    mockHabit = habitOverview(true, 1);
    jest.mocked(loadStudyState).mockResolvedValue(state({ kind: "home", reason: "done" }, queueOf([])));
    const view = await home({ openDecks: false });
    expect(view.getByText(s.studyAllDone)).toBeTruthy();
    expect(view.queryByText(s.studyStart)).toBeNull();
    expect(view.queryByText(s.studyContinue)).toBeNull();
  });

  it("names the shortfall and opens Study more when the budget held cards back", async () => {
    mockHabit = habitOverview(false, 0.5);
    jest.mocked(loadStudyState).mockResolvedValue(state({ kind: "home", reason: "done" }, queueOf([], { heldBack: 30 })));
    const view = await home({ openDecks: false });
    expect(view.queryByText(s.studyAllDone)).toBeNull();
    expect(view.getByText(interpolate(s.studyShortfall, { cards: language === "ar" ? "٥ بطاقات" : "5 cards" }))).toBeTruthy();
    // What one press adds, as on the end screens: one budget of 20, fewer than the 30 held back.
    expect(view.getByText(interpolate(s.studyMoreAdds, { cards: language === "ar" ? "٢٠ بطاقة" : "20 cards" }))).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText(s.studyMore));
    });
    expect(addStudyMore).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith(DAILY_SESSION_HREF);
  });

  it("offers All decks for the shortfall when nothing was held back", async () => {
    mockHabit = habitOverview(false, 0.5);
    jest.mocked(loadStudyState).mockResolvedValue(state({ kind: "home", reason: "done" }, queueOf([])));
    const view = await home({ openDecks: false });
    expect(view.queryByText(s.studyMore)).toBeNull();
    expect(view.queryByText(s.smartDeckRetentionTitle)).toBeNull();
    fireEvent.press(view.getAllByText(s.studyAllDecks)[0]);
    // The decks are read once All decks opens.
    expect(await view.findByText(s.smartDeckRetentionTitle)).toBeTruthy();
    expect(getDeckTodayStats).toHaveBeenCalledTimes(6);
  });

  it("shows Set up your plan instead of the counter without a plan", async () => {
    mockWird = null;
    const view = await home({ openDecks: false });
    expect(view.queryByText(s.flashcardsDueToday)).toBeNull();
    fireEvent.press(view.getByText(s.studySetUpPlan));
    expect(mockRouterPush).toHaveBeenCalledWith("/hifz/setup");
  });

  it("keeps All decks closed until opened, and the legacy deck link opens it", async () => {
    const closed = await home({ openDecks: false });
    expect(closed.queryByText(s.smartDeckRetentionTitle)).toBeNull();
    // Closed, Home reads no deck counts: the counter comes from the daily queue alone.
    expect(getDeckTodayStats).not.toHaveBeenCalled();
    closed.unmount();
    mockParams = { section: "decks" };
    const opened = await home({ openDecks: false });
    expect(await opened.findByText(s.smartDeckRetentionTitle)).toBeTruthy();
  });

  it("lists the daily decks first, then Retention, then the decks left out, marked Off with a way to the setting", async () => {
    const view = await home();
    const order = [
      s.smartDeckMutashabihatTitle,
      s.smartDeckSimilarTailsTitle,
      s.vocabDeckTitle,
      s.smartDeckRetentionTitle,
      s.smartDeckQiraatTitle,
      s.smartDeckReasonsTitle,
    ];
    const titles = view
      .getAllByText(/.+/)
      .map((node) => node.props.children)
      .filter((text) => order.includes(text));
    expect(titles).toEqual(order);
    expect(within(card(view, s.vocabDeckTitle)).queryByText(s.studyDeckOff)).toBeNull();
    const qiraat = within(card(view, s.smartDeckQiraatTitle));
    // Off takes the counts' place: a deck outside daily study has no work waiting.
    expect(qiraat.queryByText(s.deckCardsFilterNew)).toBeNull();
    expect(within(card(view, s.smartDeckRetentionTitle)).getByText(s.deckCardsFilterNew)).toBeTruthy();
    const off = qiraat.getByLabelText(`${s.studyDeckOff}. ${s.studyDeckOffHint}`);
    fireEvent.press(off, { stopPropagation: jest.fn() });
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/(tabs)/settings",
      params: { category: "general", section: "daily-study" },
    });
  });

  it("marks the full wird by the resolver's own read: new lines with nowhere to go do not hold it, a due second look does", async () => {
    mockHabit = habitOverview(true, 1);
    // New lines are open on paper, but the resolver found no page left to memorize.
    mockWird = { ...pagePlanWird(), newLines: 5, total: 2, done: [{}, {}] } as unknown as TodayWird;
    jest.mocked(loadStudyState).mockResolvedValue(state({ kind: "home", reason: "done" }, queueOf([])));
    const view = await home({ openDecks: false });
    expect(markFullWirdIfComplete).toHaveBeenCalledTimes(1);
    expect(view.queryByText(s.studyPartNewLines)).toBeNull();
    view.unmount();

    // A second look came due while Home was behind a session: the resolver sees it even though
    // Home's wird hook has not refreshed yet.
    jest.mocked(markFullWirdIfComplete).mockClear();
    mockLooksDue = 0;
    jest.mocked(loadStudyState).mockResolvedValue({
      ...state({ kind: "memorize", href: "/hifz/memorize" }, queueOf([])),
      secondLooksDue: 1,
      planLeft: 1,
    });
    await home({ openDecks: false });
    expect(markFullWirdIfComplete).not.toHaveBeenCalled();
  });

  it("puts the mistakes drill under All decks, counting only marked mistakes", async () => {
    mockInbox = 3;
    const view = await home();
    fireEvent.press(view.getByText(interpolate(s.hifzInboxCount, { n: num(3) })));
    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: "/hifz/review", params: { mode: "mistakes" } });
  });
});

describe.each(["en", "ar"] satisfies ("en" | "ar")[])("home dashboard load failure in %s", (language) => {
  const num = (value: number | string) => (language === "ar" ? toArabicNumber(Number(value)) : String(value));
  beforeEach(() => {
    Object.assign(mockSettings, { uiLanguage: language, isRTL: language === "ar" });
    jest.replaceProperty(I18nManager, "isRTL", language === "ar");
  });

  it("keeps the last good dashboard, shows a retryable error and recovers", async () => {
    const view = await home();
    const s = strings[language];
    expect(view.queryByText(s.homeLoadFailed)).toBeNull();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const changedSmart = { ...smartStats, dueCount: 23, reviewCount: 23 };
    jest.mocked(getDeckTodayStats).mockImplementation(async (_db, id) => {
      if (id === MEANINGS_DECK_ID) throw new Error("synthetic dashboard failure");
      return { ...changedSmart };
    });

    await act(async () => {
      review().onSaved("saved");
    });

    await waitFor(() => expect(view.getByText(s.homeLoadFailed)).toBeTruthy());
    expect(within(card(view, s.smartDeckRetentionTitle)).getByText(s.homeDeckNothingDue, { includeHiddenElements: true })).toBeTruthy();
    expect(within(card(view, s.vocabDeckTitle)).getByText(num(vocabStats.reviewCount))).toBeTruthy();

    jest
      .mocked(getDeckTodayStats)
      .mockImplementation(async (_db, id) => ({ ...(id === MEANINGS_DECK_ID ? vocabStats : changedSmart) }));
    await act(async () => {
      fireEvent.press(view.getByText(s.homeLoadRetry));
    });

    await waitFor(() => expect(view.queryByText(s.homeLoadFailed)).toBeNull());
    expect(within(card(view, s.smartDeckRetentionTitle)).getByText(num(changedSmart.reviewCount))).toBeTruthy();
  });

  it.each(["fails", "succeeds"] as const)(
    "ignores an older overlapping load that %s after a newer one",
    async (outcome) => {
      const view = await home();
      const s = strings[language];
      jest.spyOn(console, "warn").mockImplementation(() => {});
      let settleOlder: (stats: Stats | Error) => void = () => {};
      const older = new Promise<Stats>((resolve, reject) => {
        settleOlder = (value) => (value instanceof Error ? reject(value) : resolve(value));
      });
      const olderSmart = { ...smartStats, dueCount: 99, reviewCount: 99 };
      const newerSmart = { ...smartStats, dueCount: 23, reviewCount: 23 };
      jest.mocked(getDeckTodayStats).mockImplementation(async (_db, id) => {
        if (id === MEANINGS_DECK_ID) return older;
        return { ...olderSmart };
      });
      await act(async () => {
        review().onSaved("saved");
      });
      jest
        .mocked(getDeckTodayStats)
        .mockImplementation(async (_db, id) => ({ ...(id === MEANINGS_DECK_ID ? vocabStats : newerSmart) }));
      await act(async () => {
        review().onSaved("saved");
      });
      await waitFor(() =>
        expect(within(card(view, s.smartDeckRetentionTitle)).getByText(num(newerSmart.reviewCount))).toBeTruthy(),
      );

      await act(async () => {
        settleOlder(outcome === "fails" ? new Error("synthetic older failure") : { ...vocabStats });
      });

      expect(view.queryByText(s.homeLoadFailed)).toBeNull();
      expect(within(card(view, s.smartDeckRetentionTitle)).getByText(num(newerSmart.reviewCount))).toBeTruthy();
    },
  );
});

describe.each(["en", "ar"] satisfies ("en" | "ar")[])("home order and entry points in %s", (language) => {
  beforeEach(() => {
    Object.assign(mockSettings, { uiLanguage: language, isRTL: language === "ar" });
    jest.replaceProperty(I18nManager, "isRTL", language === "ar");
  });

  it("lists decks with cards first and puts empty decks under More decks", async () => {
    jest
      .mocked(getDeckTodayStats)
      .mockImplementation(async (_db, id) =>
        id === SMART_DECK_IDS.mutashabihat ? { ...ZERO, total: 5, newCount: 1 } : { ...ZERO },
      );
    const view = await home();
    const s = strings[language];
    const titles = view
      .getAllByText(/.+/)
      .map((node) => node.props.children)
      .filter((text) => text === s.smartDeckMutashabihatTitle || text === s.homeMoreDecks || text === s.smartDeckRetentionTitle);
    expect(titles).toEqual([s.smartDeckMutashabihatTitle, s.homeMoreDecks, s.smartDeckRetentionTitle]);
    expect(within(card(view, s.smartDeckRetentionTitle)).getByText(s.homeDeckNoCards, { includeHiddenElements: true })).toBeTruthy();
  });

  it("offers an honest start card to a new reader and opens Al-Fatiha as one explicit target", async () => {
    const view = await home();
    const s = strings[language];
    fireEvent.press(view.getByText(s.homeStartReading));
    expect(consumePendingDeepLink()).toEqual({ surah: 1, ayah: 1 });
    expect(consumePendingDeepLink()).toBeNull();
  });

  it("continues reading at the saved ayah as an explicit target", async () => {
    mockDatabase.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("last_mushaf_position")) return { value: JSON.stringify({ mode: "verse", surah: 7, ayah: 12 }) };
      if (sql.includes("v2_page")) return { v2_page: 153 };
      return null;
    });
    const view = await home();
    const s = strings[language];
    fireEvent.press(view.getByText(s.continueReading));
    expect(consumePendingDeepLink()).toEqual({ surah: 7, ayah: 12 });
  });

  it("shows the guest promotion last and dismisses it through the shared setting", async () => {
    mockAuthState.user = null;
    mockSyncConfigured = true;
    const view = await home();
    const s = strings[language];
    expect(view.getByText(s.homeAuthCardSubtitle)).toBeTruthy();
    fireEvent.press(view.getByRole("button", { name: s.homeDismiss }));
    expect(mockDismissAccountPromo).toHaveBeenCalledTimes(1);
    view.unmount();
    mockSettings.accountPromoDismissed = true;
    const dismissed = await home();
    expect(dismissed.queryByText(s.homeAuthCardSubtitle)).toBeNull();
  });

  it("opens Login or Signup from the promotion with Home as the return target", async () => {
    mockAuthState.user = null;
    mockSyncConfigured = true;
    const view = await home();
    const s = strings[language];
    fireEvent.press(view.getByRole("button", { name: s.homeAuthCardSignIn }));
    expect(mockRouterPush).toHaveBeenCalledWith("/auth/login");
    expect(peekAuthReturn()).toEqual({ route: "home" });
    clearAuthReturn();
    fireEvent.press(view.getByText(s.homeAuthCardSignUp));
    expect(mockRouterPush).toHaveBeenCalledWith("/auth/signup");
    expect(peekAuthReturn()).toEqual({ route: "home" });
    clearAuthReturn();
  });

  it("hides the promotion when accounts are not configured", async () => {
    mockAuthState.user = null;
    mockSyncConfigured = false;
    const view = await home();
    expect(view.queryByText(strings[language].homeAuthCardSubtitle)).toBeNull();
  });
});

describe("achievement notice queue", () => {
  const unlock = (achievementId: string): AchievementUnlock => ({
    achievementId,
    unlockedAt: "2026-11-01T00:00:00.000Z",
    seenAt: null,
    localPayload: {},
    publicPayload: {},
  });

  it("keeps the visible notice first while newer unlocks wait behind it", () => {
    const queue = mergeUnlockQueue([unlock("first_review")], [unlock("newer"), unlock("first_review")]);
    expect(queue.map((entry) => entry.achievementId)).toEqual(["first_review", "newer"]);
  });

  it("shows the newest unseen unlock once the visible one is gone", () => {
    expect(mergeUnlockQueue([], [unlock("b"), unlock("a")]).map((entry) => entry.achievementId)).toEqual(["b", "a"]);
  });
});
