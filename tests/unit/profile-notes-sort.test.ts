import { sortNotes } from "@/components/profile/ProfileNotesManager";
import type { PrivateNoteSearchResult } from "@/lib/notes/queries";

const note = (id: string, surah: number, ayahStart: number, updatedAt: string): PrivateNoteSearchResult =>
  ({
    id,
    surah,
    ayahStart,
    ayahEnd: ayahStart,
    content: `Synthetic ${id}`,
    updatedAt,
    surahNameArabic: "",
    surahNameEnglish: "",
  }) as PrivateNoteSearchResult;

const notes = [
  note("a", 2, 255, "2026-01-02T00:00:00.000Z"),
  note("b", 1, 1, "2026-01-01T00:00:00.000Z"),
  note("c", 2, 1, "2026-01-03T00:00:00.000Z"),
];

describe("all-notes sort", () => {
  it("lists recently edited notes first", () => {
    expect(sortNotes(notes, "recent").map((row) => row.id)).toEqual(["c", "a", "b"]);
  });
  it("lists notes in Quran order by surah, then ayah", () => {
    expect(sortNotes(notes, "surah").map((row) => row.id)).toEqual(["b", "c", "a"]);
  });
  it("does not reorder the caller's list", () => {
    sortNotes(notes, "surah");
    expect(notes.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });
});
