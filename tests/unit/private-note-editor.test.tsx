import React from "react";
import { Modal } from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { User } from "@supabase/supabase-js";
import { PrivateNoteSheet } from "@/components/notes/PrivateNoteSheet";
import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import { useAuthStore } from "@/lib/auth/store";
import { strings } from "@/lib/i18n/strings";
import { createPrivateNote, listPrivateNotesForAyah, updatePrivateNote, type PrivateNote } from "@/lib/notes/queries";

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => true }));

let mockLanguage: "en" | "ar" = "en";
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    uiLanguage: mockLanguage,
    isRTL: mockLanguage === "ar",
    isDark: false,
    effectiveTheme: "white",
    themeSurface: "#fff",
    themeColors: { surface: "#fff", surfaceLow: "#eee" },
  }),
}));

const mockDb = {
  getFirstAsync: jest.fn(async (_sql: string, _params?: unknown[]) => ({
    name_arabic: "البقرة",
    name_english: "Al-Baqarah",
  })),
  getAllAsync: jest.fn(async (_sql: string, _params?: unknown[]) => [
    { text_uthmani: "ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ" },
  ]),
};
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));

jest.mock("@/lib/notes/queries", () => {
  class DuplicatePrivateNoteError extends Error {}
  return {
    createPrivateNote: jest.fn(),
    updatePrivateNote: jest.fn(),
    listPrivateNotesForAyah: jest.fn(async () => []),
    isDuplicatePrivateNoteError: (error: unknown) => error instanceof DuplicatePrivateNoteError,
    DuplicatePrivateNoteError,
  };
});
const { DuplicatePrivateNoteError } = jest.requireMock<{ DuplicatePrivateNoteError: new () => Error }>(
  "@/lib/notes/queries",
);

const en = strings.en;

function note(content: string, id = "note-1"): PrivateNote {
  return {
    id,
    surah: 2,
    ayahStart: 2,
    ayahEnd: 2,
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    qfNoteId: null,
    qfSyncedAt: null,
    qfSyncError: null,
    qfRangesJson: null,
  };
}

function setup(props: Partial<React.ComponentProps<typeof PrivateNoteSheet>> = {}) {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  const view = render(
    <OperationNoticeProvider ready>
      <PrivateNoteSheet open surah={2} ayahStart={2} ayahEnd={2} onClose={onClose} onSaved={onSaved} {...props} />
    </OperationNoticeProvider>,
  );
  const input = () => view.getByPlaceholderText(strings[mockLanguage].privateNotePlaceholder);
  return { view, onClose, onSaved, input };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  act(() => useAuthStore.setState({ user: { id: "user-1" } as User }));
});
afterEach(() => {
  cleanup();
  act(() => useAuthStore.setState({ user: null }));
});

it("closes an untouched editor at once", () => {
  const { view, onClose } = setup();
  fireEvent.press(view.getByText(en.flashcardsCancel));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(view.queryByText(en.noteDiscardTitle)).toBeNull();
});

it("asks before Cancel or Back discards typed text, and Keep editing keeps it", () => {
  const { view, onClose, input } = setup();
  fireEvent.changeText(input(), "Remember the guidance here");
  fireEvent.press(view.getByText(en.flashcardsCancel));
  expect(view.getByText(en.noteDiscardTitle)).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.press(view.getByText(en.discardChangesKeepEditing));
  expect(view.queryByText(en.noteDiscardTitle)).toBeNull();
  expect(input().props.value).toBe("Remember the guidance here");

  // Android Back reaches the sheet's Modal; the same guard answers it.
  act(() => view.UNSAFE_getAllByType(Modal)[0].props.onRequestClose());
  expect(view.getByText(en.noteDiscardTitle)).toBeTruthy();
  fireEvent.press(view.getByText(en.discardChangesConfirm));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("does not count whitespace-only edits of a saved note as changes", () => {
  const { view, onClose, input } = setup({ note: note("Saved text") });
  fireEvent.changeText(input(), "  Saved text \n");
  fireEvent.press(view.getByText(en.flashcardsCancel));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("clears the draft and closes without asking when the account changes", () => {
  const { view, onClose, input } = setup();
  fireEvent.changeText(input(), "A private draft for this account");
  act(() => useAuthStore.setState({ user: { id: "user-2" } as User }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(view.queryByText(en.noteDiscardTitle)).toBeNull();
  expect(input().props.value).toBe("");
});

it("keeps the draft and its dirty state after a failed save, then retries", async () => {
  jest.mocked(createPrivateNote).mockRejectedValueOnce(new Error("disk full"));
  const { view, onClose, onSaved, input } = setup();
  fireEvent.changeText(input(), "Keep this after the failure");
  await act(async () => {
    fireEvent.press(view.getByText(en.privateNoteSave));
  });
  expect(view.getByText(en.privateNoteSaveFailed)).toBeTruthy();
  expect(input().props.value).toBe("Keep this after the failure");
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.press(view.getByText(en.flashcardsCancel));
  expect(view.getByText(en.noteDiscardTitle)).toBeTruthy();
  fireEvent.press(view.getByText(en.discardChangesKeepEditing));

  jest.mocked(createPrivateNote).mockResolvedValueOnce(note("Keep this after the failure"));
  await act(async () => {
    fireEvent.press(view.getByText(en.sharedTryAgain));
  });
  expect(createPrivateNote).toHaveBeenCalledTimes(2);
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(view.getByText(en.privateNoteSaved)).toBeTruthy();
});

it("offers the existing note after a duplicate and switches the editor to it", async () => {
  const existing = note("Same words", "note-existing");
  jest.mocked(createPrivateNote).mockRejectedValueOnce(new DuplicatePrivateNoteError());
  jest.mocked(listPrivateNotesForAyah).mockResolvedValueOnce([existing]);
  const { view, onClose, input } = setup();
  fireEvent.changeText(input(), "Same words ");
  await act(async () => {
    fireEvent.press(view.getByText(en.privateNoteSave));
  });
  await waitFor(() => expect(view.getByText(en.noteOpenExisting)).toBeTruthy());
  fireEvent.press(view.getByText(en.noteOpenExisting));
  expect(view.getByText(en.privateNoteEdit)).toBeTruthy();
  expect(input().props.value).toBe("Same words");
  jest.mocked(updatePrivateNote).mockResolvedValueOnce(undefined);
  fireEvent.press(view.getByText(en.flashcardsCancel));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("shows the minimum from the start and the counter past 9000 characters, in Arabic digits", () => {
  mockLanguage = "ar";
  const { view, input } = setup();
  expect(view.getByText("٦ أحرف على الأقل")).toBeTruthy();
  fireEvent.changeText(input(), "ا".repeat(9000));
  expect(view.queryByText(/١٠٠٠٠/)).toBeNull();
  fireEvent.changeText(input(), "ا".repeat(9001));
  expect(view.getByText("٩٠٠١ / ١٠٠٠٠")).toBeTruthy();
});

it("shows the ayah's Unicode text and localized reference", async () => {
  const { view } = setup();
  await waitFor(() => expect(view.getAllByText("ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ").length).toBeGreaterThan(0));
  expect(view.getByText("Al-Baqarah ⁦2⁩")).toBeTruthy();
  expect(mockDb.getAllAsync.mock.calls[0][0]).toContain("text_uthmani");
});
