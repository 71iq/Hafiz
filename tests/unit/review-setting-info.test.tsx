import { textStartStyle } from "@/lib/ui/direction";
import React from "react";
import * as ReactNative from "react-native";
import { act, cleanup, fireEvent, fireEventAsync, render, waitFor, within } from "@testing-library/react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  DeckReviewSettingsSheet,
  formatStepText,
  SchedulerOptionsPanel,
} from "@/components/flashcards/DeckReviewSettingsSheet";
import { SmartDeckFilterSheet } from "@/components/flashcards/SmartDeckFilterSheet";
import { OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { DirectionProvider } from "@/lib/ui/direction";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { THEME_COLORS, useSettings } from "@/lib/settings/context";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { putDeckReviewSettings, readDeckReviewSettings, writeDeckReviewSettings } from "@/lib/fsrs/queries";
import { materializeSmartDeckCards, putSmartDeckFilter, readSmartDeckFilter } from "@/lib/fsrs/smart-decks";
import type { DeckReviewSettings } from "@/lib/fsrs/types";
import { flattenStyle } from "../rtl/rtl-test-utils";

type EditorKind = "deck" | "smart";
type Locale = "ar" | "en";
const mockTx = { tx: true };
const mockDatabase = {
  getAllAsync: jest.fn<Promise<unknown[]>, [string]>(async () => []),
  withTransactionAsync: jest.fn(async (work: (tx: unknown) => Promise<void>) => work(mockTx)),
};
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
jest.mock("@/lib/fsrs/queries", () => ({
  readDeckReviewSettings: jest.fn(),
  writeDeckReviewSettings: jest.fn(),
  putDeckReviewSettings: jest.fn(),
}));
jest.mock("@/lib/fsrs/smart-decks", () => ({
  SMART_DECK_IDS: {
    retention: "default-retention",
    mutashabihat: "default-mutashabihat",
    similarTails: "default-similar-tails",
    qiraat: "default-qiraat",
    reasonsOfRevelation: "default-reasons-of-revelation",
  },
  readSmartDeckFilter: jest.fn(),
  putSmartDeckFilter: jest.fn(),
  materializeSmartDeckCards: jest.fn(),
}));

function editor(
  kind: EditorKind,
  width: number,
  language: Locale,
  onClose: () => void,
  onSaved: (notice: string) => void,
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

function openAdvanced(view: ReturnType<typeof render>, language: Locale = "en") {
  fireEvent.press(view.getByRole("button", { name: strings[language].deckSettingsAdvanced }));
}

/** Waits for the loaded settings: the daily limit input shows the stored value. */
async function loaded(view: ReturnType<typeof render>, language: Locale = "en") {
  await waitFor(() => expect(view.getByLabelText(strings[language].flashcardsDailyLimit).props.value).toBe("20"));
}

const cases = [390, 768, 1280].flatMap((width) =>
  (["ar", "en"] as const).flatMap((language) =>
    (["deck", "smart"] as const).map((kind) => ({ width, language, kind })),
  ),
);

describe("review-setting help caller characterization", () => {
  beforeEach(() => {
    mockDatabase.getAllAsync.mockReset().mockResolvedValue([]);
    mockDatabase.withTransactionAsync.mockClear();
    jest.mocked(readDeckReviewSettings).mockReset().mockResolvedValue(settings);
    jest.mocked(readSmartDeckFilter).mockReset().mockResolvedValue({ type: "all" });
    jest.mocked(writeDeckReviewSettings).mockReset();
    jest.mocked(putDeckReviewSettings).mockReset();
    jest.mocked(putSmartDeckFilter).mockReset();
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
      await loaded(view, language);
      openAdvanced(view, language);
      const initial = formatStepText(settings.learningSteps, isRTL);
      expect(view.getByDisplayValue(initial)).toBeTruthy();
      const draft = "17m, 29m";
      fireEvent.changeText(view.getByDisplayValue(initial), draft);
      const body = s.flashcardsLearningStepsInfo;
      const infoLabel = interpolate(s.deckSettingInfoFor, { setting: s.flashcardsLearningSteps });
      expect(view.queryByText(body)).toBeNull();

      for (const dismiss of ["header", "backdrop", "back"] as const) {
        await fireEventAsync.press(infoButton(view, s.flashcardsLearningSteps, infoLabel));
        const modal = helpModal(view, body);
        const title = within(modal).getByText(s.flashcardsLearningSteps);
        const text = within(modal).getByText(body);
        const direction = isRTL ? "rtl" : "ltr";
        expect(flattenStyle(title.props.style)).toMatchObject({
          ...textStartStyle(isRTL),
          writingDirection: direction,
        });
        expect(text.props.className).toBe("text-charcoal dark:text-neutral-200");
        expect(flattenStyle(text.props.style)).toMatchObject({
          fontFamily: "Manrope_400Regular",
          fontSize: 14,
          lineHeight: 23,
          ...textStartStyle(isRTL),
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
        // Inert grab handles are gone from every deck sheet.
        expect(header.props.showHandle).toBeFalsy();
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
        expect(putSmartDeckFilter).not.toHaveBeenCalled();
        expect(materializeSmartDeckCards).not.toHaveBeenCalled();
      }

      await fireEventAsync.press(infoButton(view, s.flashcardsLearningSteps, infoLabel));
      expect(helpModal(view, body)).toBeTruthy();
      await act(async () => view.rerender(editor(kind, width, language, onClose, onSaved, false)));
      expect(view.queryByText(body)).toBeNull();
      await act(async () => view.rerender(editor(kind, width, language, onClose, onSaved)));
      await loaded(view, language);
      // Advanced starts closed again on every opening.
      expect(view.queryByDisplayValue(initial)).toBeNull();
      openAdvanced(view, language);
      expect(view.getByDisplayValue(initial)).toBeTruthy();
      expect(view.queryByText(body)).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      expect(writeDeckReviewSettings).not.toHaveBeenCalled();
      expect(putSmartDeckFilter).not.toHaveBeenCalled();
      expect(materializeSmartDeckCards).not.toHaveBeenCalled();
    },
  );

  describe("review settings draft behavior", () => {
    const draftCases = (["deck", "smart"] as const).flatMap((kind) =>
      (["en", "ar"] as const).map((language) => ({ kind, language })),
    );

    beforeEach(() => {
      Object.assign(mockSettings, {
        uiLanguage: "en",
        isRTL: false,
        isDark: false,
        effectiveTheme: "beige",
        themeSurface: THEME_COLORS.beige.surface,
        themeColors: THEME_COLORS.beige,
      });
      ReactNative.Dimensions.set({
        window: { width: 390, height: 844, scale: 1, fontScale: 1 },
        screen: { width: 390, height: 844, scale: 1, fontScale: 1 },
      });
      jest.mocked(writeDeckReviewSettings).mockResolvedValue(undefined);
      jest.mocked(putDeckReviewSettings).mockResolvedValue(undefined);
      jest.mocked(putSmartDeckFilter).mockResolvedValue(undefined);
      jest.mocked(materializeSmartDeckCards).mockResolvedValue(0);
    });

    function panel(view: ReturnType<typeof render>): React.ComponentProps<typeof SchedulerOptionsPanel> {
      // ReactTestInstance erases props; selecting the actual typed component establishes this test boundary.
      return view.UNSAFE_getByType(SchedulerOptionsPanel).props as React.ComponentProps<typeof SchedulerOptionsPanel>;
    }

    function save(view: ReturnType<typeof render>, kind: EditorKind, language: Locale = "en") {
      return view.getByRole("button", {
        name: kind === "deck" ? strings[language].deckReviewSettingsSave : strings[language].deckSettingsSave,
      });
    }

    function savedSettings(kind: EditorKind) {
      return kind === "deck"
        ? jest.mocked(writeDeckReviewSettings).mock.calls.at(-1)?.[2]
        : jest.mocked(putDeckReviewSettings).mock.calls.at(-1)?.[2];
    }

    it.each(draftCases)(
      "$kind $language hydrates, clamps and saves the scheduler draft in one commit",
      async ({ kind, language }) => {
        Object.assign(mockSettings, { uiLanguage: language, isRTL: language === "ar" });
        const s = strings[language];
        const close = jest.fn();
        const saved = jest.fn();
        const view = render(editor(kind, 390, language, close, saved));
        await loaded(view, language);
        expect(panel(view).draft).toMatchObject({
          dailyLimitText: "20",
          newCardsLimit: 10,
          requestRetention: 0.9,
          maximumInterval: 36500,
        });
        // Nothing changed yet, so Save is dimmed.
        expect(save(view, kind, language).props.accessibilityState.disabled).toBe(true);
        act(() => panel(view).onChange({ requestRetention: 9, maximumInterval: 99999 }));
        expect(panel(view).draft).toMatchObject({ requestRetention: 0.99, maximumInterval: 3650 });
        act(() =>
          panel(view).onChange({
            newCardsLimit: -99,
            requestRetention: -99,
            maximumInterval: -99,
            enableFuzz: false,
            enableShortTerm: false,
            newReviewOrder: "reviewsFirst",
            reviewSortOrder: "newest",
            newCardSortOrder: "created",
          }),
        );
        expect(panel(view).draft).toMatchObject({ newCardsLimit: 0, requestRetention: 0.8, maximumInterval: 30 });
        fireEvent.changeText(view.getByLabelText(s.flashcardsDailyLimit), language === "ar" ? "٧٥٠" : "750");
        openAdvanced(view, language);
        const initial = language === "ar" ? "٣ دقائق، ١٧ دقائق" : "3m, 17m";
        fireEvent.changeText(view.getByDisplayValue(initial), language === "ar" ? "١ دقيقة، ٢ ساعات" : "1m, 2h");
        fireEvent.changeText(view.getByDisplayValue(language === "ar" ? "٤١ دقائق" : "41m"), "");
        expect(view.getByText(s.deckStepsNone)).toBeTruthy();
        fireEvent.press(save(view, kind, language));
        await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
        const expected = {
          ...settings,
          // A typed daily limit is kept as typed within the owner's domain: no 500 cap.
          dailyReviewLimit: 750,
          newCardsLimit: 0,
          requestRetention: 0.8,
          maximumInterval: 30,
          enableFuzz: false,
          enableShortTerm: false,
          learningSteps: ["1m", "2h"],
          relearningSteps: [],
          newReviewOrder: "reviewsFirst",
          reviewSortOrder: "newest",
          newCardSortOrder: "created",
        };
        expect(close).toHaveBeenCalledTimes(1);
        if (kind === "smart") {
          expect(mockDatabase.withTransactionAsync).toHaveBeenCalledTimes(1);
          expect(putSmartDeckFilter).toHaveBeenCalledWith(mockTx, "default-retention", { type: "all" });
          expect(putDeckReviewSettings).toHaveBeenCalledWith(mockTx, "default-retention", expected);
          expect(materializeSmartDeckCards).toHaveBeenCalledWith(mockDatabase, "default-retention", 750, 0);
          expect(saved).toHaveBeenCalledWith(
            interpolate(s.deckSettingsSavedNamed, { deck: s.smartDeckRetentionTitle }),
          );
          expect(writeDeckReviewSettings).not.toHaveBeenCalled();
        } else {
          expect(writeDeckReviewSettings).toHaveBeenCalledWith(mockDatabase, "isolated-review-help", expected);
          expect(saved).toHaveBeenCalledWith(interpolate(s.deckSettingsSavedNamed, { deck: "Isolated review help" }));
          expect(putSmartDeckFilter).not.toHaveBeenCalled();
          expect(materializeSmartDeckCards).not.toHaveBeenCalled();
        }
      },
    );

    it.each(["deck", "smart"] as const)(
      "%s reports invalid step text instead of dropping tokens and disables Save",
      async (kind) => {
        const s = strings.en;
        const view = render(editor(kind, 390, "en", jest.fn(), jest.fn()));
        await loaded(view);
        openAdvanced(view);
        fireEvent.changeText(view.getByDisplayValue("3m, 17m"), "1m, bad, 2h");
        expect(view.getByText(s.deckStepsInvalid)).toBeTruthy();
        expect(save(view, kind).props.accessibilityState.disabled).toBe(true);
        fireEvent.press(save(view, kind));
        expect(writeDeckReviewSettings).not.toHaveBeenCalled();
        expect(putDeckReviewSettings).not.toHaveBeenCalled();
        // Advanced cannot fold away while its error decides Save.
        fireEvent.press(view.getByRole("button", { name: s.deckSettingsAdvanced }));
        expect(view.getByDisplayValue("1m, bad, 2h")).toBeTruthy();
        fireEvent.changeText(view.getByDisplayValue("1m, bad, 2h"), "1m 10m");
        expect(view.getByText(interpolate(s.deckStepsWillUse, { steps: "1 min, 10 min" }))).toBeTruthy();
        expect(save(view, kind).props.accessibilityState.disabled).toBe(false);
      },
    );

    it.each(["9", "12.5", "-20", "", "2O"])("rejects the typed daily limit %j with an inline error", async (text) => {
      const s = strings.en;
      const view = render(editor("deck", 390, "en", jest.fn(), jest.fn()));
      await loaded(view);
      fireEvent.changeText(view.getByLabelText(s.flashcardsDailyLimit), text);
      expect(view.getByText(interpolate(s.deckDailyLimitInvalid, { min: "10" }))).toBeTruthy();
      expect(save(view, "deck").props.accessibilityState.disabled).toBe(true);
      // The stepper still works from the default and fixes the field.
      fireEvent.press(view.getByRole("button", { name: `${s.flashcardsDailyLimit} +` }));
      expect(view.getByLabelText(s.flashcardsDailyLimit).props.value).toBe("30");
      expect(view.queryByText(interpolate(s.deckDailyLimitInvalid, { min: "10" }))).toBeNull();
    });

    it.each(draftCases)(
      "$kind $language discards an unsaved draft and rehydrates after reopening",
      async ({ kind, language }) => {
        Object.assign(mockSettings, { uiLanguage: language, isRTL: language === "ar" });
        const close = jest.fn();
        const saved = jest.fn();
        const view = render(editor(kind, 390, language, close, saved));
        await loaded(view, language);
        openAdvanced(view, language);
        fireEvent.changeText(view.getByDisplayValue(language === "ar" ? "٣ دقائق، ١٧ دقائق" : "3m, 17m"), "unsaved");
        jest
          .mocked(readDeckReviewSettings)
          .mockResolvedValue({ ...settings, dailyReviewLimit: 42, learningSteps: ["1h"] });
        view.rerender(editor(kind, 390, language, close, saved, false));
        view.rerender(editor(kind, 390, language, close, saved));
        await waitFor(() => expect(panel(view).draft.dailyLimitText).toBe("42"));
        expect(panel(view).draft.learningStepsText).toBe(language === "ar" ? "١ ساعة" : "1h");
        expect(view.queryByDisplayValue("unsaved")).toBeNull();
        expect(writeDeckReviewSettings).not.toHaveBeenCalled();
        expect(saved).not.toHaveBeenCalled();
      },
    );

    it.each(["deck", "smart"] as const)(
      "%s asks before closing a dirty draft and closes a clean one at once",
      async (kind) => {
        const s = strings.en;
        const close = jest.fn();
        const view = render(editor(kind, 390, "en", close, jest.fn()));
        await loaded(view);
        const header = view.UNSAFE_getAllByType(OverlayHeader)[0];
        act(() => header.props.onClose());
        expect(close).toHaveBeenCalledTimes(1);
        fireEvent.changeText(view.getByLabelText(s.flashcardsDailyLimit), "40");
        act(() => header.props.onClose());
        expect(close).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(view.getByText(s.discardChangesTitle)).toBeTruthy());
        fireEvent.press(view.getByText(s.discardChangesKeepEditing));
        await waitFor(() => expect(view.queryByText(s.discardChangesTitle)).toBeNull());
        expect(view.getByLabelText(s.flashcardsDailyLimit).props.value).toBe("40");
        act(() => header.props.onClose());
        fireEvent.press(await waitFor(() => view.getByText(s.discardChangesConfirm)));
        expect(close).toHaveBeenCalledTimes(2);
        expect(writeDeckReviewSettings).not.toHaveBeenCalled();
        expect(putDeckReviewSettings).not.toHaveBeenCalled();
      },
    );

    function toggle(view: ReturnType<typeof render>, label: string) {
      let node = view.getByText(label).parent;
      while (node) {
        const controls = within(node).queryAllByRole("switch");
        if (controls.length === 1) {
          fireEvent.press(controls[0]);
          return;
        }
        node = node.parent;
      }
      throw new Error("No unique mode switch beside label");
    }

    it("keeps one word side on, explains why, and preserves stored ayah test modes", async () => {
      const s = strings.en;
      const saved = jest.fn();
      const view = render(editor("deck", 390, "en", jest.fn(), saved));
      await loaded(view);
      expect(view.getByText(s.deckWordSideArabicDesc)).toBeTruthy();
      expect(view.getByText(s.deckWordSideTranslationDesc)).toBeTruthy();
      toggle(view, s.flashcardsModeWordMeaningArabic);
      expect(view.getByText(s.deckKeepOneSide)).toBeTruthy();
      expect(save(view, "deck").props.accessibilityState.disabled).toBe(true);
      toggle(view, s.flashcardsModeWordMeaningTranslation);
      expect(view.queryByText(s.deckKeepOneSide)).toBeNull();
      toggle(view, s.flashcardsModeWordMeaningArabic);
      fireEvent.press(save(view, "deck"));
      await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
      expect(savedSettings("deck")).toMatchObject({
        testModes: ["nextAyah"],
        wordTestModes: ["wordMeaningTranslation"],
      });
    });

    it.each(["deck", "smart"] as const)(
      "%s reports a failed write, retains the draft and retries without closing early",
      async (kind) => {
        const failure = new Error("synthetic settings write failure");
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        if (kind === "deck") jest.mocked(writeDeckReviewSettings).mockRejectedValueOnce(failure);
        else jest.mocked(putDeckReviewSettings).mockRejectedValueOnce(failure);
        const close = jest.fn();
        const saved = jest.fn();
        const view = render(editor(kind, 390, "en", close, saved));
        await loaded(view);
        openAdvanced(view);
        fireEvent.changeText(view.getByDisplayValue("3m, 17m"), "19m");
        fireEvent.press(save(view, kind));
        const message = kind === "deck" ? strings.en.deckSettingsSaveFailed : strings.en.deckFilterSaveFailed;
        await waitFor(() => expect(view.getByText(message)).toBeTruthy());
        expect(view.getByDisplayValue("19m")).toBeTruthy();
        expect(close).not.toHaveBeenCalled();
        expect(saved).not.toHaveBeenCalled();
        // A failed commit never builds today's cards from settings that were not saved.
        expect(materializeSmartDeckCards).not.toHaveBeenCalled();
        fireEvent.press(save(view, kind));
        await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
        expect(view.queryByText(message)).toBeNull();
        expect(close).toHaveBeenCalledTimes(1);
        expect(savedSettings(kind)?.learningSteps).toEqual(["19m"]);
      },
    );

    it("treats a failure to prepare today's cards after a committed save as saved", async () => {
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      jest.mocked(materializeSmartDeckCards).mockRejectedValueOnce(new Error("synthetic later stage failure"));
      const close = jest.fn();
      const saved = jest.fn();
      const view = render(editor("smart", 390, "en", close, saved));
      await loaded(view);
      fireEvent.changeText(view.getByLabelText(strings.en.flashcardsDailyLimit), "30");
      fireEvent.press(save(view, "smart"));
      await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
      expect(close).toHaveBeenCalledTimes(1);
      expect(view.queryByText(strings.en.deckFilterSaveFailed)).toBeNull();
    });

    it("accepts an ayah range typed with Arabic-Indic digits and labels the range chip", async () => {
      const en = strings.en;
      mockDatabase.getAllAsync.mockResolvedValue([
        { number: 2, name_arabic: "البقرة", name_english: "The Cow", ayah_count: 286 },
      ]);
      jest.mocked(readSmartDeckFilter).mockResolvedValue({ type: "surah", surahs: [2] });
      const view = render(editor("smart", 390, "en", jest.fn(), jest.fn()));
      await loaded(view);
      expect(view.getByText(`${"1 surah"} · ${"286 ayahs"}`)).toBeTruthy();
      fireEvent.press(view.getByRole("button", { name: en.deckChangeSurahs }));
      const chip = await waitFor(() => view.getByLabelText(`${en.deckSpecifyAyahRange}: ${en.deckScopeFullSurah}`));
      fireEvent.press(chip, { stopPropagation: jest.fn() });
      const from = await waitFor(() => view.getByLabelText(`${en.flashcardsFrom} ${en.reflectionAyahLabel}`));
      const to = view.getByLabelText(`${en.flashcardsTo} ${en.reflectionAyahLabel}`);
      fireEvent.changeText(from, "٣٠");
      fireEvent.changeText(to, "۲۰");
      expect(view.getByText(en.deckScopeRangeOrder)).toBeTruthy();
      expect(view.getByText(interpolate(en.deckScopeCheckRange, { surah: "Al-Baqara" }))).toBeTruthy();
      expect(save(view, "smart").props.accessibilityState.disabled).toBe(true);
      fireEvent.changeText(from, "١٠");
      expect(view.queryByText(en.deckScopeRangeOrder)).toBeNull();
      expect(view.getByText(interpolate(en.deckScopeRangeHelper, { n: "286" }))).toBeTruthy();
      expect(save(view, "smart").props.accessibilityState.disabled).toBe(false);
      fireEvent.press(save(view, "smart"));
      await waitFor(() =>
        expect(putSmartDeckFilter).toHaveBeenCalledWith(mockTx, "default-retention", {
          type: "surah",
          surahs: [2],
          ranges: [{ surah: 2, ayahStart: 10, ayahEnd: 20 }],
        }),
      );
    });

    it("filters the surah list by name or number and selects or clears the visible rows", async () => {
      const en = strings.en;
      mockDatabase.getAllAsync.mockImplementation(async (sql: string) =>
        sql.includes("FROM surahs")
          ? [
              { number: 2, name_arabic: "البقرة", name_english: "The Cow", ayah_count: 286 },
              { number: 36, name_arabic: "يس", name_english: "Ya Sin", ayah_count: 83 },
            ]
          : [],
      );
      jest.mocked(readSmartDeckFilter).mockResolvedValue({ type: "surah", surahs: [] });
      const view = render(editor("smart", 390, "en", jest.fn(), jest.fn()));
      await loaded(view);
      expect(view.getByText(en.deckScopeSelectSurah)).toBeTruthy();
      fireEvent.press(view.getByRole("button", { name: en.flashcardsSelectSurahs }));
      const search = await waitFor(() => view.getByLabelText(en.deckScopeSearchSurahs));
      fireEvent.changeText(search, "36");
      expect(view.queryByText("The Cow")).toBeNull();
      fireEvent.changeText(search, "يس");
      expect(view.getByText("Ya Sin")).toBeTruthy();
      fireEvent.press(view.getAllByRole("button", { name: en.deckScopeSelectAll })[0]);
      fireEvent.changeText(search, "");
      expect(view.getByText(`${"1 surah"} · ${"83 ayahs"}`)).toBeTruthy();
      fireEvent.press(view.getAllByRole("button", { name: en.deckScopeClear })[0]);
      expect(view.getByText(en.deckScopeSelectSurah)).toBeTruthy();
    });

    it("disables smart saving for an empty surah selection without writing", async () => {
      jest.mocked(readSmartDeckFilter).mockResolvedValue({ type: "surah", surahs: [] });
      const view = render(editor("smart", 390, "en", jest.fn(), jest.fn()));
      await loaded(view);
      expect(view.getByText(strings.en.deckScopeSelectSurah)).toBeTruthy();
      expect(save(view, "smart").props.accessibilityState.disabled).toBe(true);
      fireEvent.press(save(view, "smart"));
      expect(putSmartDeckFilter).not.toHaveBeenCalled();
    });

    it("shows juz chips in Arabic digits with exact ranges and select all / clear", async () => {
      Object.assign(mockSettings, { uiLanguage: "ar", isRTL: true });
      const ar = strings.ar;
      mockDatabase.getAllAsync.mockImplementation(async (sql: string) =>
        sql.includes("FROM juz_map")
          ? [
              { juz: 1, surah: 1, ayah_start: 1, ayah_end: 7 },
              { juz: 1, surah: 2, ayah_start: 1, ayah_end: 141 },
              { juz: 2, surah: 2, ayah_start: 142, ayah_end: 252 },
            ]
          : [
              { number: 1, name_arabic: "الفاتحة", name_english: "The Opening", ayah_count: 7 },
              { number: 2, name_arabic: "البقرة", name_english: "The Cow", ayah_count: 286 },
            ],
      );
      jest.mocked(readSmartDeckFilter).mockResolvedValue({ type: "juz", juzNumbers: [2] });
      const view = render(editor("smart", 390, "ar", jest.fn(), jest.fn()));
      await waitFor(() => expect(view.getByLabelText(ar.flashcardsDailyLimit).props.value).toBe("20"));
      expect(view.getByText("٣٠")).toBeTruthy();
      expect(view.getByText("البقرة ١٤٢-٢٥٢")).toBeTruthy();
      fireEvent.press(view.getByLabelText(interpolate(ar.deckScopeJuzLabel, { n: "١" })));
      expect(view.getByText("الفاتحة، البقرة ١-٢٥٢")).toBeTruthy();
      fireEvent.press(view.getByRole("button", { name: ar.deckScopeClear }));
      expect(view.getByText(ar.deckScopeSelectJuz)).toBeTruthy();
      fireEvent.press(view.getByRole("button", { name: ar.deckScopeSelectAll }));
      expect(view.queryByText(ar.deckScopeSelectJuz)).toBeNull();
    });

    it.each(["deck", "smart"] as const)("%s shows a load error with Try again and recovers", async (kind) => {
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      jest.mocked(readDeckReviewSettings).mockRejectedValueOnce(new Error("synthetic load failure"));
      const close = jest.fn();
      const saved = jest.fn();
      const view = render(editor(kind, 390, "en", close, saved));
      await waitFor(() => expect(view.getByText(strings.en.genericActionFailed)).toBeTruthy());
      // Nothing loaded, so nothing can be saved over the stored settings.
      expect(save(view, kind).props.accessibilityState.disabled).toBe(true);
      expect(writeDeckReviewSettings).not.toHaveBeenCalled();
      expect(saved).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      fireEvent.press(view.getByRole("button", { name: strings.en.decksTryAgain }));
      await loaded(view);
      expect(view.queryByText(strings.en.genericActionFailed)).toBeNull();
    });
  });
});
