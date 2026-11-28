import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { GoToNavigator } from "@/components/mushaf/GoToNavigator";
import { strings } from "@/lib/i18n/strings";

const mockDb = { getAllAsync: jest.fn() };
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/components/ui/ResponsiveOverlay", () => ({
  ResponsiveOverlay: ({ children }: { children: React.ReactNode }) => children,
  OverlayHeader: () => null,
  OverlayBody: ({ children }: { children: React.ReactNode }) => children,
}));

it("waits for both lists before reporting a search miss and keeps typed references available", async () => {
  const surahs = [{ number: 1, name_english: "The Opener", name_arabic: "الفاتحة" }];
  let finish!: (rows: typeof surahs) => void;
  mockDb.getAllAsync
    .mockReturnValueOnce(new Promise<typeof surahs>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce([]);
  render(<GoToNavigator visible onClose={jest.fn()} onSelectTarget={jest.fn()} />);
  const s = strings.en;
  expect(screen.queryByText(s.noSurahsFound)).toBeNull();
  expect(screen.getByLabelText(s.loading)).toBeTruthy();
  fireEvent.press(screen.getByText(s.tabJuz));
  expect(screen.queryByText(s.noJuzFound)).toBeNull();
  fireEvent.changeText(screen.getByPlaceholderText(s.searchByJuz), "p 300");
  expect(screen.getByRole("button", { name: /300/ })).toBeTruthy();
  fireEvent.press(screen.getByText(s.tabSurah));
  fireEvent.changeText(screen.getByPlaceholderText(s.searchByName), "unmatched");
  expect(screen.queryByText(s.noSurahsFound)).toBeNull();
  await act(async () => finish(surahs));
  expect(screen.getByText(s.noSurahsFound)).toBeTruthy();
  fireEvent.changeText(screen.getByPlaceholderText(s.searchByName), "");
  expect(screen.getByRole("button", { name: "1 The Opener" })).toBeTruthy();
});

it("retries a failed load without showing an empty list while the retry is pending", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    let finish!: (rows: never[]) => void;
    mockDb.getAllAsync
      .mockRejectedValueOnce(new Error("fixture read error"))
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(new Promise<never[]>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce([]);
    render(<GoToNavigator visible onClose={jest.fn()} onSelectTarget={jest.fn()} />);
    const s = strings.en;
    expect(await screen.findByText(s.goToLoadFailed)).toBeTruthy();
    fireEvent.press(screen.getByText(s.errorTryAgain));
    expect(screen.getByLabelText(s.loading)).toBeTruthy();
    expect(screen.queryByText(s.noSurahsFound)).toBeNull();
    await act(async () => finish([]));
    expect(screen.getByText(s.noSurahsFound)).toBeTruthy();
  } finally {
    error.mockRestore();
  }
});
