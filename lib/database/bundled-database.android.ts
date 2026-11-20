import { defaultDatabaseDirectory, openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { readerContent } from "@/modules/hafiz-reader-content";

/** Seeds the database from the packed Quran seed, then opens it. Null when the start-up was abandoned meanwhile. */
export async function openBundledDatabase(
  databaseName: string,
  isActive: () => boolean,
): Promise<SQLiteDatabase | null> {
  await readerContent.seedDatabase(defaultDatabaseDirectory, databaseName);
  if (!isActive()) return null;
  return openDatabaseAsync(databaseName, { useNewConnection: true });
}
