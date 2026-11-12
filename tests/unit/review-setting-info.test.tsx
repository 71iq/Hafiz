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
  mode: "ayah" | "word" = "ayah",
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
            mode={mode}
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
      jest.mocked(writeSmartDeckFilter).mockResolvedValue(undefined);
      jest.mocked(materializeSmartDeckCards).mockResolvedValue(0);
    });

    function panel(view: ReturnType<typeof render>): React.ComponentProps<typeof SchedulerOptionsPanel> {
      // ReactTestInstance erases props; selecting the actual typed component establishes this test boundary.
      return view.UNSAFE_getByType(SchedulerOptionsPanel).props as React.ComponentProps<typeof SchedulerOptionsPanel>;
    }

    function deferred() {
      let finish: (() => void) | undefined;
      const promise = new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        promise,
        resolve: () => {
          if (!finish) throw new Error("Missing resolver");
          finish();
        },
      };
    }

    function save(view: ReturnType<typeof render>, kind: EditorKind, language: Locale = "en") {
      return view.getByRole("button", {
        name: kind === "deck" ? strings[language].deckReviewSettingsSave : strings[language].smartDeckApplyFilter,
      });
    }

    it.each(draftCases)(
      "$kind $language hydrates, clamps and serializes the common scheduler draft",
      async ({ kind, language }) => {
        Object.assign(mockSettings, { uiLanguage: language, isRTL: language === "ar" });
        const close = jest.fn();
        const saved = jest.fn();
        const view = render(editor(kind, 390, language, close, saved));
        const initial = language === "ar" ? "٣ دقائق، ١٧ دقائق" : "3m, 17m";
        await waitFor(() => expect(view.getByDisplayValue(initial)).toBeTruthy());
        expect(panel(view)).toMatchObject({
          dailyLimit: 20,
          newCardsLimit: 10,
          requestRetention: 0.9,
          maximumInterval: 36500,
        });
        act(() => {
          panel(view).onRequestRetentionChange(9);
          panel(view).onMaximumIntervalChange(99999);
        });
        expect(panel(view)).toMatchObject({ requestRetention: 0.99, maximumInterval: 3650 });
        act(() => {
          panel(view).onDailyLimitChange(-99);
          panel(view).onNewCardsLimitChange(-99);
          panel(view).onRequestRetentionChange(-99);
          panel(view).onMaximumIntervalChange(-99);
          panel(view).onEnableFuzzChange(false);
          panel(view).onEnableShortTermChange(false);
          panel(view).onNewReviewOrderChange("reviewsFirst");
          panel(view).onReviewSortOrderChange("newest");
          panel(view).onNewCardSortOrderChange("created");
        });
        expect(panel(view)).toMatchObject({
          dailyLimit: 10,
          newCardsLimit: 0,
          requestRetention: 0.8,
          maximumInterval: 30,
        });
        fireEvent.changeText(view.getByDisplayValue(initial), language === "ar" ? "١ دقيقة، ٢ ساعات" : "1m, 2h");
        fireEvent.changeText(view.getByDisplayValue(language === "ar" ? "٤١ دقائق" : "41m"), "");
        fireEvent.press(save(view, kind, language));
        await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
        expect(writeDeckReviewSettings).toHaveBeenCalledWith(
          mockDatabase,
          kind === "deck" ? "isolated-review-help" : "default-retention",
          {
            ...settings,
            dailyReviewLimit: 10,
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
          },
        );
        expect(close).toHaveBeenCalledTimes(1);
        if (kind === "smart") {
          expect(writeSmartDeckFilter).toHaveBeenCalledWith(mockDatabase, "default-retention", { type: "all" });
          expect(materializeSmartDeckCards).toHaveBeenCalledWith(mockDatabase, "default-retention", 10, 0);
        } else {
          expect(writeSmartDeckFilter).not.toHaveBeenCalled();
          expect(materializeSmartDeckCards).not.toHaveBeenCalled();
        }
      },
    );

    it.each(draftCases)(
      "$kind $language discards an unsaved draft and rehydrates after reopening",
      async ({ kind, language }) => {
        Object.assign(mockSettings, { uiLanguage: language, isRTL: language === "ar" });
        const close = jest.fn();
        const saved = jest.fn();
        const view = render(editor(kind, 390, language, close, saved));
        await waitFor(() =>
          expect(view.getByDisplayValue(language === "ar" ? "٣ دقائق، ١٧ دقائق" : "3m, 17m")).toBeTruthy(),
        );
        fireEvent.changeText(view.getByDisplayValue(language === "ar" ? "٣ دقائق، ١٧ دقائق" : "3m, 17m"), "unsaved");
        jest
          .mocked(readDeckReviewSettings)
          .mockResolvedValue({ ...settings, dailyReviewLimit: 42, learningSteps: ["1h"] });
        view.rerender(editor(kind, 390, language, close, saved, false));
        view.rerender(editor(kind, 390, language, close, saved));
        await waitFor(() => expect(view.getByDisplayValue(language === "ar" ? "١ ساعة" : "1h")).toBeTruthy());
        expect(panel(view).dailyLimit).toBe(42);
        expect(view.queryByDisplayValue("unsaved")).toBeNull();
        expect(writeDeckReviewSettings).not.toHaveBeenCalled();
        expect(saved).not.toHaveBeenCalled();
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

    it.each(["ayah", "word"] as const)("keeps at least one %s mode and saves the selected mode list", async (mode) => {
      const saved = jest.fn();
      const view = render(editor("deck", 390, "en", jest.fn(), saved, true, mode));
      await waitFor(() => expect(view.getByDisplayValue("3m, 17m")).toBeTruthy());
      const first = mode === "ayah" ? strings.en.flashcardsModeNextAyah : strings.en.flashcardsModeWordMeaningArabic;
      const second =
        mode === "ayah" ? strings.en.flashcardsModeTranslation : strings.en.flashcardsModeWordMeaningTranslation;
      toggle(view, first);
      fireEvent.press(save(view, "deck"));
      await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
      expect(jest.mocked(writeDeckReviewSettings).mock.calls[0][2]).toMatchObject({
        testModes: ["nextAyah"],
        wordTestModes: ["wordMeaningArabic"],
      });
      toggle(view, second);
      toggle(view, first);
      fireEvent.press(save(view, "deck"));
      await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
      expect(jest.mocked(writeDeckReviewSettings).mock.calls[1][2]).toMatchObject(
        mode === "ayah"
          ? { testModes: ["translation"], wordTestModes: ["wordMeaningArabic"] }
          : { testModes: ["nextAyah"], wordTestModes: ["wordMeaningTranslation"] },
      );
    });

    it.each(["deck", "smart"] as const)(
      "%s reports a failed initial write, retains draft and retries without closing early",
      async (kind) => {
        const failure = new Error("synthetic settings write failure");
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        if (kind === "deck") jest.mocked(writeDeckReviewSettings).mockRejectedValueOnce(failure);
        else jest.mocked(writeSmartDeckFilter).mockRejectedValueOnce(failure);
        const close = jest.fn();
        const saved = jest.fn();
        const view = render(editor(kind, 390, "en", close, saved));
        await waitFor(() => expect(view.getByDisplayValue("3m, 17m")).toBeTruthy());
        fireEvent.changeText(view.getByDisplayValue("3m, 17m"), "19m");
        fireEvent.press(save(view, kind));
        const message = kind === "deck" ? strings.en.deckSettingsSaveFailed : strings.en.deckFilterSaveFailed;
        await waitFor(() => expect(view.getByText(message)).toBeTruthy());
        expect(view.getByDisplayValue("19m")).toBeTruthy();
        expect(close).not.toHaveBeenCalled();
        expect(saved).not.toHaveBeenCalled();
        if (kind === "smart") {
          expect(writeDeckReviewSettings).not.toHaveBeenCalled();
          expect(materializeSmartDeckCards).not.toHaveBeenCalled();
        }
        fireEvent.press(save(view, kind));
        await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
        expect(view.queryByText(message)).toBeNull();
        expect(close).toHaveBeenCalledTimes(1);
        expect(jest.mocked(writeDeckReviewSettings).mock.calls.at(-1)?.[2].learningSteps).toEqual(["19m"]);
      },
    );

    it.each(["settings", "materialization"] as const)(
      "preserves partial smart writes and retries a failed %s stage",
      async (stage) => {
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const failure = new Error("synthetic later stage failure");
        if (stage === "settings") jest.mocked(writeDeckReviewSettings).mockRejectedValueOnce(failure);
        else jest.mocked(materializeSmartDeckCards).mockRejectedValueOnce(failure);
        const close = jest.fn();
        const saved = jest.fn();
        const view = render(editor("smart", 390, "en", close, saved));
        await waitFor(() => expect(view.getByDisplayValue("3m, 17m")).toBeTruthy());
        fireEvent.press(save(view, "smart"));
        await waitFor(() => expect(view.getByText(strings.en.deckFilterSaveFailed)).toBeTruthy());
        expect(writeSmartDeckFilter).toHaveBeenCalledTimes(1);
        expect(writeDeckReviewSettings).toHaveBeenCalledTimes(1);
        expect(materializeSmartDeckCards).toHaveBeenCalledTimes(stage === "settings" ? 0 : 1);
        expect(saved).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        fireEvent.press(save(view, "smart"));
        await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
        expect(writeSmartDeckFilter).toHaveBeenCalledTimes(2);
        expect(writeDeckReviewSettings).toHaveBeenCalledTimes(2);
      },
    );

    it("awaits smart filter, settings and materialization before callbacks while preserving modes", async () => {
      const filter = deferred();
      const write = deferred();
      const materialize = deferred();
      jest.mocked(readSmartDeckFilter).mockResolvedValue({ type: "juz", juzNumbers: [3, 1] });
      jest.mocked(writeSmartDeckFilter).mockReturnValueOnce(filter.promise);
      jest.mocked(writeDeckReviewSettings).mockReturnValueOnce(write.promise);
      jest.mocked(materializeSmartDeckCards).mockImplementationOnce(async () => {
        await materialize.promise;
        return 0;
      });
      const close = jest.fn();
      const saved = jest.fn();
      const view = render(editor("smart", 390, "en", close, saved));
      await waitFor(() => expect(view.getByDisplayValue("3m, 17m")).toBeTruthy());
      fireEvent.press(save(view, "smart"));
      expect(writeSmartDeckFilter).toHaveBeenCalledWith(mockDatabase, "default-retention", {
        type: "juz",
        juzNumbers: [3, 1],
      });
      expect(writeDeckReviewSettings).not.toHaveBeenCalled();
      expect(saved).not.toHaveBeenCalled();
      await act(async () => filter.resolve());
      expect(writeDeckReviewSettings).toHaveBeenCalledWith(mockDatabase, "default-retention", settings);
      expect(materializeSmartDeckCards).not.toHaveBeenCalled();
      expect(saved).not.toHaveBeenCalled();
      await act(async () => write.resolve());
      expect(materializeSmartDeckCards).toHaveBeenCalledTimes(1);
      expect(saved).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      await act(async () => materialize.resolve());
      expect(saved).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it("accepts an ayah range typed with Arabic-Indic digits", async () => {
      const en = strings.en;
      mockDatabase.getAllAsync.mockResolvedValue([
        { number: 2, name_arabic: "البقرة", name_english: "Al-Baqarah", ayah_count: 286 },
      ]);
      jest.mocked(readSmartDeckFilter).mockResolvedValue({ type: "surah", surahs: [2] });
      jest.mocked(writeSmartDeckFilter).mockResolvedValue(undefined);
      jest.mocked(writeDeckReviewSettings).mockResolvedValue(undefined);
      jest.mocked(materializeSmartDeckCards).mockResolvedValue(0);
      const view = render(editor("smart", 390, "en", jest.fn(), jest.fn()));
      await waitFor(() => expect(view.getByDisplayValue("3m, 17m")).toBeTruthy());
      fireEvent.press(view.getByRole("button", { name: en.deckChangeSurahs }));
      await waitFor(() => expect(view.getByLabelText(en.deckSpecifyAyahRange)).toBeTruthy());
      fireEvent.press(view.getByLabelText(en.deckSpecifyAyahRange), { stopPropagation: jest.fn() });
      const from = await waitFor(() => view.getByLabelText(`${en.flashcardsFrom} ${en.reflectionAyahLabel}`));
      fireEvent.changeText(from, "١٠");
      fireEvent.changeText(view.getByLabelText(`${en.flashcardsTo} ${en.reflectionAyahLabel}`), "۲۰");
      expect(save(view, "smart").props.accessibilityState.disabled).toBe(false);
      fireEvent.press(save(view, "smart"));
      expect(writeSmartDeckFilter).toHaveBeenCalledWith(mockDatabase, "default-retention", {
        type: "surah",
        surahs: [2],
        ranges: [{ surah: 2, ayahStart: 10, ayahEnd: 20 }],
      });
    });

    it("disables smart saving for an empty surah selection without writing", async () => {
      jest.mocked(readSmartDeckFilter).mockResolvedValue({ type: "surah", surahs: [] });
      const view = render(editor("smart", 390, "en", jest.fn(), jest.fn()));
      await waitFor(() => expect(view.getByDisplayValue("3m, 17m")).toBeTruthy());
      expect(save(view, "smart").props.accessibilityState.disabled).toBe(true);
      fireEvent.press(save(view, "smart"));
      expect(writeSmartDeckFilter).not.toHaveBeenCalled();
    });
    it.each(["deck", "smart"] as const)("%s shows a load error and clears it after successful reopen", async (kind) => {
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      jest.mocked(readDeckReviewSettings).mockRejectedValueOnce(new Error("synthetic load failure"));
      const close = jest.fn();
      const saved = jest.fn();
      const view = render(editor(kind, 390, "en", close, saved));
      await waitFor(() => expect(view.getByText(strings.en.genericActionFailed)).toBeTruthy());
      expect(writeDeckReviewSettings).not.toHaveBeenCalled();
      expect(saved).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      view.rerender(editor(kind, 390, "en", close, saved, false));
      view.rerender(editor(kind, 390, "en", close, saved));
      await waitFor(() => expect(view.getByDisplayValue("3m, 17m")).toBeTruthy());
      expect(view.queryByText(strings.en.genericActionFailed)).toBeNull();
    });
  });
});
