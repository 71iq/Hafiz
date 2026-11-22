import React, { type ComponentProps } from "react";
import { Dimensions, FlatList, View } from "react-native";
import { act, cleanup, render } from "@testing-library/react-native";
import { PageMushaf } from "@/components/mushaf/PageMushaf";
import { MushafSlider } from "@/components/mushaf/MushafSlider";

// Page view landing on the page it was sent to. The real PageMushaf runs against a synthetic
// 604-page book (one placeholder ayah per page, never Quran data); the page drawing is stubbed.

const PAGES = 604;
const mockDb = {
  getAllAsync: jest.fn(async (sql: string): Promise<unknown[]> => {
    if (sql.includes("FROM page_map")) {
      return Array.from({ length: PAGES }, (_, i) => ({ page: i + 1, surah_start: 1, ayah_start: i + 1, surah_end: 1, ayah_end: i + 1 }));
    }
    if (sql.includes("FROM quran_text")) {
      return Array.from({ length: PAGES }, (_, i) => ({ surah: 1, ayah: i + 1, text_qcf2: "G1 G2", text_uthmani: "x", v2_page: i + 1 }));
    }
    if (sql.includes("FROM surahs")) {
      return [{ number: 1, name_arabic: "سورة", name_english: "Fixture", ayah_count: PAGES, revelation_type: "Meccan" }];
    }
    if (sql.includes("FROM page_lines") || sql.includes("FROM juz_map")) return [];
    throw new Error(`Unexpected read: ${sql}`);
  }),
};

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return {
    ...actual,
    useSettings: () => ({
      fontSize: actual.FONT_SIZE_STEPS_MOBILE[actual.DEFAULT_FONT_SIZE_INDEX],
      fontSizeIndex: actual.DEFAULT_FONT_SIZE_INDEX,
      lineHeight: actual.FONT_SIZE_LINE_HEIGHTS_MOBILE[actual.DEFAULT_FONT_SIZE_INDEX],
      pageScroll: "vertical",
      isRTL: false,
      isDark: false,
      uiLanguage: "en",
      quranRenderFontStyle: "qcf2",
    }),
  };
});
jest.mock("@/components/mushaf/MushafPage", () => ({
  ...jest.requireActual("@/components/mushaf/MushafPage"),
  MushafPage: () => null,
  loadPageWordsData: async () => null,
}));
jest.mock("@/components/mushaf/AyahDetailModal", () => ({ AyahDetailModal: () => null }));
jest.mock("@/components/mushaf/JuzNameText", () => ({ JuzNameText: () => null }));
jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => true }));
jest.mock("@/lib/fonts/loader", () => ({
  isSurahNameFontLoaded: () => true,
  loadSurahNameFont: async () => undefined,
  loadQuranPageFont: async () => undefined,
  surahNameFontName: () => "FixtureSurahFont",
  surahNameGlyph: () => undefined,
}));

type Props = ComponentProps<typeof PageMushaf>;
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");
let scrollTo: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  Dimensions.set({
    window: { width: 390, height: 844, scale: 1, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 1, fontScale: 1 },
  });
  scrollTo = jest.spyOn(FlatList.prototype, "scrollToOffset").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

async function flush(ms = 0) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

function setup(props: Partial<Props>) {
  const onPageChange = jest.fn<void, [number]>();
  const view = render(<PageMushaf currentPage={1} onPageChange={onPageChange} {...props} />);
  const list = () => view.UNSAFE_getByType(FlatList);
  const pageStart = (page: number) => list().props.getItemLayout(null, page - 1).offset as number;
  const offsets = () => scrollTo.mock.calls.map(([params]) => params.offset as number);
  // The browser reports each scroll, and the list's content size, back to the list.
  const scrolled = (y: number) =>
    act(() => {
      list().props.onScroll({ nativeEvent: { contentOffset: { x: 0, y } } });
    });
  const contentSized = (height: number) =>
    act(() => {
      list().props.onContentSizeChange(390, height);
    });
  const rerender = (next: Partial<Props>) =>
    view.rerender(<PageMushaf currentPage={1} onPageChange={onPageChange} {...props} {...next} />);
  return { view, list, pageStart, offsets, scrolled, contentSized, rerender, onPageChange };
}

it("stays on the requested page when the target arrives after the pages loaded and resized", async () => {
  // Cold start: the reader shows page 1 while the target is still on its way.
  const reader = setup({ currentPage: 1 });
  await flush();
  const before = reader.pageStart(303);
  // The reader's first layout is narrower than the window, so every page height is rebuilt while it is
  // still on page 1 and before the list has reported a content size.
  const container = reader.view.UNSAFE_getAllByType(View).find((node) => typeof node.props.onLayout === "function");
  await act(async () => {
    container?.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 700 } } });
  });
  expect(reader.pageStart(303)).not.toBe(before);

  // The continue reading target, 18:84 on page 303, is committed through the page prop.
  scrollTo.mockClear();
  reader.rerender({ currentPage: 303 });
  const target = reader.pageStart(303);
  expect(reader.offsets()).toEqual([target]);
  reader.scrolled(target);
  // The content then reports its full size and the list's timers run.
  reader.contentSized(target + 50_000);
  await flush(1600);

  // Before the fix the anchor planted for the resize kept scrolling back to page 1.
  expect(reader.offsets().every((offset) => offset === target)).toBe(true);
  expect(reader.onPageChange.mock.calls.map(([page]) => page)).toEqual([303]);
});

it("ignores a late copy of a page it reported and still follows a new request", async () => {
  const reader = setup({ currentPage: 1 });
  await flush();
  // The list opens at the top, then the reader scrolls through pages 5 and 6.
  reader.scrolled(0);
  reader.scrolled(reader.pageStart(5));
  reader.scrolled(reader.pageStart(6));
  expect(reader.onPageChange.mock.calls.map(([page]) => page)).toEqual([5, 6]);

  // The parent passes 5 back a render late, then 6.
  scrollTo.mockClear();
  reader.rerender({ currentPage: 5 });
  reader.rerender({ currentPage: 6 });
  await flush();
  expect(reader.offsets()).toEqual([]);

  // A page the reader did not report is a request.
  reader.rerender({ currentPage: 42 });
  expect(reader.offsets()).toEqual([reader.pageStart(42)]);
});

describe("page rail", () => {
  function renderRail(onCommit: jest.Mock, currentPage: number) {
    const view = render(
      <MushafSlider currentPage={currentPage} onCommit={onCommit} onExpand={() => undefined} index={null} />,
    );
    const rail = view.UNSAFE_getByType(FlatList);
    return { view, rail };
  }

  it("does not commit a page for a scroll the rail made itself", async () => {
    const onCommit = jest.fn();
    const { view, rail } = renderRail(onCommit, 42);
    const host = view.UNSAFE_getAllByType(View).find((node) => typeof node.props.onLayout === "function");
    await act(async () => {
      host?.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 30 } } });
    });
    // The reader moves to page 43, and the rail scrolls to follow it.
    view.rerender(<MushafSlider currentPage={43} onCommit={onCommit} onExpand={() => undefined} index={null} />);
    // On a busy start the event for the rail's earlier scroll to page 42 arrives after its guard.
    await flush(200);
    const page42 = (604 - 42) * 26;
    act(() => {
      rail.props.onScroll({ nativeEvent: { contentOffset: { x: page42, y: 0 } } });
    });
    await flush(400);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
