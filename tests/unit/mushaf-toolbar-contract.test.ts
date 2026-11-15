import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ReaderToolbar } from "@/components/mushaf/ReaderToolbar";
import { strings } from "@/lib/i18n/strings";
import {
  PHONE_TOOLBAR_WIDTH,
  TOOLBAR_GAP,
  TOOLBAR_GUTTER,
  TOOLBAR_TARGET,
  toolbarRowWidth,
  usesWideToolbar,
  wideToolbarWidth,
} from "@/lib/mushaf/reader-toolbar";

let mockLocale: "en" | "ar" = "en";
jest.mock("@/lib/i18n/useStrings", () => ({
  interpolate: jest.requireActual("@/lib/i18n/useStrings").interpolate,
  useStrings: () => jest.requireActual("@/lib/i18n/strings").strings[mockLocale],
}));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    isDark: false,
    isRTL: mockLocale === "ar",
    pageScroll: "vertical",
    setPageScroll: jest.fn(),
    themeColors: { surface: "#fff", surfaceLow: "#f5f5f5" },
  }),
}));
jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => true }));

const noop = () => {};
function toolbar(viewportWidth: number, overrides: Partial<React.ComponentProps<typeof ReaderToolbar>> = {}) {
  return React.createElement(ReaderToolbar, {
    viewportWidth,
    isPageMode: false,
    onToggleMode: noop,
    onSearch: noop,
    hideActive: false,
    onToggleHide: noop,
    recitationAvailable: true,
    recitationActive: false,
    onRecitation: noop,
    settingsActive: false,
    onReadingSettings: noop,
    onBookmarks: noop,
    onGoTo: noop,
    onHome: noop,
    focusAvailable: false,
    onFocus: noop,
    onHelp: noop,
    ...overrides,
  });
}

describe("Reader toolbar sizing", () => {
  it("fits six 44px targets, five 4px gaps and two 16px gutters in 316px", () => {
    expect([TOOLBAR_TARGET, TOOLBAR_GAP, TOOLBAR_GUTTER]).toEqual([44, 4, 16]);
    expect(PHONE_TOOLBAR_WIDTH).toBe(6 * 44 + 5 * 4 + 2 * 16);
    expect(PHONE_TOOLBAR_WIDTH).toBe(316);
    expect(PHONE_TOOLBAR_WIDTH).toBeLessThanOrEqual(320);
  });

  it("keeps phones below 768px on the six-target row whatever the space", () => {
    expect(usesWideToolbar(767, 2000, { actionCount: 9, showsDirectionChevron: true })).toBe(false);
  });

  it("shows the full toolbar at 768px and above only while it fits", () => {
    const content = { actionCount: 9, showsDirectionChevron: true };
    const needed = wideToolbarWidth(content);
    expect(needed).toBeGreaterThan(toolbarRowWidth(11));
    expect(usesWideToolbar(1024, needed, content)).toBe(true);
    expect(usesWideToolbar(1024, needed - 1, content)).toBe(false);
  });
});

describe.each(["en", "ar"] as const)("Reader toolbar at 320px (%s)", (locale) => {
  beforeEach(() => {
    mockLocale = locale;
  });

  it("orders the mode switch, Search, Hide, Recitation, Reading settings and More", () => {
    const s = strings[locale];
    render(toolbar(320));
    const labels = screen.getAllByRole("button").map((button) => button.props.accessibilityLabel);
    expect(labels).toEqual([
      expect.stringContaining(s.mushafViewVerse),
      s.readerSearch,
      s.readerHideAyahText,
      s.recitationToolbar,
      s.readingSettingsButton,
      s.readerMore,
    ]);
  });

  it("names the hide toggle for what it does next and leaves the phone row without a chevron", () => {
    const s = strings[locale];
    render(toolbar(320, { hideActive: true, isPageMode: true }));
    expect(screen.getByLabelText(s.readerShowAyahText)).toBeTruthy();
    expect(screen.queryByLabelText(s.pageLayoutGroup)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(6);
  });
});
