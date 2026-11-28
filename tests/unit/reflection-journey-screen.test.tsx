import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import ReflectionJourneyScreen from "@/app/(tabs)/reflection-journey";
import { ZaytAnimation } from "@/components/habit/ZaytAnimation";
import {
  completeReflectionJourneyLevel,
  listReflectionJourneyLevels,
  saveReflectionJourneyDraft,
} from "@/lib/reflection-journey/queries";
import type { ReflectionJourneyLevelListItem } from "@/lib/reflection-journey/types";
import { strings } from "@/lib/i18n/strings";

const mockSettings = {
  isDark: false,
  isRTL: false,
  uiLanguage: "en" as "en" | "ar",
  themeColors: {
    surface: "#FFFFFF",
    surfaceLow: "#F8FAFC",
    surfaceMid: "#F4F4F5",
    surfaceHigh: "#E5E7EB",
    surfaceDim: "#D1D5DB",
    surfaceBright: "#FFFFFF",
  },
};
let mockFocus: (() => void) | null = null;
const mockAuth: { user: { id: string } | null } = { user: null };
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => false) };

const mockDatabase = {};
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { withThemeOpacity: actual.withThemeOpacity, useSettings: () => mockSettings };
});
jest.mock("@/lib/selection/context", () => ({
  SelectionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSelection: () => ({ showToast: jest.fn() }),
}));
jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (callback: () => void) => {
      mockFocus = callback;
      useEffect(callback, [callback]);
    },
  };
});
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: (selector: (state: typeof mockAuth) => unknown) => selector(mockAuth),
}));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return { SafeAreaView: View, useSafeAreaInsets: () => insets };
});
jest.mock("@/components/reflection-journey/JourneyAyahCard", () => ({ JourneyAyahCard: () => null }));
jest.mock("@/lib/zayt/presentation", () => ({ useShowZayt: () => true }));
jest.mock("@/components/habit/ZaytAnimation", () => ({ ZaytAnimation: jest.fn(() => null) }));
jest.mock("@/lib/reflection-journey/queries", () => ({
  listReflectionJourneyLevels: jest.fn(),
  saveReflectionJourneyDraft: jest.fn(),
  completeReflectionJourneyLevel: jest.fn(),
}));

const ORDER: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };
function level(
  id: string,
  status: ReflectionJourneyLevelListItem["status"],
  responseText = status === "available" ? "" : "a saved reflection",
): ReflectionJourneyLevelListItem {
  return {
    id,
    slug: id,
    order: ORDER[id] ?? 9,
    title: { en: `Title ${id}`, ar: `عنوان ${id}` },
    summary: { en: `Summary ${id}`, ar: `ملخص ${id}` },
    responsePrompt: { en: "Prompt", ar: "سؤال" },
    blocks: [],
    status,
    entry:
      status === "available"
        ? null
        : {
            levelId: id,
            status,
            responseText,
            createdAt: "2026-11-01T00:00:00.000Z",
            updatedAt: "2026-11-01T00:00:00.000Z",
            completedAt: status === "completed" ? "2026-11-01T00:00:00.000Z" : null,
          },
  };
}
const levels = [level("first", "completed"), level("second", "available")];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => (resolve = accept));
  return { promise, resolve };
}

type Node = { props: Record<string, unknown>; children: (Node | string)[] };
function textOf(node: Node | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

describe.each(["en", "ar"] as const)("reflection journey loading in %s", (language) => {
  const s = strings[language];
  const summary = (id: string) => (language === "ar" ? `ملخص ${id}` : `Summary ${id}`);
  const title = (id: string) => (language === "ar" ? `عنوان ${id}` : `Title ${id}`);
  const pill = (view: ReturnType<typeof render>, id: string) => {
    const found = view
      .getAllByRole("button")
      .find((node) => String(node.props.accessibilityLabel ?? "").includes(title(id)));
    if (!found) throw new Error(`No pill for ${id}`);
    return found;
  };
  const button = (view: ReturnType<typeof render>, label: string) => {
    const found = view
      .getAllByRole("button")
      .find((node) => node.props.accessibilityLabel === label || textOf(node as unknown as Node).includes(label));
    if (!found) throw new Error(`No button ${label}`);
    return found;
  };

  beforeEach(() => {
    jest.mocked(listReflectionJourneyLevels).mockReset();
    jest.mocked(saveReflectionJourneyDraft).mockReset();
    jest.mocked(completeReflectionJourneyLevel).mockReset();
    mockAuth.user = null;
    mockSettings.uiLanguage = language;
    mockSettings.isRTL = language === "ar";
  });
  afterEach(cleanup);

  it("shows a loading state, not the empty state, while levels load", async () => {
    let resolve!: (items: ReflectionJourneyLevelListItem[]) => void;
    jest.mocked(listReflectionJourneyLevels).mockReturnValue(new Promise((accept) => (resolve = accept)));
    const view = render(<ReflectionJourneyScreen />);

    expect(view.getByLabelText(s.reflectionJourneyLoading)).toBeTruthy();
    expect(view.queryByText(s.reflectionJourneyEmptyTitle)).toBeNull();
    await act(async () => resolve(levels));
    expect(view.getByText(summary("second"))).toBeTruthy();
    expect(view.getByText(s.reflectionJourneyTitle)).toBeTruthy();
    expect(s.reflectionJourneyTitle).toBe(language === "ar" ? "رحلة التدبر" : "Reflection Journey");
  });

  it("offers a retry after a failed load", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.mocked(listReflectionJourneyLevels).mockRejectedValueOnce(new Error("synthetic failure"));
    const view = render(<ReflectionJourneyScreen />);
    await act(async () => {});

    expect(view.getByText(s.reflectionJourneyLoadFailed)).toBeTruthy();
    expect(view.queryByText(s.reflectionJourneyEmptyTitle)).toBeNull();
    jest.mocked(listReflectionJourneyLevels).mockResolvedValueOnce(levels);
    await act(async () => {
      fireEvent.press(view.getByText(s.reflectionJourneyRetry));
    });
    expect(view.getByText(summary("second"))).toBeTruthy();
  });

  it("keeps the chosen level when the screen regains focus", async () => {
    jest.mocked(listReflectionJourneyLevels).mockResolvedValue(levels);
    const view = render(<ReflectionJourneyScreen />);
    await act(async () => {});
    await act(async () => {
      fireEvent.press(pill(view, "first"));
    });
    expect(view.getByText(summary("first"))).toBeTruthy();

    await act(async () => mockFocus?.());
    expect(listReflectionJourneyLevels).toHaveBeenCalledTimes(2);
    expect(view.getByText(summary("first"))).toBeTruthy();
  });

  it("opens the first draft by default and shows Draft without a Next marker", async () => {
    jest
      .mocked(listReflectionJourneyLevels)
      .mockResolvedValue([level("first", "available"), level("second", "available"), level("third", "draft")]);
    const view = render(<ReflectionJourneyScreen />);
    await act(async () => {});
    expect(view.getByText(summary("third"))).toBeTruthy();
    expect(view.getAllByText(s.reflectionJourneyStatusDraft).length).toBeGreaterThan(0);
    expect(view.queryByText(s.journeyNextMarker)).toBeNull();
    expect(view.queryByText("Locked")).toBeNull();
  });

  it("marks the first unfinished level as Next and lets a later level be saved and completed", async () => {
    jest
      .mocked(listReflectionJourneyLevels)
      .mockResolvedValue([level("first", "available"), level("second", "available"), level("third", "available")]);
    const view = render(<ReflectionJourneyScreen />);
    await act(async () => {});
    expect(view.getByText(summary("first"))).toBeTruthy();
    expect(view.getAllByText(s.journeyNextMarker).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.press(pill(view, "third"));
    });
    expect(view.getByText(summary("third"))).toBeTruthy();

    const input = view.getByLabelText(s.reflectionJourneyResponseLabel);
    await act(async () => fireEvent.changeText(input, "too short"));
    expect(button(view, s.reflectionJourneySaveComplete).props.accessibilityState?.disabled).toBe(true);
    expect(view.getByText(s.journeyMoreToComplete.replace("{{n}}", language === "ar" ? "١" : "1"))).toBeTruthy();

    // A draft shorter than ten characters still saves.
    jest.mocked(saveReflectionJourneyDraft).mockResolvedValue(level("third", "draft", "too short").entry!);
    await act(async () => {
      fireEvent.press(button(view, s.reflectionJourneySaveDraft));
    });
    expect(saveReflectionJourneyDraft).toHaveBeenCalledWith(mockDatabase, "third", "too short");

    await act(async () => fireEvent.changeText(input, "long enough reflection"));
    expect(button(view, s.reflectionJourneySaveComplete).props.accessibilityState?.disabled).toBe(false);
    jest
      .mocked(completeReflectionJourneyLevel)
      .mockResolvedValue(level("third", "completed", "long enough reflection").entry!);
    jest
      .mocked(listReflectionJourneyLevels)
      .mockResolvedValue([
        level("first", "available"),
        level("second", "available"),
        level("third", "completed", "long enough reflection"),
      ]);
    await act(async () => {
      fireEvent.press(button(view, s.reflectionJourneySaveComplete));
    });
    expect(completeReflectionJourneyLevel).toHaveBeenCalledWith(mockDatabase, "third", "long enough reflection");
    expect(completeReflectionJourneyLevel).toHaveBeenCalledTimes(1);
    expect(view.getByText(s.reflectionJourneyCompletedToast)).toBeTruthy();
    // Visiting and completing the last level does not finish the whole Journey.
    expect(view.queryByText(s.journeyFinished)).toBeNull();
    expect(view.getByText(s.journeyOpenUnfinished)).toBeTruthy();
  });

  it("says the journey is finished only when every level is completed", async () => {
    jest
      .mocked(listReflectionJourneyLevels)
      .mockResolvedValue([level("first", "completed"), level("second", "completed")]);
    const view = render(<ReflectionJourneyScreen />);
    await act(async () => {});
    // The default revisits the last completed level, with Save changes disabled until the text changes.
    expect(view.getByText(summary("second"))).toBeTruthy();
    expect(view.getByText(s.journeyFinished)).toBeTruthy();
    expect(jest.mocked(ZaytAnimation).mock.lastCall?.[0]).toMatchObject({ presentationId: null });
    expect(view.queryByText(s.journeyNextMarker)).toBeNull();
    expect(button(view, s.journeySaveChanges).props.accessibilityState?.disabled).toBe(true);
    await act(async () =>
      fireEvent.changeText(view.getByLabelText(s.reflectionJourneyResponseLabel), "an edited reflection"),
    );
    expect(button(view, s.journeySaveChanges).props.accessibilityState?.disabled).toBe(false);
    expect(button(view, s.journeyNextLevel).props.accessibilityState?.disabled).toBe(true);
  });

  it("shows the finish on the last outstanding response when levels are completed out of order", async () => {
    let items = ["first", "second", "third", "fourth"].map((id) => level(id, "available"));
    jest.mocked(listReflectionJourneyLevels).mockImplementation(async () => items);
    jest.mocked(completeReflectionJourneyLevel).mockImplementation(async (_db, id, text) => {
      const completed = level(id, "completed", text);
      items = items.map((item) => item.id === id ? completed : item);
      return completed.entry!;
    });
    const view = render(<ReflectionJourneyScreen />);
    await act(async () => {});
    for (const id of ["second", "fourth", "first", "third"]) {
      expect(view.queryByText(s.journeyFinished)).toBeNull();
      fireEvent.press(pill(view, id));
      fireEvent.changeText(view.getByLabelText(s.reflectionJourneyResponseLabel), "a private reflection");
      await act(async () => fireEvent.press(button(view, s.reflectionJourneySaveComplete)));
    }
    expect(view.getByText(summary("third"))).toBeTruthy();
    expect(view.getByText(s.journeyFinished)).toBeTruthy();
    expect(view.queryByText(s.reflectionJourneyOpenNext)).toBeNull();
    expect(jest.mocked(ZaytAnimation).mock.lastCall?.[0]).toMatchObject({
      animation: "A15",
      presentationId: `journey:third:${items[2].entry!.updatedAt}`,
    });
    fireEvent.press(button(view, s.journeyNextLevel));
    expect(view.getByText(summary("fourth"))).toBeTruthy();
  });

  it("keeps the text after a failed save and repeats the same save from Retry", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.mocked(listReflectionJourneyLevels).mockResolvedValue([level("first", "available")]);
    const view = render(<ReflectionJourneyScreen />);
    await act(async () => {});
    await act(async () => fireEvent.changeText(view.getByLabelText(s.reflectionJourneyResponseLabel), "kept words"));
    jest.mocked(saveReflectionJourneyDraft).mockRejectedValueOnce(new Error("synthetic failure"));
    await act(async () => {
      fireEvent.press(button(view, s.reflectionJourneySaveDraft));
    });
    expect(view.getByText(s.reflectionJourneySaveFailed)).toBeTruthy();
    expect(view.getByLabelText(s.reflectionJourneyResponseLabel).props.value).toBe("kept words");

    jest.mocked(saveReflectionJourneyDraft).mockResolvedValueOnce(level("first", "draft", "kept words").entry!);
    await act(async () => {
      fireEvent.press(button(view, s.reflectionJourneyRetry));
    });
    expect(saveReflectionJourneyDraft).toHaveBeenCalledTimes(2);
    expect(saveReflectionJourneyDraft).toHaveBeenLastCalledWith(mockDatabase, "first", "kept words");
    expect(view.queryByText(s.reflectionJourneySaveFailed)).toBeNull();
  });

  it("asks before a level switch drops unsaved text", async () => {
    jest
      .mocked(listReflectionJourneyLevels)
      .mockResolvedValue([level("first", "available"), level("second", "available")]);
    const view = render(<ReflectionJourneyScreen />);
    await act(async () => {});
    await act(async () => fireEvent.changeText(view.getByLabelText(s.reflectionJourneyResponseLabel), "unsaved"));
    await act(async () => {
      fireEvent.press(pill(view, "second"));
    });
    expect(view.getByText(s.journeyDiscardTitle)).toBeTruthy();
    expect(view.getByText(summary("first"))).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText(s.discardChangesConfirm));
    });
    expect(view.getByText(summary("second"))).toBeTruthy();
    expect(view.getByLabelText(s.reflectionJourneyResponseLabel).props.value).toBe("");
  });

  it("clears private text on an account change and ignores the old account's late save", async () => {
    jest.mocked(listReflectionJourneyLevels).mockResolvedValue([level("first", "available")]);
    const view = render(<ReflectionJourneyScreen />);
    await act(async () => {});
    await act(async () => fireEvent.changeText(view.getByLabelText(s.reflectionJourneyResponseLabel), "private words"));
    const pendingSave = deferred<NonNullable<ReflectionJourneyLevelListItem["entry"]>>();
    jest.mocked(saveReflectionJourneyDraft).mockReturnValue(pendingSave.promise);
    await act(async () => {
      fireEvent.press(button(view, s.reflectionJourneySaveDraft));
    });

    mockAuth.user = { id: "other-account" };
    view.rerender(<ReflectionJourneyScreen />);
    await act(async () => {});
    expect(view.getByLabelText(s.reflectionJourneyResponseLabel).props.value).toBe("");

    await act(async () => pendingSave.resolve(level("first", "draft", "private words").entry!));
    expect(view.getByLabelText(s.reflectionJourneyResponseLabel).props.value).toBe("");
    expect(view.queryByText(s.reflectionJourneyStatusDraft)).toBeNull();
  });
});
