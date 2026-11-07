import React from "react";
import { act, cleanupAsync, render, within } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { TranslationLanguagePicker } from "@/components/settings/TranslationLanguagePicker";
import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import { ResponsiveSheet, OverlayHeader } from "@/components/ui/ResponsiveOverlay";
import { DisclosureRow } from "@/components/ui/MirroredRow";
import { Toast } from "@/components/ui/Toast";
import { DirectionProvider } from "@/lib/ui/direction";
import { TRANSLATION_LANGUAGES } from "@/lib/translations/languages";
import { strings } from "@/lib/i18n/strings";

const mockSelect = jest.fn<Promise<void>, [string]>();
const mockSettings = {
  translationLanguage: "en-bridges",
  setTranslationLanguage: mockSelect,
  isDark: false,
  isRTL: false,
  uiLanguage: "en" as "en" | "ar",
  themeSurface: "#fff",
};
jest.mock("@/lib/settings/context", () => ({ useSettings: () => mockSettings }));
jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => true }));

const releases: (() => void)[] = [];
const inFlight: Promise<unknown>[] = [];
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  releases.push(resolve);
  return { promise, resolve, reject };
}
const close = jest.fn<void, []>();
function tree({ ready = true, mounted = true, visible = true } = {}) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, bottom: 0, right: 0 },
      }}
    >
      <OperationNoticeProvider ready={ready}>
        <DirectionProvider dir={mockSettings.isRTL ? "rtl" : "ltr"}>
          {mounted && <TranslationLanguagePicker visible={visible} onClose={close} />}
        </DirectionProvider>
      </OperationNoticeProvider>
    </SafeAreaProvider>
  );
}
function action(view: ReturnType<typeof render>, code = "id") {
  const index = TRANSLATION_LANGUAGES.findIndex((language) => language.code === code);
  const callback: unknown = view.UNSAFE_getAllByType(DisclosureRow)[index].props.onPress;
  if (typeof callback !== "function") throw new Error("Missing actual selection");
  return () => {
    const result = Promise.resolve(callback());
    inFlight.push(result);
    return result;
  };
}
function begin(view: ReturnType<typeof render>, code = "id") {
  const select = action(view, code);
  let result: Promise<unknown> | undefined;
  act(() => {
    result = select();
  });
  if (!result) throw new Error("Missing selection result");
  return result;
}
function busy(view: ReturnType<typeof render>, expected: boolean) {
  expect(view.UNSAFE_getAllByType(DisclosureRow).every((row) => row.props.disabled === expected)).toBe(true);
}
function dismiss(view: ReturnType<typeof render>, kind: "header" | "sheet") {
  const callback: unknown =
    kind === "header"
      ? view.UNSAFE_getByType(OverlayHeader).props.onClose
      : view.UNSAFE_getByType(ResponsiveSheet).props.onClose;
  if (typeof callback !== "function") throw new Error("Missing actual dismissal");
  act(() => {
    callback();
  });
}

describe.each(["en", "ar"] as const)("%s translation selection lifetime", (language) => {
  let pending: ReturnType<typeof deferred>;
  let warn: jest.SpyInstance;
  let errors: jest.SpyInstance;
  let warnings: number;
  const message = strings[language].translationLoadFailed;
  beforeEach(() => {
    releases.length = 0;
    inFlight.length = 0;
    jest.useFakeTimers();
    mockSettings.uiLanguage = language;
    mockSettings.isRTL = language === "ar";
    close.mockClear();
    pending = deferred();
    mockSelect.mockReset().mockReturnValue(pending.promise);
    warnings = 0;
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    try {
      await act(async () => {
        releases.forEach((resolve) => resolve());
        await Promise.allSettled(inFlight);
      });
      await cleanupAsync();
      expect(warn).toHaveBeenCalledTimes(warnings);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
  async function fail(result: Promise<unknown>) {
    warnings++;
    await act(async () => {
      pending.reject(new Error("Synthetic local import failure"));
      await result;
    });
  }
  it("exposes the languages as one radio group with checked and busy state (RF-165)", async () => {
    const view = render(tree());
    expect(view.UNSAFE_getAllByProps({ accessibilityRole: "radiogroup" }).length).toBeGreaterThan(0);
    expect(view.getAllByRole("radio")).toHaveLength(TRANSLATION_LANGUAGES.length);
    const checked = view.getAllByRole("radio", { checked: true });
    expect(checked).toHaveLength(1);
    expect(within(checked[0]).getAllByText("English (Bridges)").length).toBeGreaterThan(0);
    const indonesian = view.getByRole("radio", { name: /Bahasa Indonesia/ });
    expect(indonesian.props.accessibilityState).toMatchObject({ checked: false, busy: false, disabled: false });

    const result = begin(view);

    expect(view.getByRole("radio", { name: /Bahasa Indonesia/ }).props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
    expect(view.getByRole("radio", { checked: true }).props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => {
      pending.resolve();
      await result;
    });
  });

  it("keeps ordinary failure inline, clears it on retry, and closes only after success", async () => {
    const view = render(tree());
    const result = begin(view);
    busy(view, true);
    await fail(result);
    expect(view.getByText(message)).toBeTruthy();
    expect(view.UNSAFE_queryAllByType(Toast)).toHaveLength(0);
    busy(view, false);
    expect(close).not.toHaveBeenCalled();
    const retry = deferred();
    mockSelect.mockReturnValue(retry.promise);
    const retried = begin(view);
    expect(view.queryByText(message)).toBeNull();
    await act(async () => {
      retry.resolve();
      await retried;
    });
    expect(close).toHaveBeenCalledTimes(1);
    busy(view, false);
  });
  it.each(["during", "after"] as const)("retains a failure that arrives %s recovery", async (when) => {
    const view = render(tree());
    const result = begin(view);
    view.rerender(tree({ ready: false, mounted: false }));
    act(() => jest.advanceTimersByTime(5000));
    if (when === "during") await fail(result);
    view.rerender(tree());
    if (when === "after") await fail(result);
    expect(view.getByText(message)).toBeTruthy();
    expect(view.UNSAFE_getAllByType(Toast)).toHaveLength(1);
    act(() => jest.advanceTimersByTime(1999));
    expect(view.getByText(message)).toBeTruthy();
    act(() => jest.advanceTimersByTime(201));
    expect(view.queryByText(message)).toBeNull();
    expect(close).not.toHaveBeenCalled();
    busy(view, false);
  });
  it("promotes a prior inline failure once if recovery removes its screen", async () => {
    const view = render(tree());
    const result = begin(view);
    await fail(result);
    expect(view.getByText(message)).toBeTruthy();
    expect(view.UNSAFE_queryAllByType(Toast)).toHaveLength(0);
    view.rerender(tree({ ready: false, mounted: false }));
    act(() => jest.advanceTimersByTime(5000));
    view.rerender(tree());
    expect(view.getByText(message)).toBeTruthy();
    expect(view.UNSAFE_getAllByType(Toast)).toHaveLength(1);
  });
  it("discards a late failure after an ordinary screen departure", async () => {
    const view = render(tree());
    const result = begin(view);
    view.rerender(tree({ mounted: false }));
    await fail(result);
    view.rerender(tree());
    expect(view.queryByText(message)).toBeNull();
    expect(view.UNSAFE_queryAllByType(Toast)).toHaveLength(0);
    expect(close).not.toHaveBeenCalled();
  });
  it.each(["header", "sheet"] as const)("discards a late failure after explicit %s close", async (kind) => {
    const view = render(tree());
    const result = begin(view);
    dismiss(view, kind);
    expect(close).toHaveBeenCalledTimes(1);
    view.rerender(tree({ ready: false, mounted: false }));
    view.rerender(tree());
    await fail(result);
    expect(view.queryByText(message)).toBeNull();
    expect(view.UNSAFE_queryAllByType(Toast)).toHaveLength(0);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("admits only one selection from callbacks captured in the same render", async () => {
    const view = render(tree());
    const first = action(view, "id"),
      second = action(view, "fr");
    let result: Promise<unknown> | undefined;
    act(() => {
      result = first();
      void second();
    });
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockSelect).toHaveBeenCalledWith("id");
    await act(async () => {
      pending.resolve();
      await result;
    });
  });
  it.each(["success", "failure"] as const)("ignores old %s and finally after close/reopen", async (outcome) => {
    const view = render(tree());
    const old = begin(view);
    dismiss(view, "header");
    view.rerender(tree({ visible: false }));
    view.rerender(tree());
    const next = deferred();
    mockSelect.mockReturnValue(next.promise);
    const current = begin(view, "fr");
    busy(view, true);
    if (outcome === "failure") await fail(old);
    else
      await act(async () => {
        pending.resolve();
        await old;
      });
    expect(close).toHaveBeenCalledTimes(1);
    busy(view, true);
    expect(view.queryByText(message)).toBeNull();
    expect(view.UNSAFE_queryAllByType(Toast)).toHaveLength(0);
    await act(async () => {
      next.resolve();
      await current;
    });
    expect(close).toHaveBeenCalledTimes(2);
    busy(view, false);
  });
  it("clears the prior failure before a new attempt enters recovery", async () => {
    const view = render(tree());
    await fail(begin(view));
    const next = deferred();
    mockSelect.mockReturnValue(next.promise);
    const current = begin(view, "fr");
    view.rerender(tree({ ready: false, mounted: false }));
    view.rerender(tree());
    expect(view.queryByText(message)).toBeNull();
    await act(async () => {
      next.resolve();
      await current;
    });
    expect(view.queryByText(message)).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it.each(["selection", "close"] as const)("rejects an obsolete %s callback after reopening", async (kind) => {
    const view = render(tree());
    const oldSelection = action(view);
    const oldClose: unknown = view.UNSAFE_getByType(OverlayHeader).props.onClose;
    if (typeof oldClose !== "function") throw new Error("Missing old dismissal");
    dismiss(view, "header");
    view.rerender(tree({ visible: false }));
    view.rerender(tree());
    act(() => {
      if (kind === "selection") void oldSelection();
      else oldClose();
    });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    const current = begin(view, "fr");
    busy(view, true);
    await act(async () => {
      pending.resolve();
      await current;
    });
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockSelect).toHaveBeenCalledWith("fr");
    expect(close).toHaveBeenCalledTimes(2);
    busy(view, false);
  });
  it("suppresses late failure after the entire notice owner unmounts", async () => {
    const view = render(tree());
    const result = begin(view);
    view.unmount();
    await fail(result);
    const next = render(tree());
    expect(next.queryByText(message)).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
});
