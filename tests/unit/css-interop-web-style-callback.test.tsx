/**
 * @jest-environment jsdom
 */
import type React from "react";

// The web runtime of react-native-css-interop, as Expo web bundles it (it reads the browser
// document at load, hence the jsdom environment).
type Interop = { render: (props: Record<string, unknown>, ref: unknown) => unknown };
const { cssInterop } = require("react-native-css-interop/dist/runtime/web/api") as {
  cssInterop: (component: React.ComponentType<any>, mapping: Record<string, unknown>) => Interop;
};

const received: { style?: unknown }[] = [];
function Probe(props: { style?: unknown }) {
  received.push(props);
  return null;
}
const WebPressableLike = cssInterop(Probe, { className: "style" });
const renderWith = (props: Record<string, unknown>) => {
  received.length = 0;
  WebPressableLike.render(props, null);
  return received[0];
};

describe("RF-199 web style callbacks with className", () => {
  // React Native Web turns $$css entries into class names and the rest into inline styles, so the
  // callback's styles win over the classes as inline styles always do; the order matches objects.
  it("keeps a style callback and resolves it with the className styles", () => {
    const callback = ({ pressed }: { pressed: boolean }) => ({
      direction: "ltr",
      backgroundColor: pressed ? "red" : "blue",
    });
    const { style } = renderWith({ className: "w-full flex-row-reverse", style: callback });

    expect(typeof style).toBe("function");
    expect((style as (state: { pressed: boolean }) => unknown)({ pressed: true })).toEqual([
      { direction: "ltr", backgroundColor: "red" },
      { $$css: true, "w-full flex-row-reverse": "w-full flex-row-reverse" },
    ]);
  });

  it("keeps object styles merged as before", () => {
    expect(renderWith({ className: "p-2", style: { opacity: 0.5 } }).style).toEqual([
      { opacity: 0.5 },
      { $$css: true, "p-2": "p-2" },
    ]);
  });

  it("leaves a callback alone when there is no className", () => {
    const callback = () => ({ opacity: 1 });
    expect(renderWith({ style: callback }).style).toBe(callback);
  });
});
