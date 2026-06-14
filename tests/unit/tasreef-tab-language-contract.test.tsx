import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { TasreefTab } from "@/components/mushaf/word-tabs/TasreefTab";

const mockDb = {
  getFirstAsync: jest.fn(),
};

let mockSettings = {
  isRTL: false,
};

const mockStrings = {
  loading: "Loading",
  rootLabel: "Root",
  lemmaLabel: "Lemma",
  patternLabel: "Pattern",
  noTasreefData: "No morphology data available",
};

jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDb,
}));

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => mockSettings,
}));

jest.mock("@/lib/i18n/useStrings", () => ({
  useStrings: () => mockStrings,
}));

describe("TasreefTab language contract", () => {
  beforeEach(() => {
    mockSettings = { isRTL: false };
    mockDb.getFirstAsync.mockReset();
  });

  it("shows root and lemma in English mode even when no pattern is available", async () => {
    mockDb.getFirstAsync.mockImplementation((query: string) => {
      if (query.includes("FROM word_irab")) {
        return Promise.resolve({
          arabic_word: "يَعْمَهُونَ",
          morphological_tag: null,
          syntactic_function: null,
          root: null,
          lemma: null,
          pattern: null,
        });
      }

      if (query.includes("FROM word_roots")) {
        return Promise.resolve({
          root: "عمه",
          lemma: "يَعْمَهُ",
        });
      }

      return Promise.resolve(null);
    });

    const { getByText, queryByText } = render(<TasreefTab surah={2} ayah={15} wordPos={7} />);

    await waitFor(() => expect(getByText("Root")).toBeTruthy());

    expect(getByText("عمه")).toBeTruthy();
    expect(getByText("Lemma")).toBeTruthy();
    expect(getByText("يَعْمَهُ")).toBeTruthy();
    expect(queryByText("No morphology data available")).toBeNull();
  });
});
