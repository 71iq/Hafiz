import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { SearchCommand } from "@/components/SearchCommand";
import { strings } from "@/lib/i18n/strings";

function deferred<T>() {
  let complete: ((value: T) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  return {
    promise,
    resolve(value: T) {
      if (!complete) throw new Error("Missing resolver");
      complete(value);
    },
    reject(error: Error) {
      if (!fail) throw new Error("Missing rejecter");
      fail(error);
    },
  };
}
const row = (text: string, ayah = 1, surah = 2) => ({
  surah,
  ayah,
  text_uthmani: text,
  text_en: null,
  name_arabic: "سورة",
  name_english: "Surah",
});
type TextRow = ReturnType<typeof row>;
type RootRow = TextRow & { word_pos: number; word_text: string; root: string; lemma: string };
type IndexRow = { root: string; lemma: string | null; word_text: string | null };
type HistoryRow = { id: number; query: string; mode: string; created_at: string };
let mockLanguage: "ar" | "en" = "en";
let mockHistory: HistoryRow[] = [];
const mockTextRequests: { sql: string; params: readonly unknown[]; pending: ReturnType<typeof deferred<TextRow[]>> }[] =
  [];
const mockRootRequests: { sql: string; params: readonly unknown[]; pending: ReturnType<typeof deferred<RootRow[]>> }[] =
  [];
const mockIndexRequests: ReturnType<typeof deferred<IndexRow[]>>[] = [];
const mockGetAll = jest.fn((sql: string, params: readonly unknown[] = []) => {
  if (sql.includes("FROM search_history")) return Promise.resolve(mockHistory);
  if (sql.includes("SELECT root, lemma, word_text")) {
    const pending = deferred<IndexRow[]>();
    mockIndexRequests.push(pending);
    return pending.promise;
  }
  if (sql.includes("FROM word_roots wr")) {
    const pending = deferred<RootRow[]>();
    mockRootRequests.push({ sql, params, pending });
    return pending.promise;
  }
  if (sql.includes("FROM quran_text q")) {
    const pending = deferred<TextRow[]>();
    mockTextRequests.push({ sql, params, pending });
    return pending.promise;
  }
  throw new Error(`Unexpected fixture SQL: ${sql}`);
});
const mockRun = jest.fn(async (_sql: string, _params?: readonly unknown[]) => ({ changes: 1, lastInsertRowId: 1 }));
const mockDb = { getAllAsync: mockGetAll, runAsync: mockRun };
const mockClearTooltip = jest.fn();
const mockCloseDetail = jest.fn();
const mockNavigate = jest.fn();
const mockPendingLink = jest.fn();
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ isDark: false, isRTL: mockLanguage === "ar", uiLanguage: mockLanguage }),
}));
jest.mock("@/lib/word/context", () => ({
  useWordInteraction: () => ({ clearTooltip: mockClearTooltip, closeDetail: mockCloseDetail }),
}));
jest.mock("expo-router", () => ({ router: { navigate: (path: unknown) => mockNavigate(path) } }));
jest.mock("@/lib/deep-link", () => ({ setPendingDeepLink: (target: unknown) => mockPendingLink(target) }));
jest.mock("@/components/ui/ResponsiveOverlay", () => ({
  ResponsiveSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? children : null),
  OverlayBody: ({ children }: { children: React.ReactNode }) => children,
  OverlayHeader: () => null,
}));
jest.mock("@/components/ui/Skeleton", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { SearchResultsSkeleton: () => <View testID="search-busy" /> };
});
jest.mock("@/components/ui/EmptyState", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text, Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    EmptyState: ({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) => (
      <>
        <Text>{title}</Text>
        {onAction && (
          <Pressable onPress={onAction}>
            <Text>{actionLabel}</Text>
          </Pressable>
        )}
      </>
    ),
  };
});
jest.mock("lucide-react-native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Search: () => null,
    X: () => <View testID="clear-icon" />,
    Clock: () => null,
    ChevronDown: () => null,
    ChevronLeft: () => null,
    ChevronRight: () => null,
  };
});

async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
  });
}
async function advance(ms = 350) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}
function textRequest(index = 0) {
  const request = mockTextRequests[index];
  if (!request) throw new Error(`Missing text request ${index}`);
  return request;
}
function rootRequest(index = 0) {
  const request = mockRootRequests[index];
  if (!request) throw new Error(`Missing root request ${index}`);
  return request;
}
function indexRequest(index = 0) {
  const request = mockIndexRequests[index];
  if (!request) throw new Error(`Missing index request ${index}`);
  return request;
}
const locales: ("ar" | "en")[] = ["ar", "en"];
describe.each(locales)("Search request lifecycle in %s", (language) => {
  let errors: jest.SpyInstance;
  let expectedErrors: Error[];
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockLanguage = language;
    mockHistory = [];
    mockTextRequests.length = 0;
    mockRootRequests.length = 0;
    mockIndexRequests.length = 0;
    expectedErrors = [];
    errors = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    const calls = errors.mock.calls;
    errors.mockRestore();
    jest.useRealTimers();
    expect(calls).toEqual(expectedErrors.map((error) => ["[Search] Error:", error]));
  });
  const mount = (navigate?: (surah: number, ayah: number, wordPos?: number) => void) => {
    const close = jest.fn();
    const view = render(<SearchCommand visible onClose={close} onNavigateToAyah={navigate} />);
    const edit = (value: string) =>
      fireEvent.changeText(view.getByPlaceholderText(strings[language].searchPlaceholder), value);
    const submit = () => fireEvent(view.getByPlaceholderText(strings[language].searchPlaceholder), "submitEditing");
    const visible = (open: boolean) =>
      view.rerender(<SearchCommand visible={open} onClose={close} onNavigateToAyah={navigate} />);
    return { ...view, edit, submit, visible, close };
  };
  async function twoRequests() {
    const view = mount();
    view.edit("older");
    await advance();
    view.edit("newer");
    await advance();
    return view;
  }
  it("keeps newer results and history when old success arrives last", async () => {
    const view = await twoRequests();
    await settle(() => textRequest(1).pending.resolve([row("current result")]));
    await settle(() => textRequest().pending.resolve([row("obsolete result")]));
    expect(view.getByText("current result")).toBeTruthy();
    expect(view.queryByText("obsolete result")).toBeNull();
    expect(mockRun.mock.calls.filter((call) => call[0].startsWith("INSERT")).map((call) => call[1]?.[0])).toEqual([
      "newer",
    ]);
  });
  it("keeps current loading state when old success finishes", async () => {
    const view = await twoRequests();
    await settle(() => textRequest().pending.resolve([row("obsolete result")]));
    expect(view.getByTestId("search-busy")).toBeTruthy();
    expect(mockRun).not.toHaveBeenCalled();
  });
  it("keeps current result after an obsolete error but logs the error", async () => {
    const view = await twoRequests();
    const error = new Error("old SQL failure");
    expectedErrors.push(error);
    await settle(() => textRequest(1).pending.resolve([row("current result")]));
    await settle(() => textRequest().pending.reject(error));
    expect(view.getByText("current result")).toBeTruthy();
    expect(view.queryByText(strings[language].searchFailed)).toBeNull();
  });
  it("keeps current loading state after an obsolete error", async () => {
    const view = await twoRequests();
    const error = new Error("old SQL failure");
    expectedErrors.push(error);
    await settle(() => textRequest().pending.reject(error));
    expect(view.getByTestId("search-busy")).toBeTruthy();
  });
  it("invalidates old work immediately when a new debounce starts", async () => {
    const view = mount();
    view.edit("older");
    await advance();
    view.edit("newer");
    await settle(() => textRequest().pending.resolve([row("obsolete result")]));
    expect(mockTextRequests).toHaveLength(1);
    expect(mockRun).not.toHaveBeenCalled();
    expect(view.queryByText("obsolete result")).toBeNull();
  });
  it("clears a queued debounce", async () => {
    const view = mount();
    view.edit("queued");
    fireEvent.press(view.getByTestId("clear-icon"));
    await advance();
    expect(mockTextRequests).toHaveLength(0);
    expect(view.queryByTestId("search-busy")).toBeNull();
  });
  it("clears pending results and history ownership", async () => {
    const view = mount();
    view.edit("older");
    await advance();
    fireEvent.press(view.getByTestId("clear-icon"));
    expect(view.queryByTestId("search-busy")).toBeNull();
    await settle(() => textRequest().pending.resolve([row("obsolete result")]));
    expect(mockRun).not.toHaveBeenCalled();
    expect(view.queryByText("obsolete result")).toBeNull();
  });
  it("cancels debounce on close and reopens cleanly", async () => {
    const view = mount();
    view.edit("queued");
    view.visible(false);
    await advance();
    view.visible(true);
    await settle();
    expect(mockTextRequests).toHaveLength(0);
    expect(view.queryByTestId("search-busy")).toBeNull();
    expect(view.getByPlaceholderText(strings[language].searchPlaceholder).props.value).toBe("");
  });
  it("ignores old SQL after close and a newer reopened search", async () => {
    const view = mount();
    view.edit("older");
    await advance();
    view.visible(false);
    view.visible(true);
    view.edit("newer");
    await advance();
    await settle(() => textRequest(1).pending.resolve([row("current result")]));
    await settle(() => textRequest().pending.resolve([row("obsolete result")]));
    expect(view.getByText("current result")).toBeTruthy();
    expect(mockRun.mock.calls.filter((call) => call[0].startsWith("INSERT"))).toHaveLength(1);
  });
  it("does not launch queued SQL after unmount", async () => {
    const view = mount();
    view.edit("queued");
    view.unmount();
    await advance();
    expect(mockTextRequests).toHaveLength(0);
  });
  it("does not write history after unmount during SQL", async () => {
    const view = mount();
    view.edit("pending");
    await advance();
    view.unmount();
    await settle(() => textRequest().pending.resolve([row("obsolete result")]));
    expect(mockRun).not.toHaveBeenCalled();
  });
  it("short input stops loading and invalidates older SQL", async () => {
    const view = mount();
    view.edit("older");
    await advance();
    view.edit("a");
    await advance();
    expect(view.queryByTestId("search-busy")).toBeNull();
    await settle(() => textRequest().pending.resolve([row("obsolete result")]));
    expect(mockRun).not.toHaveBeenCalled();
    expect(view.queryByText("obsolete result")).toBeNull();
  });
  it("mode switch cancels queued text SQL", async () => {
    const view = mount();
    view.edit("جاء");
    fireEvent.press(view.getByText(strings[language].searchRootMode));
    await advance();
    expect(mockIndexRequests).toHaveLength(1);
    expect(mockTextRequests).toHaveLength(0);
  });
  it("does not continue an obsolete root index after switching to text", async () => {
    const view = mount();
    view.edit("جاء");
    fireEvent.press(view.getByText(strings[language].searchRootMode));
    fireEvent.press(view.getByText(strings[language].searchTextMode));
    await settle(() => textRequest().pending.resolve([row("current result")]));
    await settle(() => indexRequest().resolve([{ root: "جيأ", lemma: "جَاءَ", word_text: "جَاءَ" }]));
    expect(mockRootRequests).toHaveLength(0);
    expect(view.getByText("current result")).toBeTruthy();
  });
  it.each(["close", "unmount"])("does not continue root lookup after %s", async (action) => {
    const view = mount();
    view.edit("جاء");
    fireEvent.press(view.getByText(strings[language].searchRootMode));
    if (action === "close") view.visible(false);
    else view.unmount();
    await settle(() => indexRequest().resolve([{ root: "جيأ", lemma: "جَاءَ", word_text: "جَاءَ" }]));
    expect(mockRootRequests).toHaveLength(0);
    expect(mockRun).not.toHaveBeenCalled();
  });
  it("ignores root rows after switching to a successful text search", async () => {
    const view = mount();
    view.edit("جاء");
    fireEvent.press(view.getByText(strings[language].searchRootMode));
    await settle(() => indexRequest().resolve([{ root: "جيأ", lemma: "جَاءَ", word_text: "جَاءَ" }]));
    fireEvent.press(view.getByText(strings[language].searchTextMode));
    await settle(() => textRequest().pending.resolve([row("current result")]));
    await settle(() =>
      rootRequest().pending.resolve([{ ...row("old root"), word_pos: 3, word_text: "جاء", root: "جيأ", lemma: "جاء" }]),
    );
    expect(view.getByText("current result")).toBeTruthy();
    expect(mockRun.mock.calls.filter((call) => call[0].startsWith("INSERT")).map((call) => call[1]?.[1])).toEqual([
      "text",
    ]);
  });
  it("submit starts one request and cancels its queued debounce", async () => {
    const view = mount();
    view.edit("queued");
    view.submit();
    await advance();
    expect(mockTextRequests).toHaveLength(1);
  });
  it.each(["text", "root"])("clears completed rows when short-input mode becomes %s", async (mode) => {
    const view = mount();
    view.edit("older");
    await advance();
    await settle(() => textRequest().pending.resolve([row("obsolete result")]));
    view.edit("a");
    fireEvent.press(
      view.getByText(mode === "text" ? strings[language].searchTextMode : strings[language].searchRootMode),
    );
    if (mode === "root") fireEvent.press(view.getByText(strings[language].searchTextMode));
    await advance();
    expect(view.queryByText("obsolete result")).toBeNull();
    expect(view.queryByTestId("search-busy")).toBeNull();
    expect(mockTextRequests).toHaveLength(1);
    expect(mockIndexRequests).toHaveLength(0);
  });
  it("clears a completed error when short input cancels its debounce on a mode change", async () => {
    const view = mount();
    const error = new Error("current SQL failure");
    expectedErrors.push(error);
    view.edit("older");
    await advance();
    await settle(() => textRequest().pending.reject(error));
    view.edit("a");
    fireEvent.press(view.getByText(strings[language].searchRootMode));
    await advance();
    expect(view.queryByText(strings[language].searchFailed)).toBeNull();
    expect(view.queryByTestId("search-busy")).toBeNull();
    expect(mockIndexRequests).toHaveLength(0);
  });
  it("shows a current failure and allows a successful retry", async () => {
    const view = mount();
    const error = new Error("current SQL failure");
    expectedErrors.push(error);
    view.edit("active");
    await advance();
    await settle(() => textRequest().pending.reject(error));
    expect(view.getByText(strings[language].searchFailed)).toBeTruthy();
    fireEvent.press(view.getByText(strings[language].errorTryAgain));
    await settle(() => textRequest(1).pending.resolve([row("retry result")]));
    expect(view.getByText("retry result")).toBeTruthy();
    expect(view.queryByTestId("search-busy")).toBeNull();
  });
  it("preserves parameter binding, grouping and active history SQL order", async () => {
    const view = mount();
    view.edit("  سَلَام  ");
    await advance();
    expect(textRequest().params).toEqual(["سلام", "سَلَام"]);
    expect(textRequest().sql).toContain("LIMIT 200");
    await settle(() =>
      textRequest().pending.resolve([row("first result"), row("second result", 2), row("third result", 1, 3)]),
    );
    expect(view.getByText("first result")).toBeTruthy();
    expect(view.getByText("second result")).toBeTruthy();
    expect(view.getByText("third result")).toBeTruthy();
    expect(mockRun.mock.calls).toEqual([
      ["DELETE FROM search_history WHERE query = ? AND mode = ?", ["سَلَام", "text"]],
      ["INSERT INTO search_history (query, mode, created_at) VALUES (?, ?, ?)", ["سَلَام", "text", expect.any(String)]],
      ["DELETE FROM search_history WHERE id NOT IN (SELECT id FROM search_history ORDER BY created_at DESC LIMIT 10)"],
    ]);
  });
  it("resolves canonical roots, groups lemmas, expands first and navigates word position", async () => {
    const navigate = jest.fn();
    const view = mount(navigate);
    view.edit("جاء");
    fireEvent.press(view.getByText(strings[language].searchRootMode));
    await settle(() =>
      indexRequest().resolve([
        { root: "جيأ", lemma: "جَاءَ", word_text: "فَجَاءَ" },
        { root: "جيء", lemma: "جاءوا", word_text: null },
      ]),
    );
    expect(rootRequest().params).toEqual(["جاء", "جيأ", "جيء"]);
    expect(rootRequest().sql).toContain("WHERE wr.root IN (?,?,?)");
    await settle(() =>
      rootRequest().pending.resolve([
        { ...row("first root result"), word_pos: 3, word_text: "word", root: "جيأ", lemma: "group one" },
        { ...row("second root result", 2), word_pos: 4, word_text: "word", root: "جيأ", lemma: "group one" },
        { ...row("third root result", 3), word_pos: 5, word_text: "word", root: "جيء", lemma: "group two" },
      ]),
    );
    expect(view.getByText("first root result")).toBeTruthy();
    expect(view.queryByText("third root result")).toBeNull();
    fireEvent.press(view.getByText("group two"));
    expect(view.getByText("third root result")).toBeTruthy();
    fireEvent.press(view.getByText("first root result"));
    expect(view.close).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    view.unmount();
    await advance(150);
    expect(navigate).toHaveBeenCalledWith(2, 1, 3);
    expect(mockPendingLink).not.toHaveBeenCalled();
  });
  it("shows a large lemma group in pages instead of rendering every occurrence at once", async () => {
    const view = mount();
    view.edit("قال");
    fireEvent.press(view.getByText(strings[language].searchRootMode));
    await settle(() => indexRequest().resolve([{ root: "قول", lemma: "قَالَ", word_text: "قَالَ" }]));
    await settle(() =>
      rootRequest().pending.resolve(
        Array.from({ length: 45 }, (_, i) => ({
          ...row(`occurrence ${i + 1}`, i + 1),
          word_pos: 1,
          word_text: "word",
          root: "قول",
          lemma: "big group",
        })),
      ),
    );
    expect(view.getByText("occurrence 30")).toBeTruthy();
    expect(view.queryByText("occurrence 31")).toBeNull();
    fireEvent.press(view.getByText(strings[language].listShowMore.replace("{{count}}", "15")));
    expect(view.getByText("occurrence 45")).toBeTruthy();
    expect(view.queryByText(strings[language].listShowMore.replace("{{count}}", "15"))).toBeNull();
  });
  it("preserves fallback deep link and delayed navigation after result tap", async () => {
    const view = mount();
    view.edit("active");
    await advance();
    await settle(() => textRequest().pending.resolve([row("tap result")]));
    fireEvent.press(view.getByText("tap result"));
    expect(mockPendingLink).toHaveBeenCalledWith({ surah: 2, ayah: 1, wordPos: undefined });
    expect(mockNavigate).not.toHaveBeenCalled();
    view.unmount();
    await advance(150);
    expect(mockNavigate).toHaveBeenCalledWith("/(tabs)/mushaf");
  });
  it("reuses history query and mode and clears history explicitly", async () => {
    mockHistory = [{ id: 1, query: "saved query", mode: "text", created_at: "2026-01-01T00:00:00Z" }];
    const view = mount();
    await settle();
    fireEvent.press(view.getByText("saved query"));
    expect(textRequest().params).toEqual(["saved query", "saved query"]);
    fireEvent.press(view.getByTestId("clear-icon"));
    await settle();
    fireEvent.press(view.getByText(strings[language].searchClearHistory));
    await settle();
    expect(mockRun).toHaveBeenCalledWith("DELETE FROM search_history");
    expect(view.queryByText("saved query")).toBeNull();
  });
});
