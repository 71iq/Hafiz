import React from "react";
import { Pressable, Text } from "react-native";
import { Stack, Tabs, router } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import OpenDeepLink from "@/app/open";
import { consumePendingDeepLink } from "@/lib/deep-link";
import { useOpenMushaf } from "@/lib/navigation/open-mushaf";

function OpenAyahButton({ label }: { label: string }) {
  const openMushaf = useOpenMushaf();
  return (
    <Pressable onPress={() => openMushaf({ surah: 2, ayah: 255 })}>
      <Text>{label}</Text>
    </Pressable>
  );
}

type RouteState = { name: string; state?: RouteState; routes?: RouteState[] };

// Routes of the app's root Stack (inside expo-router's own __root container).
function rootRouteNames(app: ReturnType<typeof renderRouter>) {
  const container = app.getRouterState() as unknown as RouteState;
  const stack = container.routes?.[0]?.state;
  return (stack?.routes ?? []).map((route) => route.name);
}

function renderApp(initialUrl: string) {
  return renderRouter(
    {
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      "(tabs)/_layout": () => <Tabs />,
      "(tabs)/home": () => <OpenAyahButton label="Open from home" />,
      "(tabs)/mushaf": () => <Text>Mushaf screen</Text>,
      open: OpenDeepLink,
      profile: () => <OpenAyahButton label="Open from profile" />,
      "flashcards/session": () => <Text>Session screen</Text>,
    },
    { initialUrl },
  );
}

describe("RF-196 warm deep links", () => {
  it("return to the existing tabs instead of stacking another copy for each link", async () => {
    const app = renderApp("/home");
    expect(rootRouteNames(app)).toEqual(["(tabs)"]);

    for (const [surah, ayah] of [
      [2, 255],
      [18, 10],
      [36, 1],
    ]) {
      act(() => router.push(`/open?surah=${surah}&ayah=${ayah}`));
      await act(async () => {});
      expect(screen.getByText("Mushaf screen")).toBeTruthy();
      expect(rootRouteNames(app)).toEqual(["(tabs)"]);
      expect(consumePendingDeepLink()).toEqual({ surah, ayah });
    }
  });

  it("returns to the reader when it is already focused", async () => {
    const app = renderApp("/mushaf");

    act(() => router.push("/open?surah=18&ayah=10"));
    await act(async () => {});

    expect(screen.getByText("Mushaf screen")).toBeTruthy();
    expect(rootRouteNames(app)).toEqual(["(tabs)"]);
    expect(consumePendingDeepLink()).toEqual({ surah: 18, ayah: 10 });
  });

  it("keeps a screen opened over the tabs, such as a review session, underneath", async () => {
    const app = renderApp("/home");
    act(() => router.push("/flashcards/session"));
    await act(async () => {});

    act(() => router.push("/open?surah=2&ayah=255"));
    await act(async () => {});

    expect(screen.getByText("Mushaf screen")).toBeTruthy();
    expect(rootRouteNames(app)).toEqual(["(tabs)", "flashcards/session", "(tabs)"]);
    expect(consumePendingDeepLink()).toEqual({ surah: 2, ayah: 255 });
  });

  it("opens the reader when the link is the first screen", async () => {
    const app = renderApp("/open?surah=2&ayah=255");
    await act(async () => {});

    expect(screen.getByText("Mushaf screen")).toBeTruthy();
    expect(rootRouteNames(app)).toEqual(["(tabs)"]);
    expect(consumePendingDeepLink()).toEqual({ surah: 2, ayah: 255 });
  });
});

describe("opening the reader from inside the app", () => {
  it("dismisses a screen above the tabs, such as the profile sheet, instead of opening the reader behind it", async () => {
    const app = renderApp("/home");
    act(() => router.push("/profile"));
    await act(async () => {});
    expect(rootRouteNames(app)).toEqual(["(tabs)", "profile"]);

    fireEvent.press(screen.getByText("Open from profile"));
    await act(async () => {});

    expect(screen.getByText("Mushaf screen")).toBeTruthy();
    expect(rootRouteNames(app)).toEqual(["(tabs)"]);
    expect(consumePendingDeepLink()).toEqual({ surah: 2, ayah: 255 });
  });

  it("switches tab from a tab screen without stacking another tab tree", async () => {
    const app = renderApp("/home");

    fireEvent.press(screen.getByText("Open from home"));
    await act(async () => {});

    expect(screen.getByText("Mushaf screen")).toBeTruthy();
    expect(rootRouteNames(app)).toEqual(["(tabs)"]);
    expect(consumePendingDeepLink()).toEqual({ surah: 2, ayah: 255 });
  });
});
