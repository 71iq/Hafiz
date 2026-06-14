import React from "react";
import { Text as RNText, View } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AchievementProgressBar } from "@/components/achievements/AchievementProgressBar";
import {
  AuthFormNotice,
  AuthRouteLink,
  AuthScreenShell,
  AuthUnavailableState,
} from "@/components/auth/AuthScreenShell";
import { FontSizeControl } from "@/components/mushaf/FontSizeControl";
import { JuzNameText } from "@/components/mushaf/JuzNameText";
import { MushafIndicator } from "@/components/mushaf/MushafIndicator";
import { DefaultDeckProgressChart } from "@/components/progress/DefaultDeckProgressChart";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { OverlayFooter, OverlayHeader } from "@/components/ui/ResponsiveOverlay";
import { Progress } from "@/components/ui/Progress";
import { FONT_SIZE_STEPS } from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";
import {
  expectTextAlignStart,
  expectWritingDirection,
  findAncestorByClassName,
  flattenStyle,
  getStyleValue,
  renderWithDirection,
  type RtlTestNode,
} from "../rtl/rtl-test-utils";

const mockSetFontSizeIndex = jest.fn();
const mockUseSettings = jest.fn();
const mockIsQuranCommonFontLoaded = jest.fn();
const mockLoadQuranCommonFont = jest.fn();
const mockJuzNameGlyph = jest.fn();
const mockJuzNumberGlyph = jest.fn();

const mockThemeColors = {
  surface: "#FFF8F1",
  surfaceLow: "#F9F3EB",
  surfaceMid: "#F0EBE3",
  surfaceHigh: "#E8E1DA",
  surfaceDim: "#DFD9D1",
  surfaceBright: "#FFFFFF",
};

const mockSettingsState = {
  effectiveTheme: "beige",
  fontSizeIndex: 1,
  isDark: false,
  isRTL: false,
  setFontSizeIndex: mockSetFontSizeIndex,
  themeColors: mockThemeColors,
  themeSurface: mockThemeColors.surface,
  uiLanguage: "en",
};

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
  vars: (variables: Record<string, string>) => variables,
}));

jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual("@/lib/settings/context");
  return {
    ...actual,
    useSettings: () => mockUseSettings(),
  };
});

jest.mock("@/lib/fonts/loader", () => ({
  isQuranCommonFontLoaded: () => mockIsQuranCommonFontLoaded(),
  juzNameGlyph: (juz: number) => mockJuzNameGlyph(juz),
  juzNumberGlyph: (juz: number) => mockJuzNumberGlyph(juz),
  loadQuranCommonFont: () => mockLoadQuranCommonFont(),
  quranCommonFontName: () => "QuranCommon",
}));

function setMockSettings(overrides: Partial<typeof mockSettingsState> = {}) {
  Object.assign(mockSettingsState, {
    effectiveTheme: "beige",
    fontSizeIndex: 1,
    isDark: false,
    isRTL: false,
    setFontSizeIndex: mockSetFontSizeIndex,
    themeColors: mockThemeColors,
    themeSurface: mockThemeColors.surface,
    uiLanguage: "en",
  }, overrides);
}

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderInSafeArea(ui: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={safeAreaMetrics}>{ui}</SafeAreaProvider>);
}

function findByClassName(nodes: RtlTestNode[], token: string): RtlTestNode {
  const node = nodes.find((item) => typeof item.props.className === "string" && item.props.className.includes(token));
  if (!node) throw new Error(`No node with className containing ${token}`);
  return node;
}

function findAncestorByStyleValue(node: RtlTestNode, key: string, value: unknown): RtlTestNode {
  let current = node.parent;
  while (current) {
    if (flattenStyle(current.props.style)[key] === value) return current;
    current = current.parent;
  }
  throw new Error(`No ancestor with style ${key}=${String(value)}`);
}

describe("RTL higher-level component contracts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setMockSettings();
    mockUseSettings.mockImplementation(() => mockSettingsState);
    mockIsQuranCommonFontLoaded.mockReturnValue(true);
    mockLoadQuranCommonFont.mockResolvedValue(undefined);
    mockJuzNameGlyph.mockImplementation((juz: number) => `JUZ-NAME-${juz}`);
    mockJuzNumberGlyph.mockImplementation((juz: number) => `JUZ-${juz}`);
  });

  it("ResponsiveOverlay header and footer mirror overlay chrome in RTL", () => {
    setMockSettings({ isRTL: true, uiLanguage: "ar" });

    const { getByText } = renderInSafeArea(
      <>
        <OverlayHeader
          title="Settings"
          subtitle="Reader controls"
          leading={<RNText>Lead</RNText>}
          actions={<RNText>Action</RNText>}
          onClose={jest.fn()}
          isRTL
        />
        <OverlayFooter isRTL>
          <RNText>Cancel</RNText>
          <RNText>Confirm</RNText>
        </OverlayFooter>
      </>
    );

    const title = getByText("Settings");
    const subtitle = getByText("Reader controls");
    expectTextAlignStart(title, "rtl");
    expectWritingDirection(title, "rtl");
    expectTextAlignStart(subtitle, "rtl");
    expectWritingDirection(subtitle, "rtl");
    expect(findAncestorByClassName(title, "flex-row-reverse").props.style).toMatchObject({ direction: "ltr" });
    expect(findAncestorByClassName(getByText("Cancel"), "flex-row-reverse").props.style).toMatchObject({
      direction: "ltr",
    });
  });

  it("ConfirmDialog passes explicit RTL direction through message and action chrome", () => {
    setMockSettings({ isRTL: true, uiLanguage: "ar" });

    const { getByText } = renderInSafeArea(
      <ConfirmDialog
        visible
        title="Delete deck"
        message="This cannot be undone."
        cancelLabel="Cancel"
        confirmLabel="Delete"
        isDark={false}
        isRTL
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />
    );

    const message = getByText("This cannot be undone.");
    expectTextAlignStart(message, "rtl");
    expectWritingDirection(message, "rtl");
    expect(findAncestorByClassName(getByText("Cancel"), "flex-row-reverse").props.style).toMatchObject({
      direction: "ltr",
    });
  });

  it("Auth shell and auth helper rows mirror for Arabic locale", () => {
    const onBack = jest.fn();
    const onRoutePress = jest.fn();

    const { getByLabelText, getByText } = renderInSafeArea(
      <>
        <AuthScreenShell
          locale="ar"
          title="Login"
          subtitle="Welcome back"
          appName="Hafiz"
          brandHeadline="Review with care"
          brandBody="Keep your wird steady"
          backLabel="Back"
          onBack={onBack}
        >
          <RNText>Form content</RNText>
        </AuthScreenShell>
        <AuthFormNotice message="Check your email" tone="success" dir="rtl" />
        <AuthRouteLink prompt="Need an account?" action="Sign up" dir="rtl" onPress={onRoutePress} />
        <AuthUnavailableState title="Unavailable" subtitle="Try again later" dir="rtl" />
      </>
    );

    const title = getByText("Login");
    expectWritingDirection(title, "rtl");
    expect(findAncestorByStyleValue(getByLabelText("Back"), "flexDirection", "row-reverse")).toBeTruthy();
    expect(findAncestorByStyleValue(getByText("Need an account?"), "flexDirection", "row-reverse")).toBeTruthy();
    expectWritingDirection(getByText("Check your email"), "rtl");
    expectWritingDirection(getByText("Unavailable"), "rtl");

    fireEvent.press(getByText("Sign up"));
    expect(onRoutePress).toHaveBeenCalledTimes(1);
  });

  it("Mushaf font size control mirrors row order and keeps localized step labels actionable", () => {
    const onChangeStart = jest.fn();
    setMockSettings({ fontSizeIndex: 1, isRTL: true, uiLanguage: "ar" });

    const { UNSAFE_getAllByType, getByTestId, getByText } = render(<FontSizeControl onChangeStart={onChangeStart} />);
    const root = findByClassName(UNSAFE_getAllByType(View), "gap-2");
    expect(root.props.className).toContain("flex-row-reverse");
    expect(getStyleValue(root, "direction")).toBe("ltr");
    expect(getByText(`${toArabicNumber(2)}/${toArabicNumber(FONT_SIZE_STEPS.length)}`)).toBeTruthy();
    expectWritingDirection(getByText(`${toArabicNumber(2)}/${toArabicNumber(FONT_SIZE_STEPS.length)}`), "rtl");

    fireEvent.press(getByTestId("font-size-decrease"));
    fireEvent.press(getByTestId("font-size-increase"));

    expect(onChangeStart).toHaveBeenCalledTimes(2);
    expect(mockSetFontSizeIndex).toHaveBeenNthCalledWith(1, 0);
    expect(mockSetFontSizeIndex).toHaveBeenNthCalledWith(2, 2);
  });

  it("Mushaf indicator mirrors side labels while Juz glyph text stays LTR", () => {
    setMockSettings({ isRTL: true, uiLanguage: "ar" });

    const { UNSAFE_getAllByType, getByText } = render(<MushafIndicator surahName="Al-Fatihah" juz={2} />);
    const root = UNSAFE_getAllByType(View)[0];
    expect(root.props.className).toContain("flex-row-reverse");
    expect(flattenStyle(root.props.style).direction).toBe("ltr");

    const surahLabel = getByText(/Al-Fatihah/);
    expectTextAlignStart(surahLabel, "rtl");
    expectWritingDirection(surahLabel, "rtl");

    const juzGlyph = getByText("JUZ-2");
    expect(getStyleValue(juzGlyph, "fontFamily")).toBe("QuranCommon");
    expectWritingDirection(juzGlyph, "ltr");
  });

  it("JuzNameText falls back without loading glyph font when disabled", () => {
    const { getByText } = render(<JuzNameText enabled={false} fallback="Juz 4" juz={4} />);

    expect(getByText("Juz 4").props.accessibilityLabel).toBe("Juz 4");
    expect(mockLoadQuranCommonFont).not.toHaveBeenCalled();
  });

  it("Progress primitives fill from logical start without mirror transforms", () => {
    const progress = renderWithDirection(<Progress testID="progress" value={45} />, "rtl");
    const track = progress.getByTestId("progress");
    const fill = findByClassName(progress.UNSAFE_getAllByType(View), "bg-primary-accent");

    expect(getStyleValue(track, "alignItems")).toBe("flex-end");
    expect(getStyleValue(fill, "width")).toBe("45%");
    expect(getStyleValue(fill, "transform")).toBeUndefined();

    setMockSettings({ isRTL: true });
    const achievement = render(<AchievementProgressBar current={4} target={8} />);
    const achievementTrack = findByClassName(achievement.UNSAFE_getAllByType(View), "overflow-hidden");
    const achievementFill = findByClassName(achievement.UNSAFE_getAllByType(View), "bg-primary-accent");

    expect(getStyleValue(achievementTrack, "alignItems")).toBe("flex-end");
    expect(getStyleValue(achievementFill, "width")).toBe("50%");
    expect(getStyleValue(achievementFill, "transform")).toBeUndefined();
  });

  it("Default deck progress chart resets ambient RTL before mirroring rows", () => {
    const s = {
      smartDeckRetentionTitle: "Retention",
      smartDeckMutashabihatTitle: "Mutashabihat",
      smartDeckSimilarTailsTitle: "Similar Tails",
      smartDeckQiraatTitle: "Qiraat",
      smartDeckReasonsTitle: "Reasons of Revelation",
      "achievementCategory.vocab": "Vocabulary",
      vocabDeckTitle: "Vocabulary",
      progressDefaultDecks: "Default Deck Progress",
      flashcardsTotalCards: "Total Cards",
      progressDeckStarted: "Started",
      flashcardsNewCards: "New",
      deckCardsFilterDue: "Due",
      progressDefaultDecksEmpty: "No deck progress yet",
    };

    setMockSettings({ isRTL: true, uiLanguage: "ar" });
    const { getByText } = render(
      <DefaultDeckProgressChart
        items={[
          {
            key: "retention",
            deckId: "smart-retention",
            isSmartDeck: true,
            color: "#14b8a6",
            total: 7,
            startedCount: 7,
            newCount: 0,
            dueCount: 7,
          },
        ]}
        isDark={false}
        isRTL
        s={s}
      />
    );

    const headerRow = findAncestorByClassName(getByText("Default Deck Progress"), "flex-row");
    const deckRow = findAncestorByClassName(getByText("Retention"), "justify-between");
    const metricsRow = findAncestorByClassName(getByText("Due"), "flex-wrap");

    for (const row of [headerRow, deckRow, metricsRow]) {
      expect(getStyleValue(row, "direction")).toBe("ltr");
      expect(getStyleValue(row, "flexDirection")).toBe("row-reverse");
    }
  });
});
