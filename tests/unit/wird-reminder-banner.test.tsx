import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { WirdReminderBanner } from "@/components/notifications/WirdReminderBanner";
import { strings } from "@/lib/i18n/strings";
import { dismissReminderBanner, loadReminderBanner, type ReminderBanner } from "@/lib/notifications/banner";
import { resolveReminderHref } from "@/lib/notifications/reminder-route";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => ({ name: "isolated-banner-fixture" }) }));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => ({ isDark: false, uiLanguage: "en" }) }));
jest.mock("@/lib/i18n/useStrings", () => ({
  ...jest.requireActual<typeof import("@/lib/i18n/useStrings")>("@/lib/i18n/useStrings"),
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings.en,
}));
jest.mock("@/lib/fsrs/review-events", () => ({ subscribeReviewActivity: () => () => {} }));
jest.mock("@/lib/notifications/banner", () => ({
  loadReminderBanner: jest.fn(),
  dismissReminderBanner: jest.fn(async () => undefined),
  answerRamadanOffer: jest.fn(),
}));
jest.mock("@/lib/notifications/reminder-route", () => ({ resolveReminderHref: jest.fn() }));

/** The in-app wird reminder (REMIND-06) opens the resolver's step, and stays when there is none (SPEC 3.3). */
const s = strings.en;
const wirdBanner: Extract<ReminderBanner, { kind: "reminder" }> = {
  kind: "reminder",
  type: "wird_reminder",
  localDate: "2026-11-25",
  title: "Time for your wird",
  body: "Your review is ready.",
  route: "wird",
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadReminderBanner).mockResolvedValue(wirdBanner);
});

async function renderBanner(props: React.ComponentProps<typeof WirdReminderBanner> = {}) {
  const view = render(<WirdReminderBanner {...props} />);
  await waitFor(() => expect(view.getByText(wirdBanner.title)).toBeTruthy());
  return view;
}

it("opens the resolved step once and only then dismisses the banner", async () => {
  jest.mocked(resolveReminderHref).mockResolvedValue("/hifz/review");
  const view = await renderBanner();
  await act(async () => {
    fireEvent.press(view.getByText(s.notifBannerStart));
    fireEvent.press(view.getByText(s.notifBannerStart));
  });
  expect(resolveReminderHref).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith("/hifz/review");
  expect(dismissReminderBanner).toHaveBeenCalledTimes(1);
});

it("stays, undismissed, when the resolver has nothing to open", async () => {
  jest.mocked(resolveReminderHref).mockResolvedValue("/(tabs)/home");
  const view = await renderBanner();
  await act(async () => {
    fireEvent.press(view.getByText(s.notifBannerStart));
  });
  expect(dismissReminderBanner).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
  expect(view.getByText(wirdBanner.title)).toBeTruthy();
});

it("shows no Start for a wird reminder when Home already knows there is no step", async () => {
  const view = await renderBanner({ wirdStartable: false });
  expect(view.queryByText(s.notifBannerStart)).toBeNull();
});
