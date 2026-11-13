import React from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { PrayerTimesSetup } from "@/components/notifications/PrayerTimesSetup";
import { requestDeviceCoordinates } from "@/lib/prayer/location";
import { strings } from "@/lib/i18n/strings";
import { DirectionProvider } from "@/lib/ui/direction";
import { findAncestorByClassName } from "../rtl/rtl-test-utils";

jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return {
    ...actual,
    useSettings: () => ({
      isDark: false,
      isRTL: false,
      uiLanguage: "en",
      themeColors: { surfaceHigh: "#eeeeee", surfaceMid: "#f4f4f4" },
    }),
  };
});
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => ({ name: "isolated-prayer-fixture" }) }));
jest.mock("@/lib/prayer/settings", () => ({
  readPrayerLocation: jest.fn(async () => null),
  writePrayerLocation: jest.fn(async () => {}),
}));
jest.mock("@/lib/notifications/schedule", () => ({ rescheduleReminders: jest.fn(async () => {}) }));
jest.mock("@/lib/habit/use-habit-overview", () => ({ emitHabitChanged: jest.fn() }));
jest.mock("@/lib/prayer/location", () => {
  const actual = jest.requireActual<typeof import("@/lib/prayer/location")>("@/lib/prayer/location");
  return { ...actual, requestDeviceCoordinates: jest.fn() };
});

const s = strings.en;

function renderSetup() {
  return render(
    <DirectionProvider dir="ltr">
      <PrayerTimesSetup />
    </DirectionProvider>,
  );
}

describe("PrayerTimesSetup messages", () => {
  it("shows a location failure under Use my location, and invalid coordinates under Save coordinates", async () => {
    jest.mocked(requestDeviceCoordinates).mockResolvedValue({ kind: "denied", canAskAgain: false });
    const view = renderSetup();

    fireEvent.press(view.getByText(s.notifUseMyLocation));
    const denied = await view.findByText(s.notifLocationDenied);

    // The fields open with the message, but the message stays beside the button that caused it.
    expect(view.getByText(s.notifSaveCoordinates)).toBeTruthy();
    const locationGroup = findAncestorByClassName(denied, "gap-2");
    expect(within(locationGroup as never).getByText(s.notifUseMyLocation)).toBeTruthy();
    expect(within(locationGroup as never).queryByText(s.notifSaveCoordinates)).toBeNull();
    expect(denied.props.className).toContain("text-warm-700");
    expect(denied.props.className).not.toContain("text-red");

    fireEvent.changeText(view.getByLabelText(s.notifLatitude), "200");
    fireEvent.changeText(view.getByLabelText(s.notifLongitude), "39");
    fireEvent.press(view.getByText(s.notifSaveCoordinates));

    const invalid = await view.findByText(s.notifCoordinatesInvalid);
    await waitFor(() => expect(view.queryByText(s.notifLocationDenied)).toBeNull());
    const coordinatesGroup = findAncestorByClassName(invalid, "gap-2");
    expect(within(coordinatesGroup as never).getByText(s.notifSaveCoordinates)).toBeTruthy();
    expect(within(coordinatesGroup as never).queryByText(s.notifUseMyLocation)).toBeNull();
    expect(invalid.props.className).toContain("text-red-600");
  });
});
