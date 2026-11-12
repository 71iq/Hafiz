import React from "react";
import { Text } from "react-native";
import { act, render } from "@testing-library/react-native";
import { ChromeProvider, useChrome, useChromeActions } from "@/lib/ui/chrome";

describe("chrome context subscriptions", () => {
  it("does not re-render action-only consumers when the bar shows or hides", () => {
    let tokenRenders = 0;
    let setVisible: ((value: boolean) => void) | null = null;
    function Token() {
      tokenRenders += 1;
      useChromeActions();
      return <Text>word</Text>;
    }
    const MemoToken = React.memo(Token);
    function Bar() {
      const chrome = useChrome();
      setVisible = chrome.setVisible;
      return <Text>{chrome.visible ? "shown" : "hidden"}</Text>;
    }

    const view = render(
      <ChromeProvider>
        <Bar />
        <MemoToken />
      </ChromeProvider>,
    );
    expect(tokenRenders).toBe(1);

    act(() => setVisible?.(false));
    act(() => setVisible?.(true));

    expect(view.getByText("shown")).toBeTruthy();
    // Every page holds hundreds of word tokens; scroll-direction changes must not re-render them.
    expect(tokenRenders).toBe(1);
  });

  it("keeps markActivity from revealing the bar in immersive mode", () => {
    let chrome: ReturnType<typeof useChrome> | null = null;
    function Probe() {
      chrome = useChrome();
      return null;
    }
    render(
      <ChromeProvider>
        <Probe />
      </ChromeProvider>,
    );
    act(() => {
      chrome!.setImmersive(true);
      chrome!.setVisible(false);
    });
    act(() => chrome!.markActivity());
    expect(chrome!.visible).toBe(false);
    act(() => chrome!.setImmersive(false));
    act(() => chrome!.markActivity());
    expect(chrome!.visible).toBe(true);
  });
});
