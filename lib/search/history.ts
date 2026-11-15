import type { AppDatabase } from "@/lib/database/types";

/** The device-local Search history (search_history table): the ten most recent distinct queries. */
export type SearchMode = "text" | "root";

export type SearchHistoryEntry = {
  id: number;
  query: string;
  mode: string;
  created_at: string;
};

type HistoryDatabase = Pick<AppDatabase, "getAllAsync" | "runAsync">;

export function loadSearchHistory(db: HistoryDatabase): Promise<SearchHistoryEntry[]> {
  return db.getAllAsync<SearchHistoryEntry>(
    "SELECT id, query, mode, created_at FROM search_history ORDER BY created_at DESC LIMIT 10",
  );
}

/** Moves a query to the top of the history, keeping only the latest ten. */
export async function saveSearchHistory(db: HistoryDatabase, query: string, mode: SearchMode): Promise<void> {
  await db.runAsync("DELETE FROM search_history WHERE query = ? AND mode = ?", [query, mode]);
  await db.runAsync("INSERT INTO search_history (query, mode, created_at) VALUES (?, ?, ?)", [
    query,
    mode,
    new Date().toISOString(),
  ]);
  await db.runAsync(
    "DELETE FROM search_history WHERE id NOT IN (SELECT id FROM search_history ORDER BY created_at DESC LIMIT 10)",
  );
}

export async function removeSearchHistoryEntry(db: HistoryDatabase, id: number): Promise<void> {
  await db.runAsync("DELETE FROM search_history WHERE id = ?", [id]);
}

export async function clearSearchHistory(db: HistoryDatabase): Promise<void> {
  await db.runAsync("DELETE FROM search_history");
}
