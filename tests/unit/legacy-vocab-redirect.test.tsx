import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react-native";
import LegacyVocabularyRedirect from "@/app/flashcards/vocab";
import { MEANINGS_DECK_ID } from "@/lib/fsrs/queries";

const mockRedirects: unknown[] = [];
const mockDatabaseAccess = jest.fn(() => {
  throw new Error("The legacy vocabulary route must redirect before touching the database");
});

jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: unknown }) => {
    mockRedirects.push(href);
    return null;
  },
}));
jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDatabaseAccess(),
  useDatabaseStatus: () => mockDatabaseAccess(),
}));

describe("/flashcards/vocab legacy route", () => {
  beforeEach(() => {
    mockRedirects.length = 0;
    mockDatabaseAccess.mockClear();
  });

  it("replaces itself with the Vocabulary Review deck session on its first render", () => {
    render(<LegacyVocabularyRedirect />);

    expect(mockRedirects).toEqual([{ pathname: "/flashcards/session", params: { deckId: MEANINGS_DECK_ID } }]);
    expect(MEANINGS_DECK_ID).toBe("meanings");
  });

  it("redirects before any queue load, so the legacy vocab_cards queue is never read or changed", () => {
    render(<LegacyVocabularyRedirect />);

    expect(mockDatabaseAccess).not.toHaveBeenCalled();
    const source = fs.readFileSync(path.join(process.cwd(), "app/flashcards/vocab.tsx"), "utf8");
    expect(source).not.toMatch(/vocab_cards\s*(SET|WHERE)|useDatabase|loadReviewQueue|DELETE FROM/);
    expect(fs.existsSync(path.join(process.cwd(), "lib/vocab/queries.ts"))).toBe(false);
  });
});
