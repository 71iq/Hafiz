import React from "react";
import { render, screen } from "@testing-library/react-native";
import { IrabTab } from "@/components/mushaf/word-tabs/IrabTab";

// 17:106 stores the phrase "على الناس" once per word with the same text and analysis.
const rows = [
  { surah: 17, ayah: 106, word_pos: 3, word: "لتقرأه", irab: "اللام لام التعليل" },
  { surah: 17, ayah: 106, word_pos: 4, word: "على الناس", irab: "متعلقان بتقرأه" },
  { surah: 17, ayah: 106, word_pos: 5, word: "على الناس", irab: "متعلقان بتقرأه" },
];
const mockDb = {};
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/i18n/useStrings", () => ({
  ...jest.requireActual("@/lib/i18n/useStrings"),
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings.en,
}));
jest.mock("@/lib/word/queries", () => ({
  ...jest.requireActual("@/lib/word/queries"),
  fetchWordIrabDaasForAyah: async () => rows,
}));

describe("IrabTab", () => {
  it("shows a phrase stored once per word a single time", async () => {
    render(<IrabTab surah={17} ayah={106} wordPos={5} />);

    expect(await screen.findByText("لتقرأه")).toBeTruthy();
    expect(screen.getAllByText("على الناس")).toHaveLength(1);
    expect(screen.getAllByText("متعلقان بتقرأه")).toHaveLength(1);
  });
});
