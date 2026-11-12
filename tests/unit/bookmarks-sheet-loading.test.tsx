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
jest.mock("@/lib/settings/context", () => ({ useSettings: () => ({ isDark: false, isRTL: false }) }));
jest.mock("@/lib/i18n/useStrings", () => ({
  interpolate: jest.requireActual<typeof import("@/lib/i18n/useStrings")>("@/lib/i18n/useStrings").interpolate,
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings.en,
}));
jest.mock("@/lib/selection/context", () => ({
  useSelection: () => ({ bookmarksList: mockBookmarks, showToast: jest.fn(), refreshBookmarks: jest.fn() }),
}));
jest.mock("@/lib/selection/queries", () => ({ removeBookmark: jest.fn() }));
jest.mock("@/lib/mushaf/position", () => ({ loadMushafIndex: (...args: unknown[]) => mockLoadIndex(...args) }));
jest.mock("@/components/ui/ResponsiveOverlay", () => ({
  ResponsiveSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? children : null),
  OverlayBody: ({ children }: { children: React.ReactNode }) => children,
  OverlayHeader: () => null,
}));

const index = { surahByNumber: new Map([[2, { number: 2, name_arabic: "البقرة", name_english: "Al-Baqarah" }]]) };

describe("BookmarksSheet loading", () => {
  beforeEach(() => {
    mockLoadIndex.mockReset();
    mockBookmarks = [{ surah: 2, ayah: 255, createdAt: "2026-01-01T00:00:00Z" }];
  });

  it("does not claim there are no bookmarks while surah names load", async () => {
    let resolve: (value: typeof index) => void = () => {};
    mockLoadIndex.mockReturnValue(new Promise((yes) => (resolve = yes)));
    render(<BookmarksSheet visible onClose={jest.fn()} onNavigate={jest.fn()} />);

    expect(screen.queryByText(en.noBookmarks)).toBeNull();
    await act(async () => resolve(index));
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
