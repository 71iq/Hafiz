import React from "react";
import { fireEvent, render, within } from "@testing-library/react-native";
import { Check, MoveHorizontal, MoveVertical } from "lucide-react-native";
import { PageViewNavigationSheet } from "@/components/mushaf/PageViewNavigationSheet";
import { strings } from "@/lib/i18n/strings";

const mockSetPageScroll = jest.fn();
let mockLocale: "en" | "ar" = "en";
let mockPageScroll: "vertical" | "horizontal" = "vertical";

jest.mock("@/lib/i18n/useStrings", () => ({
  useStrings: () => jest.requireActual("@/lib/i18n/strings").strings[mockLocale],
}));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    isDark: false,
    isRTL: mockLocale === "ar",
    pageScroll: mockPageScroll,
    setPageScroll: mockSetPageScroll,
    themeColors: { surface: "#fff", surfaceLow: "#f5f5f5" },
  }),
}));

beforeEach(() => {
  mockSetPageScroll.mockReset();
  mockPageScroll = "vertical";
});

describe.each(["en", "ar"] as const)("page view navigation menu (%s)", (locale) => {
  beforeEach(() => {
    mockLocale = locale;
  });

  it("pairs each scroll mode with its movement icon and marks the current one", () => {
    const view = render(<PageViewNavigationSheet visible anchor={null} onClose={jest.fn()} />);
    const vertical = view.getByRole("menuitem", { name: strings[locale].pageScrollVertical });
    const horizontal = view.getByRole("menuitem", { name: strings[locale].pageScrollHorizontal });

    expect(within(vertical).UNSAFE_getAllByType(MoveVertical)).toHaveLength(1);
    expect(within(vertical).UNSAFE_queryAllByType(MoveHorizontal)).toHaveLength(0);
    expect(within(horizontal).UNSAFE_getAllByType(MoveHorizontal)).toHaveLength(1);
    expect(vertical.props.accessibilityState).toMatchObject({ selected: true });
    expect(within(vertical).UNSAFE_getAllByType(Check)).toHaveLength(1);
    expect(horizontal.props.accessibilityState).toMatchObject({ selected: false });
    expect(within(horizontal).UNSAFE_queryAllByType(Check)).toHaveLength(0);
  });

  it("saves the chosen mode and closes", () => {
    const close = jest.fn();
    const view = render(<PageViewNavigationSheet visible anchor={null} onClose={close} />);

    fireEvent.press(view.getByRole("menuitem", { name: strings[locale].pageScrollHorizontal }));

    expect(mockSetPageScroll).toHaveBeenCalledWith("horizontal");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
