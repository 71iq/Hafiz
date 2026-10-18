import React from "react";
import * as ReactNative from "react-native";
import { act, cleanup, fireEvent, fireEventAsync, render, waitFor, within } from "@testing-library/react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DeckReviewSettingsSheet, formatStepText } from "@/components/flashcards/DeckReviewSettingsSheet";
import { SmartDeckFilterSheet } from "@/components/flashcards/SmartDeckFilterSheet";
import { OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { DirectionProvider } from "@/lib/ui/direction";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { THEME_COLORS, useSettings } from "@/lib/settings/context";
import { strings } from "@/lib/i18n/strings";
import { readDeckReviewSettings, writeDeckReviewSettings } from "@/lib/fsrs/queries";
import { materializeSmartDeckCards, readSmartDeckFilter, writeSmartDeckFilter } from "@/lib/fsrs/smart-decks";
import type { DeckReviewSettings } from "@/lib/fsrs/types";
import { flattenStyle } from "../rtl/rtl-test-utils";

type EditorKind = "deck" | "smart";
type Locale = "ar" | "en";
const mockDatabase = { getAllAsync: jest.fn<Promise<unknown[]>, [string]>(async () => []) };
const mockSettings: Pick<
  ReturnType<typeof useSettings>,
  "effectiveTheme" | "isDark" | "isRTL" | "uiLanguage" | "themeSurface" | "themeColors"
> = {
  effectiveTheme: "beige",
  isDark: false,
  isRTL: true,
  uiLanguage: "ar",
  themeSurface: THEME_COLORS.beige.surface,
  themeColors: THEME_COLORS.beige,
};
const originalWindow = ReactNative.Dimensions.get("window");
const originalScreen = ReactNative.Dimensions.get("screen");
const NativeModal = ReactNative.Modal;
const settings: DeckReviewSettings = {
  dailyReviewLimit: 20,
  newCardsLimit: 10,
  requestRetention: 0.9,
  maximumInterval: 36500,
  enableFuzz: true,
  enableShortTerm: true,
  learningSteps: ["3m", "17m"],
  relearningSteps: ["41m"],
  newReviewOrder: "mixed",
  reviewSortOrder: "random",
  newCardSortOrder: "random",
  testModes: ["nextAyah"],
  wordTestModes: ["wordMeaningArabic"],
};

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => mockSettings };
});
jest.mock("@/lib/fsrs/queries", () => ({ readDeckReviewSettings: jest.fn(), writeDeckReviewSettings: jest.fn() }));
jest.mock("@/lib/fsrs/smart-decks", () => ({
  SMART_DECK_IDS: {
    retention: "default-retention",
    mutashabihat: "default-mutashabihat",
    similarTails: "default-similar-tails",
    qiraat: "default-qiraat",
    reasonsOfRevelation: "default-reasons-of-revelation",
  },
  readSmartDeckFilter: jest.fn(),
  writeSmartDeckFilter: jest.fn(),
  materializeSmartDeckCards: jest.fn(),
}));

function editor(
  kind: EditorKind,
  width: number,
  language: Locale,
  onClose: () => void,
  onSaved: () => void,
  visible = true,
) {
  return (
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width, height: 844 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}
    >
      <DirectionProvider dir={language === "ar" ? "rtl" : "ltr"}>
        {kind === "deck" ? (
          <DeckReviewSettingsSheet
            visible={visible}
            deckId="isolated-review-help"
            deckTitle="Isolated review help"
            mode="ayah"
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : (
          <SmartDeckFilterSheet visible={visible} deckId="default-retention" onClose={onClose} onSaved={onSaved} />
        )}
      </DirectionProvider>
    </SafeAreaProvider>
  );
}

function infoButton(view: ReturnType<typeof render>, title: string, label: string): ReactTestInstance {
  let node = view.getByText(title).parent;
  while (node) {
    const matches = within(node).queryAllByRole("button", { name: label });
    if (matches.length === 1) return matches[0];
    node = node.parent;
  }
  throw new Error("No unique information action beside the learning-steps title");
}

function helpModal(view: ReturnType<typeof render>, body: string): ReactTestInstance {
  const modal = view
    .UNSAFE_getAllByType(NativeModal)
    .find((node) => node.props.visible && within(node).queryByText(body));
  if (!modal) throw new Error("Review-setting help modal is not visible");
  return modal;
}

function closeControl(modal: ReactTestInstance, className: string): ReactTestInstance {
  const control = modal.findAll(
    (node) =>
      typeof node.props.className === "string" &&
      node.props.className.includes(className) &&
      typeof node.props.onPress === "function",
  )[0];
  if (!control) throw new Error("Expected existing help-sheet dismissal control");
  return control;
}

const cases = [390, 768, 1280].flatMap((width) =>
  (["ar", "en"] as const).flatMap((language) =>
    (["deck", "smart"] as const).map((kind) => ({ width, language, kind })),
  ),
);

describe("review-setting help caller characterization", () => {
  beforeEach(() => {
    mockDatabase.getAllAsync.mockReset().mockResolvedValue([]);
    jest.mocked(readDeckReviewSettings).mockReset().mockResolvedValue(settings);
    jest.mocked(readSmartDeckFilter).mockReset().mockResolvedValue({ type: "all" });
    jest.mocked(writeDeckReviewSettings).mockReset();
    jest.mocked(writeSmartDeckFilter).mockReset();
    jest.mocked(materializeSmartDeckCards).mockReset();
  });

  afterEach(() => {
    cleanup();
    ReactNative.Dimensions.set({ window: originalWindow, screen: originalScreen });
    jest.restoreAllMocks();
  });

  it.each(cases)(
    "$kind $width $language preserves help layout, dismissal and unsaved input",
    async ({ kind, width, language }) => {
      const isRTL = language === "ar";
      const theme = isRTL ? "beige" : "dark";
      Object.assign(mockSettings, {
        uiLanguage: language,
        isRTL,
        isDark: theme === "dark",
        effectiveTheme: theme,
        themeSurface: THEME_COLORS[theme].surface,
        themeColors: THEME_COLORS[theme],
      });
      ReactNative.Dimensions.set({
        window: { width, height: 844, scale: 1, fontScale: 1 },
        screen: { width, height: 844, scale: 1, fontScale: 1 },
      });
      const s = strings[language];
      const onClose = jest.fn();
      const onSaved = jest.fn();
      const view = render(editor(kind, width, language, onClose, onSaved));
      const initial = formatStepText(settings.learningSteps, isRTL);
      await waitFor(() => expect(view.getByDisplayValue(initial)).toBeTruthy());
      const draft = "17m, 29m";
      fireEvent.changeText(view.getByDisplayValue(initial), draft);
      const body = s.flashcardsLearningStepsInfo;
      expect(view.queryByText(body)).toBeNull();

      for (const dismiss of ["header", "backdrop", "back"] as const) {
        await fireEventAsync.press(infoButton(view, s.flashcardsLearningSteps, s.deckReviewSettingsInfoButton));
        const modal = helpModal(view, body);
        const title = within(modal).getByText(s.flashcardsLearningSteps);
        const text = within(modal).getByText(body);
        const direction = isRTL ? "rtl" : "ltr";
        expect(flattenStyle(title.props.style)).toMatchObject({
          textAlign: isRTL ? "right" : "left",
          writingDirection: direction,
        });
        expect(text.props.className).toBe("text-charcoal dark:text-neutral-200");
        expect(flattenStyle(text.props.style)).toMatchObject({
          fontFamily: "Manrope_400Regular",
          fontSize: 14,
          lineHeight: 23,
          textAlign: isRTL ? "right" : "left",
          writingDirection: direction,
        });
        const sheet = view.UNSAFE_getAllByType(ResponsiveSheet).find((node) => node.props.maxWidth === 440);
        if (!sheet) throw new Error("Expected canonical help ResponsiveSheet");
        expect(sheet.props).toMatchObject({
          open: true,
          maxWidth: 440,
          maxHeight: width < SIDEBAR_BREAKPOINT ? "70%" : 360,
          dir: direction,
        });
        const header = view
          .UNSAFE_getAllByType(OverlayHeader)
          .find((node) => node.props.title === s.flashcardsLearningSteps);
        if (!header) throw new Error("Expected canonical help header");
        expect(header.props.showHandle).toBe(width < SIDEBAR_BREAKPOINT);
        const panel = modal.findAll(
          (node) => typeof node.props.className === "string" && node.props.className.includes("shadow-2xl"),
        )[0];
        if (!panel) throw new Error("Expected rendered help panel");
        expect(flattenStyle(panel.props.style)).toMatchObject({
          width: width < SIDEBAR_BREAKPOINT ? width : 440,
          maxHeight: width < SIDEBAR_BREAKPOINT ? "70%" : 360,
          direction,
        });

        if (dismiss === "back") await fireEventAsync(modal, "requestClose");
        else await fireEventAsync.press(closeControl(modal, dismiss === "header" ? "h-9 w-9" : "absolute inset-0"));
        await waitFor(() => expect(view.queryByText(body)).toBeNull());
        expect(view.getByDisplayValue(draft)).toBeTruthy();
        expect(onClose).not.toHaveBeenCalled();
        expect(onSaved).not.toHaveBeenCalled();
        expect(writeDeckReviewSettings).not.toHaveBeenCalled();
        expect(writeSmartDeckFilter).not.toHaveBeenCalled();
        expect(materializeSmartDeckCards).not.toHaveBeenCalled();
      }

      await fireEventAsync.press(infoButton(view, s.flashcardsLearningSteps, s.deckReviewSettingsInfoButton));
      expect(helpModal(view, body)).toBeTruthy();
      await act(async () => view.rerender(editor(kind, width, language, onClose, onSaved, false)));
      expect(view.queryByText(body)).toBeNull();
      await act(async () => view.rerender(editor(kind, width, language, onClose, onSaved)));
      await waitFor(() => expect(view.getByDisplayValue(initial)).toBeTruthy());
      expect(view.queryByText(body)).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      expect(writeDeckReviewSettings).not.toHaveBeenCalled();
      expect(writeSmartDeckFilter).not.toHaveBeenCalled();
      expect(materializeSmartDeckCards).not.toHaveBeenCalled();
    },
  );
});
