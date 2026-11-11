import React from "react";
import { act, renderHook } from "@testing-library/react-native";
import {
  addBookmark,
  addHighlightsForSelectionRefs,
  removeBookmark,
  removeHighlightsForAyah,
  replaceAyahHighlight,
} from "@/lib/selection/queries";
import { SelectionProvider, useSelection } from "@/lib/selection/context";
import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import type { AppDatabase } from "@/lib/database/types";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

// Selection imports the QF queue module, which loads the Supabase client. No network is used here.
jest.mock("@/lib/auth/store", () => ({ useAuthStore: { getState: () => ({ user: null, session: null }) } }));
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => false, supabase: {} }));
let mockDatabase: AppDatabase;
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/haptics", () => ({ hapticLight: jest.fn() }));

let store: OutboxDatabase;

function count(table: string, where = "1 = 1") {
  return Number(store.sql.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get()?.count);
}

function highlightColors(surah: number, ayah: number) {
  return store.sql
    .prepare("SELECT color FROM highlights WHERE surah = ? AND ayah = ? AND deleted_at IS NULL ORDER BY id")
    .all(surah, ayah)
    .map((row) => String(row.color));
}

function activeBookmarks() {
  return count("bookmarks", "deleted_at IS NULL");
}

beforeEach(async () => {
  store = await openOutboxDatabase();
  mockDatabase = store.db;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await store.close();
  jest.restoreAllMocks();
});

describe("RF-175 bookmarks, highlights and their upload queues", () => {
  it.each(["sync_queue", "qf_sync_queue"] as const)(
    "adds no bookmark when its %s write fails, then bookmarks and queues once on retry",
    async (table) => {
      store.failQueueInsert(1, table);

      await expect(addBookmark(store.db, 2, 255)).rejects.toThrow(`Synthetic ${table} write failure`);

      expect(count("bookmarks")).toBe(0);
      expect(count("sync_queue")).toBe(0);
      expect(count("qf_sync_queue")).toBe(0);

      await addBookmark(store.db, 2, 255);

      expect(activeBookmarks()).toBe(1);
      expect(count("sync_queue", "table_name = 'bookmarks'")).toBe(1);
      expect(count("qf_sync_queue")).toBe(1);
    },
  );

  it("keeps a bookmark when its removal cannot be queued", async () => {
    await addBookmark(store.db, 2, 255);
    store.failQueueInsert(1, "qf_sync_queue");

    await expect(removeBookmark(store.db, 2, 255)).rejects.toThrow("Synthetic qf_sync_queue write failure");

    expect(activeBookmarks()).toBe(1);
    expect(count("sync_queue", "table_name = 'bookmarks'")).toBe(1);

    await removeBookmark(store.db, 2, 255);

    expect(activeBookmarks()).toBe(0);
    expect(count("sync_queue", "table_name = 'bookmarks'")).toBe(2);
    expect(count("qf_sync_queue", "operation = 'DELETE'")).toBe(1);
  });

  it("highlights every range of a text selection or none of them", async () => {
    const refs = [
      { surah: 2, ayah: 255, wordPos: 1 },
      { surah: 2, ayah: 255, wordPos: 2 },
      { surah: 2, ayah: 256, wordPos: 1 },
    ];
    store.failQueueInsert(2);

    await expect(addHighlightsForSelectionRefs(store.db, refs, "yellow")).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );

    expect(count("highlights")).toBe(0);
    expect(count("sync_queue")).toBe(0);

    await addHighlightsForSelectionRefs(store.db, refs, "yellow");

    expect(count("highlights")).toBe(2);
    expect(count("sync_queue", "table_name = 'highlights' AND operation = 'INSERT'")).toBe(2);
  });

  it("keeps an ayah's highlights when their deletion cannot be queued", async () => {
    await replaceAyahHighlight(store.db, 2, 255, "yellow");
    store.failQueueInsert(1);

    await expect(removeHighlightsForAyah(store.db, 2, 255)).rejects.toThrow("Synthetic sync_queue write failure");

    expect(highlightColors(2, 255)).toEqual(["yellow"]);
    expect(count("sync_queue", "operation = 'DELETE'")).toBe(0);

    await removeHighlightsForAyah(store.db, 2, 255);

    expect(highlightColors(2, 255)).toEqual([]);
    expect(count("sync_queue", "operation = 'DELETE'")).toBe(1);
  });

  it("keeps the previous highlight when a color change cannot be queued", async () => {
    await replaceAyahHighlight(store.db, 2, 255, "yellow");
    // The replacement queues the old highlight's deletion first, then the new highlight.
    store.failQueueInsert(2);

    await expect(replaceAyahHighlight(store.db, 2, 255, "green")).rejects.toThrow("Synthetic sync_queue write failure");

    expect(highlightColors(2, 255)).toEqual(["yellow"]);
    expect(count("sync_queue")).toBe(1);

    await replaceAyahHighlight(store.db, 2, 255, "green");

    expect(highlightColors(2, 255)).toEqual(["green"]);
  });

  it("reports a failed bookmark to the action bar instead of returning silently", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <OperationNoticeProvider ready>
        <SelectionProvider>{children}</SelectionProvider>
      </OperationNoticeProvider>
    );
    const { result } = renderHook(() => useSelection(), { wrapper });
    // The owner runs work in order, so this read settles after the provider's initial loads.
    await act(async () => {
      await store.db.getFirstAsync("SELECT 1");
    });
    act(() => result.current.selectAyah(2, 255));
    store.failQueueInsert(1);

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.toggleBookmarkForSelection().catch((error: unknown) => error);
    });

    expect(outcome).toEqual(expect.objectContaining({ message: "Synthetic sync_queue write failure" }));
    expect(result.current.isBookmarked(2, 255)).toBe(false);
    expect(activeBookmarks()).toBe(0);
  });
});
