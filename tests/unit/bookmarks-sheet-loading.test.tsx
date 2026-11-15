import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { BookmarksSheet } from "@/components/mushaf/BookmarksSheet";
import { strings } from "@/lib/i18n/strings";

const en = strings.en;
let mockBookmarks: { surah: number; ayah: number; createdAt: string }[] = [];
const mockLoadIndex = jest.fn();
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
const mockDb = {};
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/components/ui/EmptyState", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    EmptyState: ({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) => (
      <>
        <Text>{title}</Text>
        {onAction ? (
          <Pressable onPress={onAction}>
            <Text>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </>
    ),
  };
});
let mockOrder: "recent" | "quran" = "recent";
const mockSetOrder = jest.fn();
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ isDark: false, isRTL: false, bookmarksOrder: mockOrder, setBookmarksOrder: mockSetOrder }),
}));
jest.mock("@/lib/i18n/useStrings", () => ({
  interpolate: jest.requireActual<typeof import("@/lib/i18n/useStrings")>("@/lib/i18n/useStrings").interpolate,
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings.en,
}));
const mockShowToast = jest.fn();
const mockRefresh = jest.fn();
jest.mock("@/lib/selection/context", () => ({
  useSelection: () => ({ bookmarksList: mockBookmarks, showToast: mockShowToast, refreshBookmarks: mockRefresh }),
}));
const mockRemoveBookmark = jest.fn();
jest.mock("@/lib/selection/queries", () => ({
  removeBookmark: (...args: unknown[]) => mockRemoveBookmark(...args),
  fetchAyahOpenings: () => Promise.resolve(new Map([["2:255", "ٱللَّهُ لَآ إِلَٰهَ"]])),
}));
jest.mock("@/components/ui/ConfirmDialog", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ConfirmDialog: (props: { visible: boolean; title: string; message: string; confirmLabel: string; error?: string | null; onConfirm: () => void }) =>
      props.visible ? (
        <>
          <Text>{props.title}</Text>
          <Text>{props.message}</Text>
          {props.error ? <Text>{props.error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`confirm ${props.confirmLabel}`} onPress={props.onConfirm}>
            <Text>{props.confirmLabel}</Text>
          </Pressable>
        </>
      ) : null,
  };
});
jest.mock("@/lib/mushaf/position", () => ({ loadMushafIndex: (...args: unknown[]) => mockLoadIndex(...args) }));
jest.mock("@/components/ui/ResponsiveOverlay", () => ({
  ResponsiveSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? children : null),
  OverlayBody: ({ children }: { children: React.ReactNode }) => children,
  OverlayHeader: () => null,
}));

const index = {
  surahByNumber: new Map([
    [2, { number: 2, name_arabic: "البقرة", name_english: "Al-Baqarah" }],
    [18, { number: 18, name_arabic: "الكهف", name_english: "Al-Kahf" }],
  ]),
};

describe("BookmarksSheet loading", () => {
  beforeEach(() => {
    mockLoadIndex.mockReset();
    mockRemoveBookmark.mockReset();
    mockShowToast.mockReset();
    mockOrder = "recent";
    mockBookmarks = [{ surah: 2, ayah: 255, createdAt: "2026-01-01T00:00:00Z" }];
  });

  it("renders the ayah chip at once and fills the surah name when it loads", async () => {
    let resolve: (value: typeof index) => void = () => {};
    mockLoadIndex.mockReturnValue(new Promise((yes) => (resolve = yes)));
    render(<BookmarksSheet visible onClose={jest.fn()} onNavigate={jest.fn()} />);

    expect(screen.queryByText(en.noBookmarks)).toBeNull();
    expect(screen.getByText("2:255")).toBeTruthy();
    await act(async () => resolve(index));
    expect(screen.getByText("ٱللَّهُ لَآ إِلَٰهَ")).toBeTruthy();
    expect(screen.getByText("Al-Baqarah")).toBeTruthy();
    expect(screen.getByText("2:255")).toBeTruthy();
  });

  it("shows an error with a retry when surah names fail to load", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockLoadIndex.mockRejectedValueOnce(new Error("db closed")).mockResolvedValueOnce(index);
    render(<BookmarksSheet visible onClose={jest.fn()} onNavigate={jest.fn()} />);

    expect(await screen.findByText(en.bookmarksLoadFailed)).toBeTruthy();
    fireEvent.press(screen.getByText(en.errorTryAgain));
    expect(await screen.findByText("Al-Baqarah")).toBeTruthy();
    warn.mockRestore();
  });

  it("shows the empty state when there are no bookmarks", () => {
    mockBookmarks = [];
    render(<BookmarksSheet visible onClose={jest.fn()} onNavigate={jest.fn()} />);
    expect(screen.getByText(en.noBookmarks)).toBeTruthy();
    expect(mockLoadIndex).not.toHaveBeenCalled();
  });

});

describe("BookmarksSheet search, order and removal", () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ surah: i % 2 === 0 ? 18 : 2, ayah: i + 1, createdAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));

  beforeEach(() => {
    mockLoadIndex.mockReset();
    mockLoadIndex.mockResolvedValue(index);
    mockRemoveBookmark.mockReset();
    mockOrder = "recent";
  });

  it("shows no search field for ten bookmarks", async () => {
    mockBookmarks = many(10);
    render(<BookmarksSheet visible onClose={jest.fn()} onNavigate={jest.fn()} />);
    await act(async () => {});
    expect(screen.queryByPlaceholderText(en.searchBookmarks)).toBeNull();
  });

  it("shows the search field for eleven bookmarks and filters by surah name or number", async () => {
    mockBookmarks = many(11);
    render(<BookmarksSheet visible onClose={jest.fn()} onNavigate={jest.fn()} />);
    await act(async () => {});
    const field = screen.getByPlaceholderText(en.searchBookmarks);
    fireEvent.changeText(field, "kahf");
    expect(screen.queryByText("2:2")).toBeNull();
    expect(screen.getByText("18:1")).toBeTruthy();
    fireEvent.changeText(field, "2");
    expect(screen.getByText("2:2")).toBeTruthy();
    expect(screen.queryByText("18:1")).toBeNull();
  });

  it("keeps the eleven-bookmark search visible after a viewport change", async () => {
    mockBookmarks = many(11);
    const view = render(<BookmarksSheet visible onClose={jest.fn()} onNavigate={jest.fn()} />);
    await act(async () => {});
    view.rerender(<BookmarksSheet visible onClose={jest.fn()} onNavigate={jest.fn()} />);
    expect(screen.getByPlaceholderText(en.searchBookmarks)).toBeTruthy();
  });

  it("orders by Quran position when that order is remembered", async () => {
    mockOrder = "quran";
    mockBookmarks = [
      { surah: 18, ayah: 10, createdAt: "2026-01-03T00:00:00Z" },
      { surah: 2, ayah: 255, createdAt: "2026-01-02T00:00:00Z" },
      { surah: 2, ayah: 1, createdAt: "2026-01-01T00:00:00Z" },
    ];
    render(<BookmarksSheet visible onClose={jest.fn()} onNavigate={jest.fn()} />);
    await act(async () => {});
    const refs = screen.getAllByText(/^\d+:\d+$/).map((node) => node.props.children);
    expect(refs).toEqual(["2:1", "2:255", "18:10"]);
    fireEvent.press(screen.getByText(en.bookmarksOrderRecent));
    expect(mockSetOrder).toHaveBeenCalledWith("recent");
  });

  it("asks a named confirmation and keeps the dialog with an error when removal fails", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockBookmarks = [{ surah: 2, ayah: 255, createdAt: "2026-01-01T00:00:00Z" }];
    mockRemoveBookmark.mockRejectedValueOnce(new Error("queue full")).mockResolvedValueOnce(undefined);
    render(<BookmarksSheet visible onClose={jest.fn()} onNavigate={jest.fn()} />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Remove bookmark for Al-Baqarah 2:255"));
    expect(screen.getByText("Al-Baqarah 2:255 will be removed from your bookmarks.")).toBeTruthy();
    expect(screen.queryByText(/ask again/i)).toBeNull();
    expect(mockRemoveBookmark).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(screen.getByLabelText(`confirm ${en.removeBookmark}`)));
    expect(screen.getByText(en.bookmarkActionFailed)).toBeTruthy();
    expect(screen.getByText("2:255")).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByLabelText(`confirm ${en.removeBookmark}`)));
    expect(mockRemoveBookmark).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(en.removeBookmarkConfirmTitle)).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith(en.bookmarkRemoved);
    warn.mockRestore();
  });
});
