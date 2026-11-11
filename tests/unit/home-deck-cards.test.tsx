import React from "react";
import { I18nManager, StyleSheet, useWindowDimensions } from "react-native";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { Languages, Layers, Settings2 } from "lucide-react-native";
import HomeScreen from "@/app/(tabs)/home";
import { Card } from "@/components/ui/Card";
import { strings, type UIStrings } from "@/lib/i18n/strings";
import type { useSettings } from "@/lib/settings/context";
import { VIEWPORT_BREAKPOINTS } from "@/lib/ui/viewport";
import { getDeckTodayStats, readDeckReviewSettings, MEANINGS_DECK_ID } from "@/lib/fsrs/queries";
import { readSmartDeckFilter, SMART_DECK_IDS, type BuiltInDeckFilter } from "@/lib/fsrs/smart-decks";
import type { DeckCardsSheet } from "@/components/flashcards/DeckCardsSheet";
import type { DeckReviewSettingsSheet } from "@/components/flashcards/DeckReviewSettingsSheet";
import type { SmartDeckFilterSheet } from "@/components/flashcards/SmartDeckFilterSheet";

type CardsProps = React.ComponentProps<typeof DeckCardsSheet>;
type ReviewProps = React.ComponentProps<typeof DeckReviewSettingsSheet>;
type FilterProps = React.ComponentProps<typeof SmartDeckFilterSheet>;
type Stats = Awaited<ReturnType<typeof getDeckTodayStats>>;
const mockSettings: Pick<ReturnType<typeof useSettings>, "isDark" | "isRTL" | "uiLanguage" | "themeColors"> = {
  isDark: false,
  isRTL: false,
  uiLanguage: "en",
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
  getFirstAsync: jest.fn(async () => null),
  runAsync: jest.fn(() => {
    throw new Error("Database writes forbidden in home fixture");
  }),
};
const mockRouterPush = jest.fn();
let mockCards: CardsProps | undefined;
let mockReview: ReviewProps | undefined;
let mockFilter: FilterProps | undefined;
const smartStats: Stats = { total: 17, newCount: 0, dueCount: 0 };
const vocabStats: Stats = { total: 29, newCount: 7, dueCount: 11 };

jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return { useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockRouterPush }) }));
jest.mock("@/lib/auth/store", () => ({ useAuthStore: () => ({ id: "isolated-home-user" }) }));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => mockSettings }));
jest.mock("@/lib/fsrs/queries", () => ({
  ...jest.requireActual<typeof import("@/lib/fsrs/queries")>("@/lib/fsrs/queries"),
  getDeckTodayStats: jest.fn(),
  readDeckReviewSettings: jest.fn(),
  getTodayDueCount: jest.fn(async () => 0),
  getMemorizedAyahCardCount: jest.fn(async () => 0),
  getWirdStatus: jest.fn(async () => ({
    currentDays: 0,
    longestDays: 0,
    maintainedToday: false,
    lastReviewDate: null,
    state: "empty",
  })),
}));
jest.mock("@/lib/fsrs/smart-decks", () => ({
  ...jest.requireActual<typeof import("@/lib/fsrs/smart-decks")>("@/lib/fsrs/smart-decks"),
  migrateLegacyRetentionDecks: jest.fn(async () => undefined),
  readSmartDeckFilter: jest.fn(),
}));
jest.mock("@/lib/fsrs/review-events", () => ({ subscribeReviewActivity: () => () => {} }));
jest.mock("@/lib/sync/events", () => ({ subscribeSyncCompleted: () => () => {} }));
jest.mock("@/lib/achievements/queries", () => ({
  getLatestUnseenUnlock: jest.fn(async () => null),
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
async function home() {
  const view = render(<HomeScreen />);
  await waitFor(() => expect(jest.mocked(getDeckTodayStats)).toHaveBeenCalledTimes(6));
  await act(async () => {});
  return view;
}
function width(value: number) {
  jest.mocked(useWindowDimensions).mockReturnValue({ width: value, height: 900, scale: 1, fontScale: 1 });
}

beforeEach(() => {
  jest.clearAllMocks();
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
        textAlign: language === "ar" ? "right" : "left",
        writingDirection: language === "ar" ? "rtl" : "ltr",
      });
      expect(StyleSheet.flatten(sub.props.style)).toMatchObject({
        fontSize: 11,
        lineHeight: 16,
        textAlign: language === "ar" ? "right" : "left",
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
      expect(scope.getByText(String(stats.total))).toBeTruthy();
      const newNodes = scope.getAllByText(String(stats.newCount));
      const dueNodes = scope.getAllByText(String(stats.dueCount));
      expect(newNodes.some((n) => StyleSheet.flatten(n.props.style).color === (dark ? "#4ade80" : "#16a34a"))).toBe(
        true,
      );
      expect(dueNodes.some((n) => StyleSheet.flatten(n.props.style).color === (dark ? "#f87171" : "#dc2626"))).toBe(
        true,
      );
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
      mode: "word",
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
    expect(review().mode).toBe("word");
    act(() => review().onClose());
    expect(mockRouterPush).not.toHaveBeenCalled();
    fireEvent.press(startTarget(view, s.smartDeckRetentionTitle));
    fireEvent.press(startTarget(view, s.vocabDeckTitle));
    expect(mockRouterPush.mock.calls).toEqual([
      [{ pathname: "/flashcards/session", params: { deckId: SMART_DECK_IDS.retention } }],
      [{ pathname: "/flashcards/session", params: { deckId: MEANINGS_DECK_ID } }],
    ]);
  });
  it("keeps an empty smart deck disabled even with nonzero due/new counts and omits empty vocabulary", async () => {
    jest.mocked(getDeckTodayStats).mockResolvedValue({ total: 0, newCount: 37, dueCount: 31 });
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
      tail: (s: UIStrings) =>
        s.flashcardsScopeBysurah + ": " + (language === "ar" ? "اسم تجريبي" : "Fixture chapter") + " 3-5",
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
      tail: (s: UIStrings) => s.flashcardsScopeBysurah + ": 2 " + s.flashcardsScopeCustom,
    },
    {
      name: "unknown single surah",
      value: { type: "surah", surahs: [99] },
      tail: (s: UIStrings) => s.flashcardsScopeBysurah + ": 99",
    },
    {
      name: "multiple surahs",
      value: { type: "surah", surahs: [7, 8] },
      tail: (s: UIStrings) => s.flashcardsScopeBysurah + ": 2",
    },
    {
      name: "juz",
      value: { type: "juz", juzNumbers: [2, 5] },
      tail: (s: UIStrings) => s.flashcardsScopeByjuz + ": 2, 5",
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

describe.each(["en", "ar"] satisfies ("en" | "ar")[])("home dashboard load failure in %s", (language) => {
  beforeEach(() => {
    Object.assign(mockSettings, { uiLanguage: language, isRTL: language === "ar" });
    jest.replaceProperty(I18nManager, "isRTL", language === "ar");
  });

  it("keeps the last good dashboard, shows a retryable error and recovers", async () => {
    const view = await home();
    const s = strings[language];
    expect(view.queryByText(s.homeLoadFailed)).toBeNull();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const changedSmart = { ...smartStats, total: 23 };
    jest.mocked(getDeckTodayStats).mockImplementation(async (_db, id) => {
      if (id === MEANINGS_DECK_ID) throw new Error("synthetic dashboard failure");
      return { ...changedSmart };
    });

    await act(async () => {
      review().onSaved();
    });

    await waitFor(() => expect(view.getByText(s.homeLoadFailed)).toBeTruthy());
    expect(within(card(view, s.smartDeckRetentionTitle)).getByText(String(smartStats.total))).toBeTruthy();
    expect(within(card(view, s.vocabDeckTitle)).getByText(String(vocabStats.total))).toBeTruthy();

    jest
      .mocked(getDeckTodayStats)
      .mockImplementation(async (_db, id) => ({ ...(id === MEANINGS_DECK_ID ? vocabStats : changedSmart) }));
    await act(async () => {
      fireEvent.press(view.getByText(s.homeLoadRetry));
    });

    await waitFor(() => expect(view.queryByText(s.homeLoadFailed)).toBeNull());
    expect(within(card(view, s.smartDeckRetentionTitle)).getByText(String(changedSmart.total))).toBeTruthy();
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
      const olderSmart = { ...smartStats, total: 99 };
      const newerSmart = { ...smartStats, total: 23 };
      jest.mocked(getDeckTodayStats).mockImplementation(async (_db, id) => {
        if (id === MEANINGS_DECK_ID) return older;
        return { ...olderSmart };
      });
      await act(async () => {
        review().onSaved();
      });
      jest
        .mocked(getDeckTodayStats)
        .mockImplementation(async (_db, id) => ({ ...(id === MEANINGS_DECK_ID ? vocabStats : newerSmart) }));
      await act(async () => {
        review().onSaved();
      });
      await waitFor(() =>
        expect(within(card(view, s.smartDeckRetentionTitle)).getByText(String(newerSmart.total))).toBeTruthy(),
      );

      await act(async () => {
        settleOlder(outcome === "fails" ? new Error("synthetic older failure") : { ...vocabStats });
      });

      expect(view.queryByText(s.homeLoadFailed)).toBeNull();
      expect(within(card(view, s.smartDeckRetentionTitle)).getByText(String(newerSmart.total))).toBeTruthy();
    },
  );
});
