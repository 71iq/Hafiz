import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useDatabase } from "@/lib/database/provider";
import { hapticLight } from "@/lib/haptics";
import type { Selection, HighlightEntry, BookmarkEntry } from "./types";
import {
  fetchAllBookmarks,
  addBookmark as dbAddBookmark,
  removeBookmark as dbRemoveBookmark,
  fetchAllHighlights,
  addHighlight as dbAddHighlight,
  removeHighlightsForAyah,
} from "./queries";

type SelectionContextType = {
  selection: Selection | null;
  highlights: Map<string, HighlightEntry[]>;
  bookmarks: Set<string>;
  bookmarksList: BookmarkEntry[];
  toastMessage: string | null;
  selectAyah: (surah: number, ayah: number) => void;
  clearSelection: () => void;
  addHighlightForSelection: (color: string) => Promise<void>;
  removeHighlightForSelection: () => Promise<void>;
  toggleBookmarkForSelection: () => Promise<"added" | "removed" | null>;
  showToast: (msg: string) => void;
  dismissToast: () => void;
  refreshHighlights: () => Promise<void>;
  refreshBookmarks: () => Promise<void>;
  isBookmarked: (surah: number, ayah: number) => boolean;
  getHighlightColor: (surah: number, ayah: number) => string | undefined;
};

const SelectionContext = createContext<SelectionContextType>({
  selection: null,
  highlights: new Map(),
  bookmarks: new Set(),
  bookmarksList: [],
  toastMessage: null,
  selectAyah: () => {},
  clearSelection: () => {},
  addHighlightForSelection: async () => {},
  removeHighlightForSelection: async () => {},
  toggleBookmarkForSelection: async () => null,
  showToast: () => {},
  dismissToast: () => {},
  refreshHighlights: async () => {},
  refreshBookmarks: async () => {},
  isBookmarked: () => false,
  getHighlightColor: () => undefined,
});

export function useSelection() {
  return useContext(SelectionContext);
}

function ayahKey(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const db = useDatabase();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [highlights, setHighlights] = useState<Map<string, HighlightEntry[]>>(new Map());
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [bookmarksList, setBookmarksList] = useState<BookmarkEntry[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const refreshHighlights = useCallback(async () => {
    try {
      const rows = await fetchAllHighlights(db);
      const map = new Map<string, HighlightEntry[]>();
      for (const h of rows) {
        const key = ayahKey(h.surah, h.ayah);
        const existing = map.get(key) || [];
        existing.push(h);
        map.set(key, existing);
      }
      if (mountedRef.current) setHighlights(map);
    } catch (e) {
      console.warn("[Selection] Failed to load highlights:", e);
    }
  }, [db]);

  const refreshBookmarks = useCallback(async () => {
    try {
      const rows = await fetchAllBookmarks(db);
      const set = new Set<string>();
      for (const b of rows) set.add(ayahKey(b.surah, b.ayah));
      if (mountedRef.current) {
        setBookmarks(set);
        setBookmarksList(rows);
      }
    } catch (e) {
      console.warn("[Selection] Failed to load bookmarks:", e);
    }
  }, [db]);

  useEffect(() => {
    refreshHighlights();
    refreshBookmarks();
  }, [refreshHighlights, refreshBookmarks]);

  const selectAyah = useCallback((surah: number, ayah: number) => {
    setSelection({ start: { surah, ayah }, end: { surah, ayah } });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const addHighlightForSelection = useCallback(
    async (color: string) => {
      if (!selection) return;
      const { start } = selection;
      try {
        await removeHighlightsForAyah(db, start.surah, start.ayah);
        await dbAddHighlight(db, start.surah, start.ayah, color);
        await refreshHighlights();
      } catch (e) {
        console.warn("[Selection] Failed to add highlight:", e);
      }
    },
    [selection, db, refreshHighlights]
  );

  const removeHighlightForSelection = useCallback(
    async () => {
      if (!selection) return;
      const { start } = selection;
      try {
        await removeHighlightsForAyah(db, start.surah, start.ayah);
        await refreshHighlights();
      } catch (e) {
        console.warn("[Selection] Failed to remove highlight:", e);
      }
    },
    [selection, db, refreshHighlights]
  );

  const toggleBookmarkForSelection = useCallback(
    async (): Promise<"added" | "removed" | null> => {
      if (!selection) return null;
      hapticLight();
      const { start } = selection;
      const key = ayahKey(start.surah, start.ayah);
      try {
        if (bookmarks.has(key)) {
          await dbRemoveBookmark(db, start.surah, start.ayah);
          await refreshBookmarks();
          return "removed";
        } else {
          await dbAddBookmark(db, start.surah, start.ayah);
          await refreshBookmarks();
          return "added";
        }
      } catch (e) {
        console.warn("[Selection] Failed to toggle bookmark:", e);
        return null;
      }
    },
    [selection, db, bookmarks, refreshBookmarks]
  );

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  const dismissToast = useCallback(() => {
    setToastMessage(null);
  }, []);

  const isBookmarked = useCallback(
    (surah: number, ayah: number): boolean => bookmarks.has(ayahKey(surah, ayah)),
    [bookmarks]
  );

  const getHighlightColor = useCallback(
    (surah: number, ayah: number): string | undefined => {
      const entries = highlights.get(ayahKey(surah, ayah));
      return entries?.[0]?.color;
    },
    [highlights]
  );

  return (
    <SelectionContext.Provider
      value={{
        selection,
        highlights,
        bookmarks,
        bookmarksList,
        toastMessage,
        selectAyah,
        clearSelection,
        addHighlightForSelection,
        removeHighlightForSelection,
        toggleBookmarkForSelection,
        showToast,
        dismissToast,
        refreshHighlights,
        refreshBookmarks,
        isBookmarked,
        getHighlightColor,
      }}
    >
      {children}
    </SelectionContext.Provider>
  );
}
