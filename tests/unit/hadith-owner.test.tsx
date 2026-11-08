import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { HadithTab } from "@/components/mushaf/ayah-tabs/HadithTab";
import { strings } from "@/lib/i18n/strings";
import type { CachedQfHadith } from "@/lib/quran-foundation/cache";
import type { QfHadithResponse, QfContentError } from "@/lib/quran-foundation/content";

let mockLanguage: "en" | "ar" = "en";
const mockDb = {};
const mockRead = jest.fn<Promise<CachedQfHadith | null>, [unknown, number, number, "en" | "ar", number, number]>();
const mockFetch = jest.fn<Promise<QfHadithResponse | QfContentError>, [number, number, "en" | "ar", number, number]>();
const mockWrite = jest.fn<Promise<void>, [unknown, QfHadithResponse, number, number]>();
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ uiLanguage: mockLanguage, isDark: false, isRTL: mockLanguage === "ar" }),
}));
jest.mock("@/lib/i18n/useStrings", () => ({
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings[mockLanguage],
}));
jest.mock("@/lib/quran-foundation/cache", () => ({
  readCachedAyahHadiths: (...args: Parameters<typeof mockRead>) => mockRead(...args),
  writeCachedAyahHadiths: (...args: Parameters<typeof mockWrite>) => mockWrite(...args),
}));
jest.mock("@/lib/quran-foundation/content", () => ({
  fetchQfAyahHadiths: (...args: Parameters<typeof mockFetch>) => mockFetch(...args),
}));
function page(
  body: string,
  options: { surah?: number; ayah?: number; language?: "en" | "ar"; page?: number; more?: boolean } = {},
): QfHadithResponse {
  return {
    ok: true,
    verseKey: `${options.surah ?? 2}:${options.ayah ?? 1}`,
    language: options.language ?? "en",
    direction: options.language === "ar" ? "rtl" : "ltr",
    page: options.page ?? 1,
    limit: 4,
    hasMore: options.more ?? false,
    hadiths: body ? [{ urn: options.page ?? 1, hadith: [{ body }] }] : [],
    fetchedAt: "2026-01-01T00:00:00Z",
  };
}
function cached(body: string, stale = false): CachedQfHadith {
  return { ...page(body), isStale: stale };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Not initialized");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Not initialized");
  };
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settle<T>(pending: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}
beforeEach(() => {
  mockLanguage = "en";
  mockRead.mockReset().mockResolvedValue(null);
  mockFetch.mockReset().mockResolvedValue(page("current"));
  mockWrite.mockReset().mockResolvedValue(undefined);
});

it.each(["ayah", "surah", "language"])("ignores old remote page after %s owner replacement", async (dimension) => {
  const old = deferred<QfHadithResponse | QfContentError>();
  const next = deferred<QfHadithResponse | QfContentError>();
  mockFetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  if (dimension === "language") mockLanguage = "ar";
  view.rerender(<HadithTab surah={dimension === "surah" ? 3 : 2} ayah={dimension === "ayah" ? 2 : 1} />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  await settle(next, page("new owner"));
  expect(view.getByText("new owner")).toBeTruthy();
  await settle(old, page("old owner"));
  expect(view.queryByText("old owner")).toBeNull();
  expect(view.getByText("new owner")).toBeTruthy();
  expect(mockWrite).toHaveBeenCalledWith(mockDb, expect.objectContaining({ verseKey: "2:1" }), 2, 1);
});
it("does not show an old response while the new owner is still loading", async () => {
  const old = deferred<QfHadithResponse | QfContentError>();
  const next = deferred<QfHadithResponse | QfContentError>();
  mockFetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  view.rerender(<HadithTab surah={2} ayah={2} />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  await settle(old, page("old early"));
  expect(view.queryByText("old early")).toBeNull();
  await settle(next, page("new late"));
  expect(view.getByText("new late")).toBeTruthy();
});
it("ignores an old cache read after a new owner page is visible", async () => {
  const old = deferred<CachedQfHadith | null>();
  mockRead.mockReturnValueOnce(old.promise);
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  view.rerender(<HadithTab surah={2} ayah={2} />);
  await waitFor(() => expect(view.getByText("current")).toBeTruthy());
  await settle(old, cached("old cache"));
  expect(view.queryByText("old cache")).toBeNull();
  expect(view.getByText("current")).toBeTruthy();
});
it("keeps an old stale-cache refresh out of the replacement display", async () => {
  const old = deferred<QfHadithResponse | QfContentError>();
  mockRead.mockResolvedValueOnce(cached("stale cache", true));
  mockFetch.mockReturnValueOnce(old.promise);
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(view.getByText("stale cache")).toBeTruthy());
  view.rerender(<HadithTab surah={2} ayah={2} />);
  await waitFor(() => expect(view.getByText("current")).toBeTruthy());
  await settle(old, page("old refresh"));
  expect(view.queryByText("old refresh")).toBeNull();
  expect(view.getByText("current")).toBeTruthy();
  expect(mockWrite).toHaveBeenCalledWith(mockDb, page("old refresh"), 2, 1);
});
it("does not add an old load-more page to the new owner", async () => {
  const old = deferred<QfHadithResponse | QfContentError>();
  mockFetch.mockResolvedValueOnce(page("first", { more: true })).mockReturnValueOnce(old.promise);
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(view.getByText("first")).toBeTruthy());
  fireEvent.press(view.getByText(strings.en.hadithLoadMore));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  view.rerender(<HadithTab surah={2} ayah={2} />);
  await waitFor(() => expect(view.getByText("current")).toBeTruthy());
  await settle(old, page("old second", { page: 2 }));
  expect(view.queryByText("old second")).toBeNull();
  expect(view.getByText("current")).toBeTruthy();
});
it("ignores an old retry result after an owner replacement", async () => {
  const old = deferred<QfHadithResponse | QfContentError>();
  mockFetch
    .mockResolvedValueOnce({ ok: false, code: "upstream", message: "synthetic" })
    .mockReturnValueOnce(old.promise);
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(view.getByText(strings.en.hadithRetry)).toBeTruthy());
  fireEvent.press(view.getByText(strings.en.hadithRetry));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  view.rerender(<HadithTab surah={2} ayah={2} />);
  await waitFor(() => expect(view.getByText("current")).toBeTruthy());
  await settle(old, page("old retry"));
  expect(view.queryByText("old retry")).toBeNull();
  expect(view.getByText("current")).toBeTruthy();
});
it("does not publish an old error into the replacement empty state", async () => {
  const old = deferred<QfHadithResponse | QfContentError>();
  mockFetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(""));
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  view.rerender(<HadithTab surah={2} ayah={2} />);
  await waitFor(() => expect(view.getByText(strings.en.hadithEmpty)).toBeTruthy());
  await settle(old, { ok: false, code: "upstream", message: "old error" });
  expect(view.queryByText(strings.en.qfContentUnavailable)).toBeNull();
  expect(view.getByText(strings.en.hadithEmpty)).toBeTruthy();
});
it("same owner rerender retains pages and does not refetch", async () => {
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(view.getByText("current")).toBeTruthy());
  view.rerender(<HadithTab surah={2} ayah={1} />);
  expect(view.getByText("current")).toBeTruthy();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
it("uses fresh cached content without a remote request", async () => {
  mockRead.mockResolvedValue(cached("fresh cache"));
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(view.getByText("fresh cache")).toBeTruthy());
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockRead).toHaveBeenCalledWith(mockDb, 2, 1, "en", 1, 4);
});
it("shows stale cached content while current refresh is pending then replaces it", async () => {
  const next = deferred<QfHadithResponse | QfContentError>();
  mockRead.mockResolvedValue(cached("stale", true));
  mockFetch.mockReturnValue(next.promise);
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(view.getByText("stale")).toBeTruthy());
  await settle(next, page("refreshed"));
  expect(view.queryByText("stale")).toBeNull();
  expect(view.getByText("refreshed")).toBeTruthy();
  expect(mockWrite).toHaveBeenCalledWith(mockDb, page("refreshed"), 2, 1);
});
it("preserves current-owner pagination and exact page arguments", async () => {
  mockFetch.mockResolvedValueOnce(page("first", { more: true })).mockResolvedValueOnce(page("second", { page: 2 }));
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(view.getByText("first")).toBeTruthy());
  fireEvent.press(view.getByText(strings.en.hadithLoadMore));
  await waitFor(() => expect(view.getByText("second")).toBeTruthy());
  expect(view.getByText("first")).toBeTruthy();
  expect(mockFetch).toHaveBeenLastCalledWith(2, 1, "en", 2, 4);
  expect(view.queryByText(strings.en.hadithLoadMore)).toBeNull();
});
it("preserves current-owner retry success", async () => {
  mockFetch
    .mockResolvedValueOnce({ ok: false, code: "not_configured", message: "synthetic" })
    .mockResolvedValueOnce(page("retry success"));
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(view.getByText(strings.en.hadithRetry)).toBeTruthy());
  expect(view.getByText(strings.en.qfContentMisconfigured)).toBeTruthy();
  fireEvent.press(view.getByText(strings.en.hadithRetry));
  await waitFor(() => expect(view.getByText("retry success")).toBeTruthy());
  expect(mockFetch).toHaveBeenCalledTimes(2);
});
it("retains correctly keyed cache writes after unmount without contaminating a new mount", async () => {
  const old = deferred<QfHadithResponse | QfContentError>();
  mockFetch.mockReturnValueOnce(old.promise);
  const view = render(<HadithTab surah={2} ayah={1} />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  view.unmount();
  const replacement = render(<HadithTab surah={3} ayah={1} />);
  await waitFor(() => expect(replacement.getByText("current")).toBeTruthy());
  await settle(old, page("after unmount"));
  expect(mockWrite).toHaveBeenCalledWith(mockDb, page("after unmount"), 2, 1);
  expect(replacement.queryByText("after unmount")).toBeNull();
});
