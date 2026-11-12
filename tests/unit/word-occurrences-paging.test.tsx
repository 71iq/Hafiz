import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { OccurrencesTab } from "@/components/mushaf/word-tabs/OccurrencesTab";

const TOTAL = 120;
const rows = Array.from({ length: TOTAL }, (_, i) => ({ surah: 2, ayah: i + 1, word_pos: 1, word_text: `w${i + 1}` }));
const mockDb = {
  getFirstAsync: jest.fn(async (sql: string) => (sql.includes("COUNT(*)") ? { n: TOTAL } : null)),
  getAllAsync: jest.fn(async (_sql: string, [, limit, offset]: [string, number, number]) =>
    rows.slice(offset, offset + limit),
  ),
};
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/word/context", () => ({ useWordInteraction: () => ({ navigateToAyah: jest.fn() }) }));
jest.mock("@/lib/i18n/useStrings", () => ({
  ...jest.requireActual("@/lib/i18n/useStrings"),
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings.en,
}));
jest.mock("@/lib/word/queries", () => ({
  ...jest.requireActual("@/lib/word/queries"),
  fetchWordRoot: async () => ({ root: "قول" }),
}));

describe("OccurrencesTab", () => {
  it("renders a root's occurrences a page at a time instead of all at once", async () => {
    render(<OccurrencesTab surah={2} ayah={1} wordPos={1} />);

    expect(await screen.findByText("120 occurrences")).toBeTruthy();
    expect(screen.getByText("w50")).toBeTruthy();
    expect(screen.queryByText("w51")).toBeNull();

    fireEvent.press(screen.getByText("Show more (70 left)"));
    expect(await screen.findByText("w100")).toBeTruthy();
    expect(screen.queryByText("w101")).toBeNull();

    fireEvent.press(screen.getByText("Show more (20 left)"));
    expect(await screen.findByText("w120")).toBeTruthy();
    expect(screen.queryByText(/Show more/)).toBeNull();
  });
});
