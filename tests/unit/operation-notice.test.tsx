import React, { useEffect } from "react";
import { act, cleanupAsync, render } from "@testing-library/react-native";
import {
  OperationNoticeOverlay,
  OperationNoticeProvider,
  useOperationNotice,
  useInlineOperationNotice,
  type InlineNoticeAttempt,
} from "@/components/ui/OperationNoticeProvider";
import { Toast } from "@/components/ui/Toast";

jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => true }));
let createInlineAttempt: () => InlineNoticeAttempt;
let showNotice: (message: string) => void;
function Probe() {
  const report = useOperationNotice();
  const createAttempt = useInlineOperationNotice();
  useEffect(() => {
    showNotice = report;
    createInlineAttempt = createAttempt;
  }, [report, createAttempt]);
  return null;
}
function tree(ready = true, firstOpen = false, secondOpen = false) {
  return (
    <OperationNoticeProvider ready={ready}>
      <Probe />
      <OperationNoticeOverlay overlayId="first" open={firstOpen} />
      <OperationNoticeOverlay overlayId="second" open={secondOpen} />
    </OperationNoticeProvider>
  );
}
beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  await cleanupAsync();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it("shows a normal notice for the existing full duration", () => {
  const view = render(tree());
  act(() => showNotice("Synthetic failure"));
  expect(view.getByText("Synthetic failure")).toBeTruthy();
  expect(view.getByRole("alert").props.accessibilityLiveRegion).toBe("polite");
  act(() => jest.advanceTimersByTime(1999));
  expect(view.getByText("Synthetic failure")).toBeTruthy();
  act(() => jest.advanceTimersByTime(201));
  expect(view.queryByText("Synthetic failure")).toBeNull();
});

it("holds an unavailable notice and starts its full duration after recovery", () => {
  const view = render(tree(false));
  const stableReporter = showNotice;
  act(() => showNotice("تعذر تحميل مصدر التفسير"));
  act(() => jest.advanceTimersByTime(5000));
  expect(view.queryByText("تعذر تحميل مصدر التفسير")).toBeNull();
  view.rerender(tree(true));
  expect(showNotice).toBe(stableReporter);
  expect(view.getByText("تعذر تحميل مصدر التفسير")).toBeTruthy();
  act(() => jest.advanceTimersByTime(1999));
  expect(view.getByText("تعذر تحميل مصدر التفسير")).toBeTruthy();
  act(() => jest.advanceTimersByTime(201));
  expect(view.queryByText("تعذر تحميل مصدر التفسير")).toBeNull();
});

it("preserves a notice when readiness disappears after reporting", () => {
  const view = render(tree());
  act(() => showNotice("Synthetic retirement failure"));
  act(() => jest.advanceTimersByTime(1000));
  view.rerender(tree(false));
  act(() => jest.advanceTimersByTime(5000));
  expect(view.queryByText("Synthetic retirement failure")).toBeNull();
  view.rerender(tree());
  expect(view.getByText("Synthetic retirement failure")).toBeTruthy();
  act(() => jest.advanceTimersByTime(1999));
  expect(view.getByText("Synthetic retirement failure")).toBeTruthy();
  act(() => jest.advanceTimersByTime(201));
  expect(view.queryByText("Synthetic retirement failure")).toBeNull();
});

it("gives an identical later failure a fresh duration and rejects a stale dismissal", () => {
  const view = render(tree());
  act(() => showNotice("Repeated failure"));
  const oldDismiss: unknown = view.UNSAFE_getByType(Toast).props.onDismiss;
  if (typeof oldDismiss !== "function") throw new Error("Missing first dismissal");
  act(() => jest.advanceTimersByTime(1500));
  act(() => showNotice("Repeated failure"));
  act(() => oldDismiss());
  act(() => jest.advanceTimersByTime(1999));
  expect(view.getByText("Repeated failure")).toBeTruthy();
  act(() => jest.advanceTimersByTime(201));
  expect(view.queryByText("Repeated failure")).toBeNull();
});

it("uses only the newest open modal window, then the previous window and root", () => {
  const view = render(tree(true, true, false));
  act(() => showNotice("Nested overlay failure"));
  let slots = view.UNSAFE_getAllByType(OperationNoticeOverlay);
  expect(slots[0].findAllByType(Toast)).toHaveLength(1);
  expect(slots[1].findAllByType(Toast)).toHaveLength(0);
  expect(view.UNSAFE_getAllByType(Toast)).toHaveLength(1);
  view.rerender(tree(true, true, true));
  slots = view.UNSAFE_getAllByType(OperationNoticeOverlay);
  expect(slots[0].findAllByType(Toast)).toHaveLength(0);
  expect(slots[1].findAllByType(Toast)).toHaveLength(1);
  expect(view.UNSAFE_getAllByType(Toast)).toHaveLength(1);
  view.rerender(tree(true, true, false));
  slots = view.UNSAFE_getAllByType(OperationNoticeOverlay);
  expect(slots[0].findAllByType(Toast)).toHaveLength(1);
  view.rerender(tree());
  expect(view.UNSAFE_getAllByType(Toast)).toHaveLength(1);
  expect(view.UNSAFE_getAllByType(OperationNoticeOverlay).every((slot) => slot.findAllByType(Toast).length === 0)).toBe(
    true,
  );
});

it("leaves independently rendered overlays usable without the root notice owner", () => {
  const view = render(<OperationNoticeOverlay overlayId="standalone" open />);
  expect(view.toJSON()).toBeNull();
});

it("cancels active notice timers when the owner unmounts", () => {
  const view = render(tree());
  const schedule = jest.spyOn(globalThis, "setTimeout");
  const cancel = jest.spyOn(globalThis, "clearTimeout");
  act(() => showNotice("Unmounted owner"));
  const index = schedule.mock.calls.findIndex((call) => call[1] === 2000);
  if (index < 0) throw new Error("Missing notice display timer");
  const timer = schedule.mock.results[index];
  if (timer.type !== "return") throw new Error("Notice timer was not scheduled");
  view.unmount();
  expect(cancel).toHaveBeenCalledWith(timer.value);
  act(() => jest.advanceTimersByTime(5000));
  schedule.mockRestore();
  cancel.mockRestore();
});

it("retains ordinary inline text privately and discards normal retirement", () => {
  const view = render(tree());
  const attempt = createInlineAttempt();
  expect(attempt.isCurrent()).toBe(true);
  expect(attempt.report("Inline only")).toBe("inline");
  expect(view.queryByText("Inline only")).toBeNull();
  act(() => attempt.retire("normal"));
  expect(attempt.isCurrent()).toBe(false);
  expect(attempt.report("Obsolete")).toBe("discarded");
  expect(view.queryByText("Obsolete")).toBeNull();
});

it("holds a report between committed readiness loss and automatic retirement", () => {
  const view = render(tree());
  const attempt = createInlineAttempt();
  view.rerender(tree(false));
  expect(attempt.isCurrent()).toBe(false);
  act(() => expect(attempt.report("Recovery gap")).toBe("retained"));
  expect(view.queryByText("Recovery gap")).toBeNull();
  act(() => attempt.retire());
  act(() => jest.advanceTimersByTime(5000));
  view.rerender(tree());
  expect(view.getByText("Recovery gap")).toBeTruthy();
  act(() => jest.advanceTimersByTime(1999));
  expect(view.getByText("Recovery gap")).toBeTruthy();
});

it("promotes an earlier inline failure once without restarting on late reports", () => {
  const view = render(tree());
  const attempt = createInlineAttempt();
  expect(attempt.report("Retained inline failure")).toBe("inline");
  view.rerender(tree(false));
  act(() => attempt.retire());
  view.rerender(tree());
  expect(view.UNSAFE_getAllByType(Toast)).toHaveLength(1);
  act(() => jest.advanceTimersByTime(1500));
  act(() => expect(attempt.report("Retained inline failure")).toBe("retained"));
  act(() => jest.advanceTimersByTime(700));
  expect(view.queryByText("Retained inline failure")).toBeNull();
});

it("accepts a late recovery failure after readiness already returned", () => {
  const view = render(tree());
  const attempt = createInlineAttempt();
  view.rerender(tree(false));
  act(() => attempt.retire());
  view.rerender(tree());
  act(() => expect(attempt.report("Late recovery failure")).toBe("retained"));
  expect(attempt.isCurrent()).toBe(false);
  expect(view.getByText("Late recovery failure")).toBeTruthy();
});

it("honors explicit normal retirement during an unavailable period", () => {
  const view = render(tree());
  const attempt = createInlineAttempt();
  view.rerender(tree(false));
  act(() => attempt.retire("normal"));
  view.rerender(tree());
  act(() => expect(attempt.report("Closed normally")).toBe("discarded"));
  expect(view.queryByText("Closed normally")).toBeNull();
});

it("finishes successful attempts before later recovery", () => {
  const view = render(tree());
  const attempt = createInlineAttempt();
  attempt.finish();
  view.rerender(tree(false));
  act(() => attempt.retire());
  view.rerender(tree());
  expect(attempt.report("Finished work")).toBe("discarded");
  expect(view.queryByText("Finished work")).toBeNull();
});

it("suppresses retained reporters after the provider lifetime ends", () => {
  const view = render(tree());
  const attempt = createInlineAttempt();
  view.rerender(tree(false));
  act(() => attempt.retire());
  view.unmount();
  const next = render(tree());
  expect(attempt.report("Departed owner")).toBe("discarded");
  expect(next.queryByText("Departed owner")).toBeNull();
});
