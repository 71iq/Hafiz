import React from "react";
import { Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { strings } from "@/lib/i18n/strings";

jest.mock("@/lib/i18n/useStrings", () => ({
  ...jest.requireActual("@/lib/i18n/useStrings"),
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings.ar,
}));
jest.mock("@/lib/settings/context", () => ({
  ...jest.requireActual("@/lib/settings/context"),
  useSettings: () => ({ isDark: true, themeColors: { surfaceHigh: "#262626" } }),
}));

let shouldThrow = true;
function Section() {
  if (shouldThrow) throw new Error("section failed");
  return <Text>Section content</Text>;
}

describe("ErrorBoundary fallback", () => {
  beforeEach(() => {
    shouldThrow = true;
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("shows the fallback in the app language and recovers on Try again", () => {
    render(
      <ErrorBoundary section="Test">
        <Section />
      </ErrorBoundary>,
    );

    expect(screen.getByText(strings.ar.errorTitle)).toBeTruthy();
    expect(screen.getByText(strings.ar.errorSubtitle)).toBeTruthy();

    shouldThrow = false;
    fireEvent.press(screen.getByText(strings.ar.errorTryAgain));
    expect(screen.getByText("Section content")).toBeTruthy();
  });
});
