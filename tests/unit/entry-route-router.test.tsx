import React from "react";
import { Text } from "react-native";
import { Stack, Tabs, router } from "expo-router";
import { act, renderRouter, screen } from "expo-router/testing-library";
import { resetEntryRouteForTests, useSessionLeaveState, type SessionLeaveState } from "@/lib/navigation/entry-route";
import { resolveReminderHref } from "@/lib/notifications/reminder-route";
import { redirectWidgetTapPath, resetWidgetTapsForTests, useWidgetTaps } from "@/lib/widget/tap";

jest.mock("@/lib/database/provider", () => ({
  useDatabaseStatus: () => ({ db: { name: "router-fixture" }, isReady: true }),
}));
jest.mock("@/lib/notifications/reminder-route", () => ({ resolveReminderHref: jest.fn() }));
jest.mock("@/lib/widget/platform", () => ({ widgetPlatform: { supported: false } }));

/**
 * Widget taps against the real router (SPEC 3.9): the tap listener sits in the root layout beside the
 * Stack, as in app/_layout.tsx, so it sees Expo Router's own container around the app's Stack.
 */
const DAILY = { pathname: "/flashcards/session", params: { scope: "daily" } } as const;
let mockSessionState: SessionLeaveState = "fresh";

function SessionScreen() {
  useSessionLeaveState(mockSessionState);
  return <Text>Session screen</Text>;
}

function TapListener() {
  useWidgetTaps();
  return null;
}

type RouteState = { name: string; state?: RouteState; routes?: RouteState[] };

/** Routes of the app's root Stack, inside Expo Router's "__root" container. */
function rootRouteNames(app: ReturnType<typeof renderRouter>) {
  const container = app.getRouterState() as unknown as RouteState;
  return (container.routes?.[0]?.state?.routes ?? []).map((route) => route.name);
}

function renderApp() {
  return renderRouter(
    {
      _layout: () => (
        <>
          <Stack screenOptions={{ headerShown: false }} />
          <TapListener />
        </>
      ),
      "(tabs)/_layout": () => <Tabs />,
      "(tabs)/home": () => <Text>Home screen</Text>,
      "flashcards/session": SessionScreen,
      "hifz/review": () => <Text>Review screen</Text>,
      profile: () => <Text>Profile screen</Text>,
    },
    { initialUrl: "/home" },
  );
}

async function openSession(state: SessionLeaveState) {
  mockSessionState = state;
  act(() => router.push(DAILY));
  await act(async () => {});
}

async function tapWidget() {
  await act(async () => {
    redirectWidgetTapPath("hafiz://widget?to=wird", false);
  });
  await act(async () => {});
}

beforeEach(() => {
  jest.clearAllMocks();
  resetEntryRouteForTests();
  resetWidgetTapsForTests();
  jest.mocked(resolveReminderHref).mockResolvedValue("/hifz/review");
});

it("keeps a session whose work would be lost, without resolving or stacking anything", async () => {
  const app = renderApp();
  await openSession("working");
  await tapWidget();
  expect(resolveReminderHref).not.toHaveBeenCalled();
  expect(rootRouteNames(app)).toEqual(["(tabs)", "flashcards/session"]);
  expect(screen.getByText("Session screen")).toBeTruthy();
});

it("leaves a session with nothing done alone when the step is that session", async () => {
  jest.mocked(resolveReminderHref).mockResolvedValue(DAILY);
  const app = renderApp();
  await openSession("fresh");
  await tapWidget();
  expect(resolveReminderHref).toHaveBeenCalledTimes(1);
  expect(rootRouteNames(app)).toEqual(["(tabs)", "flashcards/session"]);
});

it("replaces a finished session with the next step, returning to the one tab tree first", async () => {
  const app = renderApp();
  await openSession("ended");
  await tapWidget();
  expect(rootRouteNames(app)).toEqual(["(tabs)", "hifz/review"]);
  expect(screen.getByText("Review screen")).toBeTruthy();
});

it("leaves another pushed screen for the step without a second tab tree", async () => {
  const app = renderApp();
  act(() => router.push("/profile"));
  await act(async () => {});
  await tapWidget();
  expect(rootRouteNames(app)).toEqual(["(tabs)", "hifz/review"]);
});

it("opens the step over the tabs, and stays on Home when nothing is left", async () => {
  const app = renderApp();
  await tapWidget();
  expect(rootRouteNames(app)).toEqual(["(tabs)", "hifz/review"]);

  act(() => router.back());
  await act(async () => {});
  jest.mocked(resolveReminderHref).mockResolvedValue("/(tabs)/home");
  await tapWidget();
  expect(rootRouteNames(app)).toEqual(["(tabs)"]);
  expect(screen.getByText("Home screen")).toBeTruthy();
});
