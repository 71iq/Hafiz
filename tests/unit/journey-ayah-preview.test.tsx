import React from "react";
import { ActivityIndicator, I18nManager, StyleSheet } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { JourneyAyahCard } from "@/components/reflection-journey/JourneyAyahCard";
import { strings } from "@/lib/i18n/strings";
import type { useSettings } from "@/lib/settings/context";
import {
  isQuranPageFontLoaded,
  loadQuranPageFont,
  quranPageFontName,
  quranPageFontPaletteStyle,
  quranPageMarkerFontPaletteStyle,
} from "@/lib/fonts/loader";
import type { AyahDetailModal } from "@/components/mushaf/AyahDetailModal";

type Block = React.ComponentProps<typeof JourneyAyahCard>["block"];
type DetailProps = React.ComponentProps<typeof AyahDetailModal>;
type QuranRow = { surah: number; ayah: number; text_qcf2: string; v2_page: number };
type TextRow = { surah: number; ayah: number; text: string };
type QueryRow = QuranRow | TextRow | { surah: number; ayah: number; text_en: string };
const mockDatabase = {
  getAllAsync: jest.fn<Promise<QueryRow[]>, [string, unknown[]]>(),
  runAsync: jest.fn<never, unknown[]>(() => {
    throw new Error("Writes are forbidden in the journey fixture");
  }),
};
const mockSettings: Pick<
  ReturnType<typeof useSettings>,
  | "isDark"
  | "isRTL"
  | "uiLanguage"
  | "translationLanguage"
  | "tafseerSource"
  | "quranFontStyle"
  | "quranMarkerStyle"
  | "effectiveTheme"
> = {
  isDark: false,
  isRTL: false,
  uiLanguage: "en",
  translationLanguage: "en",
  tafseerSource: "zilal",
  quranFontStyle: "qcf2",
  quranMarkerStyle: "auto",
  effectiveTheme: "white",
};
let mockDetail: DetailProps | undefined;
let frames: FrameRequestCallback[];
const literal = "نص تجريبي <b>literal</b>\n e\u0301  ";
const range = { surah: 7, ayahStart: 3, ayahEnd: 5 };
const quranRows: QuranRow[] = [
  { surah: 7, ayah: 3, text_qcf2: " glyph-a  glyph-b marker-a ", v2_page: 9 },
  { surah: 7, ayah: 4, text_qcf2: "glyph-c marker-b", v2_page: 9 },
  { surah: 7, ayah: 5, text_qcf2: "marker-c", v2_page: 10 },
];

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => mockSettings }));
jest.mock("@/components/mushaf/AyahDetailModal", () => ({
  AyahDetailModal: (props: DetailProps) => {
    mockDetail = props;
    return null;
  },
}));
jest.mock("@/lib/fonts/loader", () => ({
  isQuranPageFontLoaded: jest.fn(),
  loadQuranPageFont: jest.fn(),
  quranPageFontName: jest.fn(),
  quranPageFontPaletteStyle: jest.fn(),
  quranPageMarkerFontPaletteStyle: jest.fn(),
}));

function deferred<T>() {
  let complete: ((value: T) => void) | undefined;
  let fail: ((reason: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  return {
    promise,
    resolve(value: T) {
      if (!complete) throw new Error("Deferred fixture not initialized");
      complete(value);
    },
    reject(error: Error) {
      if (!fail) throw new Error("Deferred fixture not initialized");
      fail(error);
    },
  };
}
function detail() {
  if (!mockDetail) throw new Error("Detail modal did not receive props");
  return mockDetail;
}
async function settle() {
  await act(async () => {});
}
function finishFrames() {
  act(() => {
    frames.splice(0).forEach((callback) => callback(0));
  });
}
function expectQuery(table: string, values: unknown[]) {
  expect(mockDatabase.getAllAsync).toHaveBeenCalledTimes(1);
  const [sql, params] = mockDatabase.getAllAsync.mock.calls[0];
  expect(sql).toContain("FROM " + table);
  expect(sql).toContain("WHERE surah = ? AND ayah BETWEEN ? AND ?");
  expect(sql).toContain("ORDER BY ayah ASC");
  expect(params).toEqual(values);
}
function expectTarget(
  view: ReturnType<typeof render>,
  reference: string,
  target: NonNullable<DetailProps["target"]>,
  tab: DetailProps["initialTab"],
) {
  expect(detail().target).toBeNull();
  const label = view.getByText(reference);
  expect(StyleSheet.flatten(label.props.style)).toEqual({ fontFamily: "Manrope_600SemiBold", fontSize: 11 });
  expect(label.props.className).toBe("text-warm-400 dark:text-neutral-500 mb-2");
  let control = label.parent;
  while (control && !(typeof control.props.onPress === "function" && typeof control.props.style === "function")) {
    control = control.parent;
  }
  if (!control) throw new Error("Missing pressable preview row");
  expect(control.props.className).toBe("rounded-3xl bg-surface dark:bg-surface-dark px-4 py-4");
  expect(control.props.style({ pressed: false })).toEqual({ transform: [{ scale: 1 }] });
  expect(control.props.style({ pressed: true })).toEqual({ transform: [{ scale: 0.99 }] });
  fireEvent.press(label);
  expect(detail().target).toEqual(target);
  expect(detail().initialTab).toBe(tab);
  act(() => detail().onClose());
  expect(detail().target).toBeNull();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDetail = undefined;
  frames = [];
  mockDatabase.getAllAsync.mockResolvedValue([]);
  jest.mocked(isQuranPageFontLoaded).mockReturnValue(true);
  jest.mocked(loadQuranPageFont).mockResolvedValue(undefined);
  jest.mocked(quranPageFontName).mockImplementation((style, page) => "Fixture-" + style + "-" + page);
  jest.mocked(quranPageFontPaletteStyle).mockReturnValue({ color: "#123456" });
  jest.mocked(quranPageMarkerFontPaletteStyle).mockReturnValue({ color: "#654321" });
  jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  if (typeof globalThis.fetch === "function") {
    jest.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Remote access is forbidden in the journey fixture");
    });
  }
});
afterEach(() => {
  cleanup();
  expect(mockDatabase.runAsync).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

describe.each(["en", "ar"] satisfies ("en" | "ar")[])("real journey card in %s", (language) => {
  beforeEach(() => {
    Object.assign(mockSettings, {
      uiLanguage: language,
      isRTL: language === "ar",
      translationLanguage: "en",
      tafseerSource: "zilal",
      quranFontStyle: "qcf2",
      quranMarkerStyle: "auto",
      effectiveTheme: "white",
    });
    jest.replaceProperty(I18nManager, "isRTL", language === "ar");
  });

  it("keeps Quran font readiness, page deduplication, marker styling and row-specific modal targets", async () => {
    const font = deferred<void>();
    mockDatabase.getAllAsync.mockResolvedValue(quranRows);
    jest.mocked(isQuranPageFontLoaded).mockImplementation((_style, page) => page === 10);
    jest.mocked(loadQuranPageFont).mockReturnValue(font.promise);
    const view = render(<JourneyAyahCard block={{ type: "ayah_range", ...range }} />);
    expect(view.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(1);
    await settle();
    expectQuery("quran_text", [7, 3, 5]);
    expect(view.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    expect(view.getAllByText(strings[language].loading)).toHaveLength(3);
    expect(view.queryByText("glyph-a")).toBeNull();
    expect(isQuranPageFontLoaded).toHaveBeenCalledTimes(2);
    expect(isQuranPageFontLoaded).toHaveBeenNthCalledWith(1, "qcf2", 9);
    expect(isQuranPageFontLoaded).toHaveBeenNthCalledWith(2, "qcf2", 10);
    expect(loadQuranPageFont).toHaveBeenCalledTimes(1);
    expect(loadQuranPageFont).toHaveBeenCalledWith("qcf2", 9);
    await act(async () => font.resolve(undefined));
    expect(frames).toHaveLength(1);
    expect(view.queryByText("glyph-a")).toBeNull();
    finishFrames();
    expect(view.queryByText(strings[language].loading)).toBeNull();
    for (const token of ["glyph-a", "glyph-b", "glyph-c", "marker-a", "marker-b", "marker-c"]) {
      const marker = token.startsWith("marker");
      const page = token === "marker-c" ? 10 : 9;
      expect(StyleSheet.flatten(view.getByText(token).props.style)).toEqual({
        fontFamily: "Fixture-qcf2-" + page,
        color: marker ? "#654321" : "#123456",
        fontSize: 28,
        lineHeight: 54,
        paddingHorizontal: 2,
        writingDirection: marker ? "rtl" : undefined,
      });
    }
    expect(quranPageFontPaletteStyle).toHaveBeenCalledWith("qcf2", 9, "white");
    expect(quranPageMarkerFontPaletteStyle).toHaveBeenCalledWith("qcf2", 10, "white", "auto");
    expectTarget(view, "7:4", { surah: 7, ayah: 4 }, "tafsir");
    expect(view.getByText(strings[language].reflectionJourneyBlockHint)).toBeTruthy();
  });

  it.each(["qcf2", "v4", "v4-tajweed"] satisfies (typeof mockSettings.quranFontStyle)[])(
    "uses cached %s glyphs and the chosen marker palette without loading a font",
    async (fontStyle) => {
      mockSettings.quranFontStyle = fontStyle;
      mockSettings.quranMarkerStyle = "sepia";
      mockSettings.effectiveTheme = "dark";
      mockDatabase.getAllAsync.mockResolvedValue([quranRows[0]]);
      const view = render(<JourneyAyahCard block={{ type: "ayah_range", ...range }} />);
      await settle();
      expect(frames).toHaveLength(1);
      expect(view.queryByText("glyph-a")).toBeNull();
      finishFrames();
      expect(loadQuranPageFont).not.toHaveBeenCalled();
      expect(isQuranPageFontLoaded).toHaveBeenCalledWith(fontStyle, 9);
      expect(quranPageFontName).toHaveBeenCalledWith(fontStyle, 9);
      expect(quranPageFontPaletteStyle).toHaveBeenCalledWith(fontStyle, 9, "dark");
      expect(quranPageMarkerFontPaletteStyle).toHaveBeenCalledWith(fontStyle, 9, "dark", "sepia");
      expect(StyleSheet.flatten(view.getByText("glyph-a").props.style).fontFamily).toBe("Fixture-" + fontStyle + "-9");
    },
  );

  it.each([
    { code: "en", table: "translations", direction: "ltr" },
    { code: "ur", table: "translation_active", direction: "rtl" },
  ])(
    "preserves $code translation content, query and direction independently of UI language",
    async ({ code, table, direction }) => {
      mockSettings.translationLanguage = code;
      mockDatabase.getAllAsync.mockResolvedValue([
        code === "en" ? { surah: 7, ayah: 4, text_en: literal } : { surah: 7, ayah: 4, text: literal },
      ]);
      const view = render(<JourneyAyahCard block={{ type: "translation", ...range }} />);
      await settle();
      expectQuery(table, [7, 3, 5]);
      const text = view.getByText(literal, { normalizer: (value) => value });
      expect(text.props.children).toBe(literal);
      expect(StyleSheet.flatten(text.props.style)).toEqual({
        fontFamily: "Manrope_400Regular",
        fontSize: 15,
        lineHeight: 26,
        textAlign: direction === "rtl" ? "right" : "left",
        writingDirection: direction,
      });
      expect(loadQuranPageFont).not.toHaveBeenCalled();
      expectTarget(view, "7:4", { surah: 7, ayah: 4 }, "translation");
    },
  );

  it.each(["settings", "muyassar"] satisfies ("settings" | "muyassar")[])(
    "preserves %s tafsir source selection and unconditional RTL text",
    async (source) => {
      mockDatabase.getAllAsync.mockResolvedValue([{ surah: 7, ayah: 5, text: literal }]);
      const view = render(<JourneyAyahCard block={{ type: "tafseer", source, ...range }} />);
      await settle();
      expectQuery("tafseer", [7, 3, 5, source === "settings" ? "zilal" : "muyassar"]);
      expect(mockDatabase.getAllAsync.mock.calls[0][0]).toContain("AND source = ?");
      const text = view.getByText(literal, { normalizer: (value) => value });
      expect(text.props.children).toBe(literal);
      expect(StyleSheet.flatten(text.props.style)).toEqual({
        fontFamily: "Manrope_400Regular",
        fontSize: 15,
        lineHeight: 26,
        textAlign: "right",
        writingDirection: "rtl",
      });
      expect(loadQuranPageFont).not.toHaveBeenCalled();
      expectTarget(view, "7:5", { surah: 7, ayah: 5 }, "tafsir");
    },
  );

  it("keeps localized recitation copy and single-ayah reference without querying or opening detail", async () => {
    const block: Block = {
      type: "recitation_placeholder",
      surah: 7,
      ayahStart: 4,
      ayahEnd: 4,
      title: { en: "Fixture title", ar: "عنوان تجريبي" },
      body: { en: literal, ar: "نص تجريبي عربي" },
    };
    const view = render(<JourneyAyahCard block={block} />);
    await settle();
    expect(view.getByText(block.title?.[language] ?? "")).toBeTruthy();
    const text = view.getByText(block.body?.[language] ?? "", { normalizer: (value) => value });
    expect(StyleSheet.flatten(text.props.style)).toEqual({
      fontFamily: "Manrope_400Regular",
      fontSize: 14,
      lineHeight: 24,
      textAlign: language === "ar" ? "right" : "left",
      writingDirection: language === "ar" ? "rtl" : "ltr",
    });
    expect(view.getAllByText("7:4")).toHaveLength(2);
    fireEvent.press(text);
    expect(detail().target).toBeNull();
    expect(view.queryByText(strings[language].reflectionJourneyBlockHint)).toBeNull();
    expect(mockDatabase.getAllAsync).not.toHaveBeenCalled();
    expect(loadQuranPageFont).not.toHaveBeenCalled();
  });

  it.each([
    { type: "ayah_range", title: "reflectionJourneyAyahBlock" },
    { type: "translation", title: "reflectionJourneyTranslationBlock" },
    { type: "tafseer", title: "reflectionJourneyTafseerBlock" },
    { type: "recitation_placeholder", title: "reflectionJourneyRecitationBlock" },
  ] satisfies { type: Block["type"]; title: keyof typeof strings.en }[])(
    "keeps fallback title and empty $type presentation",
    async ({ type, title }) => {
      const common = { ...range, title: { en: "", ar: "" } };
      const block: Block = type === "tafseer" ? { ...common, type, source: "settings" } : { ...common, type };
      const view = render(<JourneyAyahCard block={block} />);
      await settle();
      expect(view.getByText(strings[language][title])).toBeTruthy();
      expect(view.getAllByText("7:3-5")).toHaveLength(type === "recitation_placeholder" ? 2 : 1);
      expect(view.queryByText(strings[language].loading)).toBeNull();
      expect(view.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
      expect(Boolean(view.queryByText(strings[language].reflectionJourneyBlockHint))).toBe(
        type !== "recitation_placeholder",
      );
      if (type === "recitation_placeholder")
        expect(view.getByText(strings[language].reflectionJourneyRecitationPlaceholder)).toBeTruthy();
      expect(loadQuranPageFont).not.toHaveBeenCalled();
      expect(detail().target).toBeNull();
    },
  );

  it("ignores a late old query after changing content branch and ayah range", async () => {
    const old = deferred<QueryRow[]>();
    mockDatabase.getAllAsync
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce([{ surah: 8, ayah: 2, text: literal }]);
    const view = render(<JourneyAyahCard block={{ type: "translation", ...range }} />);
    view.rerender(
      <JourneyAyahCard block={{ type: "tafseer", source: "muyassar", surah: 8, ayahStart: 2, ayahEnd: 3 }} />,
    );
    await settle();
    expect(view.getByText(literal, { normalizer: (value) => value })).toBeTruthy();
    await act(async () => old.resolve([{ surah: 7, ayah: 3, text_en: "stale fixture" }]));
    expect(view.queryByText("stale fixture")).toBeNull();
    expect(mockDatabase.getAllAsync.mock.calls[1][1]).toEqual([8, 2, 3, "muyassar"]);
    expectTarget(view, "8:2", { surah: 8, ayah: 2 }, "tafsir");
  });

  it("preserves the existing empty completion and warning after query rejection", async () => {
    const failure = new Error("Synthetic database read failure");
    const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockDatabase.getAllAsync.mockRejectedValue(failure);
    const view = render(<JourneyAyahCard block={{ type: "translation", ...range }} />);
    await settle();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith("[JourneyAyahCard] Failed to load block:", failure);
    expect(view.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    expect(view.getByText(strings[language].reflectionJourneyBlockHint)).toBeTruthy();
    expect(detail().target).toBeNull();
  });

  it("preserves the current font-rejection fallback rather than inventing missing content", async () => {
    const failure = new Error("Synthetic font failure");
    const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockDatabase.getAllAsync.mockResolvedValue(quranRows);
    jest.mocked(isQuranPageFontLoaded).mockReturnValue(false);
    jest.mocked(loadQuranPageFont).mockRejectedValue(failure);
    const view = render(<JourneyAyahCard block={{ type: "ayah_range", ...range }} />);
    await settle();
    expect(warning).toHaveBeenCalledWith("[JourneyAyahCard] Failed to load Quran fonts:", failure);
    expect(view.getByText("glyph-a")).toBeTruthy();
    expect(view.queryByText(strings[language].loading)).toBeNull();
    expectTarget(view, "7:3", { surah: 7, ayah: 3 }, "tafsir");
  });

  it("does not queue a readiness frame for a font that resolves after unmount", async () => {
    const font = deferred<void>();
    mockDatabase.getAllAsync.mockResolvedValue([quranRows[0]]);
    jest.mocked(isQuranPageFontLoaded).mockReturnValue(false);
    jest.mocked(loadQuranPageFont).mockReturnValue(font.promise);
    const view = render(<JourneyAyahCard block={{ type: "ayah_range", ...range }} />);
    await settle();
    expect(loadQuranPageFont).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => font.resolve(undefined));
    expect(frames).toHaveLength(0);
  });

  it("does not start font work for a query that resolves after unmount", async () => {
    const query = deferred<QueryRow[]>();
    mockDatabase.getAllAsync.mockReturnValue(query.promise);
    const view = render(<JourneyAyahCard block={{ type: "ayah_range", ...range }} />);
    view.unmount();
    await act(async () => query.resolve(quranRows));
    expect(loadQuranPageFont).not.toHaveBeenCalled();
    expect(isQuranPageFontLoaded).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });
});
