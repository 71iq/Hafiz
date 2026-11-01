import React from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, Modal, StyleSheet, View } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { LoaderCircle } from "lucide-react-native";
import { SyncIndicator } from "@/components/ui/SyncIndicator";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ themeSurface: "#fff", effectiveTheme: "white", isDark: false }),
}));
jest.mock("@/lib/ui/direction", () => ({ useUIDirection: (dir?: string) => dir ?? "ltr" }));
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
const descriptor = Object.getOwnPropertyDescriptor(AccessibilityInfo, "addEventListener");
let resolveQuery: (value: boolean) => void;
let changed: (value: boolean) => void;
let remove: jest.Mock;
let listen: jest.Mock;
beforeEach(() => {
  remove = jest.fn();
  listen = jest.fn((_event: string, handler: (value: boolean) => void) => {
    changed = handler;
    return { remove };
  });
  Object.defineProperty(AccessibilityInfo, "addEventListener", { configurable: true, value: listen });
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        resolveQuery = resolve;
      }),
  );
  jest.spyOn(Animated, "timing").mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  if (!descriptor) throw Error("Missing listener descriptor");
  Object.defineProperty(AccessibilityInfo, "addEventListener", descriptor);
});
async function preference(value: boolean) {
  await act(async () => {
    resolveQuery(value);
  });
}
function expectStatic(view: ReturnType<typeof render>, size: number, color: string) {
  expect(view.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  const glyph = view.UNSAFE_getByType(LoaderCircle);
  expect(glyph.props.size).toBe(size);
  expect(glyph.props.color).toBe(color);
  // A busy glyph inside an accessible button is grouped with that button.
  const progress = view.UNSAFE_getAllByType(View).find((node) => node.props.accessibilityRole === "progressbar");
  if (!progress) throw Error("Missing static busy role");
  expect(StyleSheet.flatten(progress.props.style)).toEqual({
    width: size,
    height: size,
    alignItems: "center",
    justifyContent: "center",
  });
}
function expectAnimated(view: ReturnType<typeof render>, size: number | "small", color: string) {
  expect(view.UNSAFE_queryAllByType(LoaderCircle)).toHaveLength(0);
  const spinner = view.UNSAFE_getByType(ActivityIndicator);
  expect(spinner.props.size).toBe(size);
  expect(spinner.props.color).toBe(color);
  expect(spinner.props.animating).not.toBe(false);
}
it.each([false, true])("sync unknown/reduced retains a visible static 8px busy glyph, dark=%s", async (dark) => {
  const view = render(<SyncIndicator status="syncing" isDark={dark} />);
  expectStatic(view, 8, dark ? "#2dd4bf" : "#0d9488");
  await preference(true);
  expectStatic(view, 8, dark ? "#2dd4bf" : "#0d9488");
});
it("sync allowed/live reduction/opt-in switches scheduling while retaining size/color", async () => {
  const view = render(<SyncIndicator status="syncing" />);
  await preference(false);
  expectAnimated(view, 8, "#0d9488");
  act(() => changed(true));
  expectStatic(view, 8, "#0d9488");
  act(() => changed(false));
  expectAnimated(view, 8, "#0d9488");
});
it("late initial query cannot restart motion after live reduction", async () => {
  const view = render(<SyncIndicator status="syncing" />);
  act(() => changed(true));
  await preference(false);
  expectStatic(view, 8, "#0d9488");
});
it.each(["idle", "synced", "offline", "error"] as const)("sync status %s retains original non-busy owner", (status) => {
  const view = render(<SyncIndicator status={status} />);
  expect(view.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  expect(view.UNSAFE_queryAllByType(LoaderCircle)).toHaveLength(0);
  expect(listen).not.toHaveBeenCalled();
  if (status === "idle") expect(view.toJSON()).toBeNull();
  else expect(view.toJSON()).not.toBeNull();
});
it("sync transitions release and reacquire the shared preference without stale state", async () => {
  const view = render(<SyncIndicator status="syncing" />);
  await preference(false);
  expectAnimated(view, 8, "#0d9488");
  view.rerender(<SyncIndicator status="synced" />);
  expect(remove).toHaveBeenCalledTimes(1);
  view.rerender(<SyncIndicator status="syncing" />);
  expectStatic(view, 8, "#0d9488");
  expect(listen).toHaveBeenCalledTimes(2);
});
function dialog(loading: boolean, onCancel = jest.fn(), onConfirm = jest.fn(), disabled = false) {
  return (
    <ConfirmDialog
      visible
      title="Delete"
      message="Confirm action"
      cancelLabel="Cancel"
      confirmLabel="Confirm"
      isDark={false}
      confirmLoading={loading}
      confirmDisabled={disabled}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
it("actual ConfirmDialog loading keeps unknown/reduced busy feedback static and visible", async () => {
  const view = render(dialog(true));
  expectStatic(view, 20, "#FFFFFF");
  await preference(true);
  expectStatic(view, 20, "#FFFFFF");
});
it("actual ConfirmDialog loading supports live cancellation and later opt-in", async () => {
  const view = render(dialog(true));
  await preference(false);
  expectAnimated(view, "small", "#FFFFFF");
  act(() => changed(true));
  expectStatic(view, 20, "#FFFFFF");
  act(() => changed(false));
  expectAnimated(view, "small", "#FFFFFF");
});
it("actual loading keeps cancel, confirm and platform dismissal blocked across preference changes", async () => {
  const cancel = jest.fn(),
    confirm = jest.fn();
  const view = render(dialog(true, cancel, confirm));
  await preference(false);
  act(() => changed(true));
  expect(view.getByRole("button", { name: "Cancel" }).props.accessibilityState.disabled).toBe(true);
  for (const button of view.getAllByRole("button")) fireEvent.press(button);
  fireEvent(view.UNSAFE_getByType(Modal), "requestClose");
  expect(cancel).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  view.rerender(dialog(false, cancel, confirm));
  fireEvent.press(view.getByRole("button", { name: "Cancel" }));
  fireEvent.press(view.getByRole("button", { name: "Confirm" }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(view.UNSAFE_queryAllByType(LoaderCircle)).toHaveLength(0);
});
it("confirmDisabled still blocks confirmation outside loading", () => {
  const confirm = jest.fn();
  const view = render(dialog(false, jest.fn(), confirm, true));
  fireEvent.press(view.getByRole("button", { name: "Confirm" }));
  expect(confirm).not.toHaveBeenCalled();
});
it("both real owners share one listener and release it after the last unmount", async () => {
  const sync = render(<SyncIndicator status="syncing" />),
    confirm = render(dialog(true));
  await preference(false);
  expect(listen).toHaveBeenCalledTimes(1);
  sync.unmount();
  expect(remove).not.toHaveBeenCalled();
  confirm.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
