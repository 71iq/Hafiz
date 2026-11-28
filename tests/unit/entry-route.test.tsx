import React from "react";
import { renderHook } from "@testing-library/react-native";
import { NavigationRouteContext } from "@react-navigation/native";
import { router } from "expo-router";
import type { AppDatabase } from "@/lib/database/types";
import {
  openEntryRoute,
  rootStackOf,
  opensFocusedScreen,
  resetEntryRouteForTests,
  useSessionLeaveState,
  type SessionLeaveState,
} from "@/lib/navigation/entry-route";
import { resolveReminderHref } from "@/lib/notifications/reminder-route";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), replace: jest.fn() },
}));
jest.mock("@/lib/notifications/reminder-route", () => ({ resolveReminderHref: jest.fn() }));

/** Widget and notification taps (SPEC 3.9): one set of rules for where a tap may lead. */
const db = {} as AppDatabase;
const DAILY = { pathname: "/flashcards/session", params: { scope: "daily" } } as const;
const tabs = { key: "tabs-1", name: "(tabs)" };
const daily = { key: "session-1", name: "flashcards/session", params: { scope: "daily" } };
const review = { key: "review-1", name: "hifz/review", params: {} };
const stack = (...routes: { key: string; name: string; params?: object }[]) => ({
  key: "root",
  index: routes.length - 1,
  routes,
});
/** The navigation container as Expo Router builds it: the app's root Stack inside its "__root" route. */
const container = (state: ReturnType<typeof stack>) => () => ({
  index: 0,
  routes: [{ key: "expo-root", name: "__root", state }],
});

/** Mounts a session screen's state publisher under a route key, as a navigator would. */
function publish(route: { key: string; name: string }, state: SessionLeaveState) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NavigationRouteContext.Provider value={route as never}>{children}</NavigationRouteContext.Provider>
  );
  return renderHook(({ value }: { value: SessionLeaveState }) => useSessionLeaveState(value), {
    wrapper,
    initialProps: { value: state },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetEntryRouteForTests();
  jest.mocked(resolveReminderHref).mockResolvedValue(DAILY);
});

it("opens the step from the tabs, and navigates rather than pushes for Home", async () => {
  await openEntryRoute(db, "wird", { pathname: "/home", getRootState: container(stack(tabs)) });
  expect(router.push).toHaveBeenCalledWith(DAILY);
  jest.mocked(resolveReminderHref).mockResolvedValue("/(tabs)/home");
  await openEntryRoute(db, "home", { pathname: "/progress", getRootState: container(stack(tabs)) });
  expect(router.navigate).toHaveBeenCalledWith("/(tabs)/home");
  expect(router.push).toHaveBeenCalledTimes(1);
});

it.each(["/onboarding", "/hifz/setup"])("never interrupts %s", async (pathname) => {
  const screen = { key: "x", name: pathname.slice(1) };
  await openEntryRoute(db, "wird", { pathname, getRootState: container(stack(tabs, screen)) });
  expect(resolveReminderHref).not.toHaveBeenCalled();
});

it("keeps a session whose work would be lost, and opens nothing", async () => {
  publish(daily, "working");
  await openEntryRoute(db, "wird", { pathname: "/flashcards/session", getRootState: container(stack(tabs, daily)) });
  expect(resolveReminderHref).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

it("leaves a session with nothing done for another step, but stays when the step is that session", async () => {
  publish(daily, "fresh");
  await openEntryRoute(db, "wird", { pathname: "/flashcards/session", getRootState: container(stack(tabs, daily)) });
  expect(router.dismissTo).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();

  jest.mocked(resolveReminderHref).mockResolvedValue("/hifz/review");
  await openEntryRoute(db, "wird", { pathname: "/flashcards/session", getRootState: container(stack(tabs, daily)) });
  expect(router.dismissTo).toHaveBeenCalledWith("/(tabs)/home");
  expect(router.push).toHaveBeenCalledWith("/hifz/review");
});

it("replaces a finished session's summary with the next step, even the same kind of session", async () => {
  publish(daily, "ended");
  await openEntryRoute(db, "wird", { pathname: "/flashcards/session", getRootState: container(stack(tabs, daily)) });
  expect(router.dismissTo).toHaveBeenCalledWith("/(tabs)/home");
  expect(router.push).toHaveBeenCalledWith(DAILY);
});

it("leaves any other pushed screen first, and only returns to the tabs for Home", async () => {
  const profile = { key: "profile-1", name: "profile/[id]" };
  await openEntryRoute(db, "wird", { pathname: "/profile/1", getRootState: container(stack(tabs, profile)) });
  expect(router.dismissTo).toHaveBeenCalledWith("/(tabs)/home");
  expect(router.push).toHaveBeenCalledWith(DAILY);

  jest.clearAllMocks();
  jest.mocked(resolveReminderHref).mockResolvedValue("/(tabs)/home");
  await openEntryRoute(db, "home", { pathname: "/profile/1", getRootState: container(stack(tabs, profile)) });
  expect(router.dismissTo).toHaveBeenCalledWith("/(tabs)/home");
  expect(router.push).not.toHaveBeenCalled();
});

it("ignores a second tap while the first is still resolving", async () => {
  let finish: (href: typeof DAILY) => void = () => {};
  jest.mocked(resolveReminderHref).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  const first = openEntryRoute(db, "wird", { pathname: "/home", getRootState: container(stack(tabs)) });
  await openEntryRoute(db, "wird", { pathname: "/home", getRootState: container(stack(tabs)) });
  finish(DAILY);
  await first;
  expect(resolveReminderHref).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledTimes(1);
});

it("forgets a session's state once its screen unmounts", async () => {
  const screen = publish(review, "working");
  screen.unmount();
  jest.mocked(resolveReminderHref).mockResolvedValue("/hifz/review");
  await openEntryRoute(db, "wird", { pathname: "/hifz/review", getRootState: container(stack(tabs, review)) });
  expect(router.push).toHaveBeenCalledWith("/hifz/review");
});

it("checks the screen again after resolving, so a session that started work meanwhile is kept", async () => {
  const screen = publish(daily, "fresh");
  let finish: (href: string) => void = () => {};
  jest.mocked(resolveReminderHref).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  const tap = openEntryRoute(db, "wird", {
    pathname: "/flashcards/session",
    getRootState: container(stack(tabs, daily)),
  });
  screen.rerender({ value: "working" });
  finish("/hifz/review");
  await tap;
  expect(router.dismissTo).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

describe("rootStackOf", () => {
  it("finds the app's Stack inside Expo Router's container, and takes a plain Stack as it is", () => {
    const appStack = stack(tabs, daily);
    expect(rootStackOf(container(appStack)())).toBe(appStack);
    expect(rootStackOf(appStack)).toBe(appStack);
    expect(rootStackOf(undefined)).toBeUndefined();
  });
});

describe("opensFocusedScreen", () => {
  it("matches the daily session by scope, a single deck by its id, and the page review by mode", () => {
    expect(opensFocusedScreen(DAILY, daily)).toBe(true);
    expect(opensFocusedScreen(DAILY, { key: "s", name: "flashcards/session", params: {} })).toBe(true);
    expect(opensFocusedScreen(DAILY, { key: "s", name: "flashcards/session", params: { deckId: "meanings" } })).toBe(
      false,
    );
    expect(opensFocusedScreen("/hifz/review", review)).toBe(true);
    expect(opensFocusedScreen({ pathname: "/hifz/review", params: { mode: "welcome_back" } }, review)).toBe(false);
    expect(opensFocusedScreen("/hifz/memorize", review)).toBe(false);
  });
});
