import React from "react";
import { Dimensions, I18nManager } from "react-native";
import { act, cleanup, render } from "@testing-library/react-native";
import { QiraatTab } from "@/components/mushaf/word-tabs/QiraatTab";
import { fetchQiraat } from "@/lib/word/queries";
import { useSettings } from "@/lib/settings/context";
import { strings } from "@/lib/i18n/strings";
import { flattenStyle } from "../rtl/rtl-test-utils";

type Language = "ar" | "en";
type QiraatResult = Awaited<ReturnType<typeof fetchQiraat>>;
const mockDatabase = { fixture: "no SQL or remote calls" };
const mockSettings: Pick<ReturnType<typeof useSettings>, "uiLanguage"> = { uiLanguage: "en" };
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");
const heading = "عنوان تجريبي";
const firstBody = "سطر أول\nسطر ثانٍ";
const row = { text: `${heading} قرئ: ${firstBody}`, ayah_group: '["2:3","2:4"]' };

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/word/queries", () => ({ fetchQiraat: jest.fn() }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => mockSettings };
});

function deferred() {
  let complete: ((value: QiraatResult) => void) | undefined;
  const promise = new Promise<QiraatResult>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve(value: QiraatResult) {
      if (!complete) throw new Error("Deferred fixture is not initialized");
      complete(value);
    },
  };
}

const locales = [
  { language: "ar", width: 390 },
  { language: "en", width: 1280 },
] satisfies { language: Language; width: number }[];

describe.each(locales)("Qiraat content in $language at $width", ({ language, width }) => {
  beforeEach(() => {
    jest.mocked(fetchQiraat).mockReset();
    mockSettings.uiLanguage = language;
    jest.replaceProperty(I18nManager, "isRTL", language === "ar");
    Dimensions.set({
      window: { width, height: 844, scale: 1, fontScale: 1 },
      screen: { width, height: 844, scale: 1, fontScale: 1 },
    });
  });
  afterEach(() => {
    cleanup();
    Dimensions.set({ window: originalWindow, screen: originalScreen });
    jest.restoreAllMocks();
  });

  it.each([true, false])("preserves literal block rows with showHeader=%s", async (showHeader) => {
    jest.mocked(fetchQiraat).mockResolvedValue({ ...row, text: showHeader ? row.text : `قرئ: ${firstBody}` });
    const view = render(<QiraatTab surah={2} ayah={3} showHeader={showHeader} />);
    expect(view.getByText(strings[language].loading)).toBeTruthy();
    const first = await view.findByText(firstBody, { normalizer: (value) => value });
    const title = view.queryByText(heading);
    expect(Boolean(title)).toBe(showHeader);
    if (title) {
      expect(title.props.children).toBe(heading);
      expect(flattenStyle(title.props.style)).toEqual({
        writingDirection: "rtl",
        textAlign: "right",
        fontWeight: "700",
      });
    }
    expect(first.props.children).toBe(firstBody);
    for (const body of [first]) {
      expect(body.props.className).toBe("text-base text-charcoal dark:text-neutral-200 leading-8");
      expect(flattenStyle(body.props.style)).toEqual({ writingDirection: "rtl", textAlign: "right" });
    }
    if (title) expect(title.props.className).toBe("text-lg text-primary-accent dark:text-primary-bright mb-1.5");
    const header = view.queryByText(strings[language].qiraatHeader);
    expect(Boolean(header)).toBe(showHeader);
    expect(view.getByText(`${strings[language].qiraatCoversAyahs}: ٢:٣، ٢:٤`)).toBeTruthy();
    const tree = view.toJSON();
    if (!tree || Array.isArray(tree)) throw new Error("Expected original single Qiraat root");
    expect(tree.type).toBe("View");
    expect(tree.props.className).toBe("py-4 px-1");
    const rows = tree.children?.filter((child) => typeof child !== "string" && child.props.className === "mb-4");
    expect(rows).toHaveLength(1);
    expect(rows?.map((child) => (typeof child === "string" ? null : child.children?.length))).toEqual([
      showHeader ? 2 : 1,
    ]);
    expect(tree.children).toHaveLength(showHeader ? 3 : 2);
    expect(fetchQiraat).toHaveBeenCalledTimes(1);
    expect(fetchQiraat).toHaveBeenCalledWith(mockDatabase, 2, 3);
  });

  it.each([null, { text: " \n ", ayah_group: null }])("keeps the existing no-data state for %j", async (result) => {
    jest.mocked(fetchQiraat).mockResolvedValue(result);
    const view = render(<QiraatTab surah={2} ayah={3} />);
    const empty = await view.findByText(strings[language].noQiraatData);
    expect(flattenStyle(empty.props.style)).toEqual({ writingDirection: "rtl" });
    expect(view.queryByText(strings[language].qiraatHeader)).toBeNull();
    expect(view.queryByText(heading)).toBeNull();
  });

  it("ignores an old result after changing the selected ayah", async () => {
    const old = deferred();
    jest
      .mocked(fetchQiraat)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ text: "قرئ: محتوى جديد", ayah_group: null });
    const view = render(<QiraatTab surah={2} ayah={3} />);
    view.rerender(<QiraatTab surah={2} ayah={4} />);
    expect(await view.findByText("محتوى جديد")).toBeTruthy();
    await act(async () => {
      old.resolve({ text: "قرئ: محتوى قديم", ayah_group: null });
    });
    expect(view.queryByText("محتوى قديم")).toBeNull();
    expect(view.getByText("محتوى جديد")).toBeTruthy();
    expect(fetchQiraat).toHaveBeenNthCalledWith(2, mockDatabase, 2, 4);
  });
});
