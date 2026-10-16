import React from "react";
import * as ReactNative from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DirectionProvider } from "@/lib/ui/direction";
import { DeckCardsSheet } from "@/components/flashcards/DeckCardsSheet";
import { ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { getDeckCardsForList, setStudyCardDueDate } from "@/lib/fsrs/queries";
import type { DeckCardListItem, StudyCardRow } from "@/lib/fsrs/types";
import { formatLocalDateInput, parseDueDateInput } from "@/lib/date";
import { strings, type UIStrings } from "@/lib/i18n/strings";
import { State } from "@/lib/fsrs/scheduler";
import { expectTextAlignStart, expectWritingDirection, flattenStyle } from "../rtl/rtl-test-utils";

const mockDatabase = { name: "isolated-deck-cards-fixture" };
const mockSettings = {
  effectiveTheme: "beige",
  isDark: false,
  isRTL: true,
  themeColors: {
    surface: "#FFF8F1",
    surfaceLow: "#F9F3EB",
    surfaceMid: "#F0EBE3",
    surfaceHigh: "#E8E1DA",
    surfaceDim: "#DFD9D1",
    surfaceBright: "#FFFFFF",
  },
  themeSurface: "#FFF8F1",
  uiLanguage: "ar",
};

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const originalWindowDimensions = ReactNative.Dimensions.get("window");
const originalScreenDimensions = ReactNative.Dimensions.get("screen");

jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDatabase,
}));

jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return {
    ...actual,
    useSettings: () => mockSettings,
  };
});

jest.mock("@/lib/fsrs/queries", () => ({
  deleteStudyCard: jest.fn(),
  getDeckCardsForList: jest.fn(),
  resetStudyCardProgress: jest.fn(),
  setStudyCardBuried: jest.fn(),
  setStudyCardDueDate: jest.fn(),
  setStudyCardMarked: jest.fn(),
  setStudyCardSuspended: jest.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => {
      if (!resolvePromise) throw new Error("Deferred promise was not initialized");
      resolvePromise(value);
    },
    reject: (reason) => {
      if (!rejectPromise) throw new Error("Deferred promise was not initialized");
      rejectPromise(reason);
    },
  };
}

function localDateWithOffset(days: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function makeCard(id: string, title: string, due: Date): DeckCardListItem {
  const dueIso = due.toISOString();
  return {
    id,
    deck_id: "deck-1",
    due: dueIso,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: State.New,
    last_review: null,
    suspended_at: null,
    buried_until: null,
    marked_at: null,
    created_at: dueIso,
    updated_at: dueIso,
    reference: id,
    title,
    subtitle: `Subtitle for ${title}`,
    preview: `Preview for ${title}`,
    searchText: `${title} ${id}`,
    kind: "ayah",
    isVirtual: false,
  };
}

const mockMeasureInWindow = jest.fn((callback: (x: number, y: number, width: number, height: number) => void) => {
  callback(24, 120, 32, 32);
});

function renderDeckWithCallbacks(onClose: () => void, onChanged: () => void) {
  return render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <DirectionProvider dir={mockSettings.isRTL ? "rtl" : "ltr"}>
        <DeckCardsSheet visible deckId="deck-1" deckTitle="Memorization" onClose={onClose} onChanged={onChanged} />
      </DirectionProvider>
    </SafeAreaProvider>,
    { concurrentRoot: false },
  );
}

type RenderedNode = ReturnType<ReturnType<typeof render>["getByText"]>;

function getTextButton(view: ReturnType<typeof render>, label: string): RenderedNode {
  let current: RenderedNode | null = view.getByText(label);
  while (current.parent) {
    current = current.parent;
    if (current.props.accessibilityState && typeof current.props.accessibilityState === "object") return current;
  }
  throw new Error(`No rendered button for ${label}`);
}

async function openSecondCardEditor(view: ReturnType<typeof render>, s: UIStrings) {
  const triggers = view.getAllByRole("button", { name: s.cardActionsTitle });
  expect(triggers).toHaveLength(2);
  const measureCallsBeforeOpen = mockMeasureInWindow.mock.calls.length;
  fireEvent.press(triggers[1]);
  await waitFor(() => expect(mockMeasureInWindow.mock.calls.length).toBeGreaterThan(measureCallsBeforeOpen));
  await waitFor(() => expect(view.getByRole("menuitem", { name: s.cardSetDueDate })).toBeTruthy());
  fireEvent.press(view.getByRole("menuitem", { name: s.cardSetDueDate }));
  await waitFor(() => expect(view.getByPlaceholderText(s.cardDueDatePlaceholder)).toBeTruthy());
  return view.getByPlaceholderText(s.cardDueDatePlaceholder);
}

const firstCard = makeCard("card-1", "First card", localDateWithOffset(2));
const secondCard = makeCard("card-2", "Second card", localDateWithOffset(5));
const deckCards = [firstCard, secondCard];

describe("DeckCardsSheet due-date editor characterization", () => {
  beforeEach(() => {
    mockSettings.effectiveTheme = "beige";
    mockSettings.isDark = false;
    mockSettings.isRTL = true;
    mockSettings.themeColors = {
      surface: "#FFF8F1",
      surfaceLow: "#F9F3EB",
      surfaceMid: "#F0EBE3",
      surfaceHigh: "#E8E1DA",
      surfaceDim: "#DFD9D1",
      surfaceBright: "#FFFFFF",
    };
    mockSettings.themeSurface = "#FFF8F1";
    mockSettings.uiLanguage = "ar";
    jest.resetAllMocks();
    mockMeasureInWindow.mockImplementation((callback) => {
      callback(24, 120, 32, 32);
    });
    jest.spyOn(ReactNative.View.prototype, "measureInWindow").mockImplementation((callback) => {
      mockMeasureInWindow(callback);
    });
    ReactNative.Dimensions.set({
      window: { width: 390, height: 844, scale: 1, fontScale: 1 },
      screen: { width: 390, height: 844, scale: 1, fontScale: 1 },
    });
    jest.mocked(getDeckCardsForList).mockResolvedValue(deckCards);
  });

  afterEach(() => {
    cleanup();
    ReactNative.Dimensions.set({ window: originalWindowDimensions, screen: originalScreenDimensions });
    jest.restoreAllMocks();
  });

  it("characterizes Arabic light validation, fixed date writing, cancel, and reopen", async () => {
    const s = strings.ar;
    const onClose = jest.fn();
    const onChanged = jest.fn();
    const view = renderDeckWithCallbacks(onClose, onChanged);

    await waitFor(() => {
      expect(view.getByText(s.deckCardsTitle)).toBeTruthy();
      expect(view.getByText(firstCard.title)).toBeTruthy();
      expect(view.getByText(secondCard.title)).toBeTruthy();
    });
    expect(view.queryByPlaceholderText(s.cardDueDatePlaceholder)).toBeNull();

    const input = await openSecondCardEditor(view, s);
    expect(input.props.value).toBe(formatLocalDateInput(new Date(secondCard.due)));
    expect(input.props.keyboardType).toBe("numbers-and-punctuation");
    expect(input.props.autoCapitalize).toBeUndefined();
    expect(input.props.autoCorrect).toBeUndefined();
    expect(input.props.placeholder).toBe(s.cardDueDatePlaceholder);
    expect(input.props.placeholderTextColor).toBe("#b9a085");
    expect(input.props.className).toContain("min-h-12 rounded-2xl bg-surface-low dark:bg-surface-dark-low");
    expectTextAlignStart(input, "rtl");
    expectWritingDirection(input, "ltr");

    const editorSheet = view.UNSAFE_getAllByType(ResponsiveSheet).find((node) => node.props.maxWidth === 420);
    if (!editorSheet) throw new Error("The due-date editor sheet was not rendered");
    expect(editorSheet.props).toMatchObject({ maxWidth: 420, maxHeight: 360, avoidKeyboard: true });
    const renderedEditorSheet = view
      .UNSAFE_getAllByType(ReactNative.Animated.View)
      .find((node) => flattenStyle(node.props.style).maxHeight === 360);
    if (!renderedEditorSheet) throw new Error("The rendered due-date editor sheet was not found");
    expect(flattenStyle(renderedEditorSheet.props.style)).toMatchObject({ width: 390, maxHeight: 360 });
    expect(view.UNSAFE_getAllByType(ReactNative.KeyboardAvoidingView)).not.toHaveLength(0);

    fireEvent.changeText(input, "not-a-date");
    fireEvent.press(getTextButton(view, s.cardSaveDueDate));
    await waitFor(() => expect(view.getByText(s.cardDueDateInvalid)).toBeTruthy());
    expect(setStudyCardDueDate).not.toHaveBeenCalled();

    fireEvent.changeText(input, formatLocalDateInput(localDateWithOffset(-2)));
    expect(view.getByText(s.cardDueDateInvalid)).toBeTruthy();
    fireEvent.press(getTextButton(view, s.cardSaveDueDate));
    await waitFor(() => expect(view.getByText(s.cardDueDatePast)).toBeTruthy());
    expect(view.queryByText(s.cardDueDateInvalid)).toBeNull();
    expect(setStudyCardDueDate).not.toHaveBeenCalled();

    fireEvent.press(getTextButton(view, s.flashcardsCancel));
    await waitFor(() => expect(view.queryByPlaceholderText(s.cardDueDatePlaceholder)).toBeNull());
    expect(view.getByText(s.deckCardsTitle)).toBeTruthy();
    expect(setStudyCardDueDate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();

    const reopenedInput = await openSecondCardEditor(view, s);
    expect(reopenedInput.props.value).toBe(formatLocalDateInput(new Date(secondCard.due)));
    expect(view.queryByText(s.cardDueDatePast)).toBeNull();
  });

  it("characterizes English dark busy guards and successful card-two persistence", async () => {
    mockSettings.effectiveTheme = "dark";
    mockSettings.isDark = true;
    mockSettings.isRTL = false;
    mockSettings.themeColors = {
      surface: "#0A0A0A",
      surfaceLow: "#141414",
      surfaceMid: "#1A1A1A",
      surfaceHigh: "#262626",
      surfaceDim: "#0F0F0F",
      surfaceBright: "#2D2D2D",
    };
    mockSettings.themeSurface = "#0A0A0A";
    mockSettings.uiLanguage = "en";
    const s = strings.en;
    const onClose = jest.fn();
    const onChanged = jest.fn();
    const view = renderDeckWithCallbacks(onClose, onChanged);

    await waitFor(() => expect(view.getByText(secondCard.title)).toBeTruthy());
    const input = await openSecondCardEditor(view, s);
    expect(input.props.placeholderTextColor).toBe("#737373");
    expectTextAlignStart(input, "ltr");
    expectWritingDirection(input, "ltr");
    expect(input.props.className).toContain("text-charcoal dark:text-neutral-100");

    const saveDateKey = formatLocalDateInput(localDateWithOffset(9));
    const parsed = parseDueDateInput(saveDateKey);
    if (!parsed.ok) throw new Error("The relative future fixture date must be valid");
    const deferred = createDeferred<StudyCardRow>();
    jest.mocked(setStudyCardDueDate).mockReturnValueOnce(deferred.promise);

    try {
      fireEvent.changeText(input, saveDateKey);
      fireEvent.press(getTextButton(view, s.cardSaveDueDate));
      await waitFor(() => expect(getTextButton(view, s.cardSaveDueDate).props.accessibilityState.disabled).toBe(true));
      expect(getTextButton(view, s.flashcardsCancel).props.accessibilityState.disabled).toBe(true);

      const editorModal = view.UNSAFE_getAllByType(ReactNative.Modal).at(-1);
      if (!editorModal) throw new Error("The due-date editor modal was not rendered");
      fireEvent(editorModal, "requestClose");
      expect(view.getByPlaceholderText(s.cardDueDatePlaceholder)).toBeTruthy();

      deferred.resolve(secondCard);
      await act(async () => {
        await deferred.promise;
      });
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(view.queryByPlaceholderText(s.cardDueDatePlaceholder)).toBeNull();
      expect(setStudyCardDueDate).toHaveBeenCalledTimes(1);
      expect(setStudyCardDueDate).toHaveBeenCalledWith(mockDatabase, "deck-1", secondCard.id, parsed.date);
      expect(getDeckCardsForList).toHaveBeenCalledTimes(2);
      expect(getDeckCardsForList).toHaveBeenLastCalledWith(mockDatabase, "deck-1");
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      deferred.resolve(secondCard);
      await act(async () => {
        await deferred.promise;
      });
    }
  });

  it("keeps the real editor open after a rejected date write and reports the failure", async () => {
    mockSettings.effectiveTheme = "dark";
    mockSettings.isDark = true;
    mockSettings.isRTL = false;
    mockSettings.themeColors = {
      surface: "#0A0A0A",
      surfaceLow: "#141414",
      surfaceMid: "#1A1A1A",
      surfaceHigh: "#262626",
      surfaceDim: "#0F0F0F",
      surfaceBright: "#2D2D2D",
    };
    mockSettings.themeSurface = "#0A0A0A";
    mockSettings.uiLanguage = "en";
    const s = strings.en;
    const onChanged = jest.fn();
    const view = renderDeckWithCallbacks(jest.fn(), onChanged);
    await waitFor(() => expect(view.getByText(secondCard.title)).toBeTruthy());
    const input = await openSecondCardEditor(view, s);
    const failure = new Error("write failed");
    const deferred = createDeferred<StudyCardRow>();
    jest.mocked(setStudyCardDueDate).mockReturnValueOnce(deferred.promise);
    const expectedWarning: [string, Error] = ["[DeckCardsSheet] Card action failed:", failure];
    const originalWarn = console.warn;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args) => {
      const isExpectedWarning =
        args.length === expectedWarning.length && args.every((arg, index) => arg === expectedWarning[index]);
      if (!isExpectedWarning) originalWarn(...args);
    });

    try {
      try {
        fireEvent.press(getTextButton(view, s.cardSaveDueDate));
        await waitFor(() =>
          expect(getTextButton(view, s.cardSaveDueDate).props.accessibilityState.disabled).toBe(true),
        );
        deferred.reject(failure);

        await act(async () => {
          await deferred.promise.catch(() => undefined);
        });
        await waitFor(() => expect(view.getByText(s.cardActionFailed)).toBeTruthy());
        expect(input.props.value).toBe(formatLocalDateInput(new Date(secondCard.due)));
        expect(getTextButton(view, s.cardSaveDueDate).props.accessibilityState.disabled).toBe(false);
        expect(getTextButton(view, s.flashcardsCancel).props.accessibilityState.disabled).toBe(false);
        expect(getDeckCardsForList).toHaveBeenCalledTimes(1);
        expect(onChanged).not.toHaveBeenCalled();
      } finally {
        deferred.reject(failure);
        await act(async () => {
          await deferred.promise.catch(() => undefined);
        });
      }
      expect(warnSpy.mock.calls).toEqual([expectedWarning]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
