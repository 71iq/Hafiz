import { importDatabaseFromAssetAsync, openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

const QURAN_AYAH_COUNT = 6236;

/**
 * Opens the web database, which lives in OPFS and is seeded from the prebuilt Quran database.
 *
 * Each open, import and close starts and then retires the SQLite worker runtime, and that costs more
 * than every start-up query together. A return visit therefore opens the stored database once and
 * checks it on that same connection, instead of asking the importer whether it exists, opening it to
 * check it, and opening it again to use it.
 *
 * A database without the complete Quran text is replaced. That covers a first visit, where opening
 * creates an empty file, and a copy an earlier version left partial when a reload interrupted it.
 * User data is only written after setup succeeds, so a database that fails this check holds none.
 * Returns null when `isActive` reports that this start-up was abandoned while the copy ran.
 */
export async function openBundledDatabase(
  databaseName: string,
  isActive: () => boolean,
  assetId: number = require("../../assets/data/quran.db"),
): Promise<SQLiteDatabase | null> {
  const stored = await openDatabaseAsync(databaseName, { useNewConnection: true });
  if (await hasCompleteQuranText(stored)) return stored;
  await stored.closeAsync();
  await importDatabaseFromAssetAsync(databaseName, { assetId, forceOverwrite: true });
  if (!isActive()) return null;
  return openDatabaseAsync(databaseName, { useNewConnection: true });
}

async function hasCompleteQuranText(database: SQLiteDatabase): Promise<boolean> {
  try {
    const row = await database.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM quran_text");
    return (row?.count ?? 0) >= QURAN_AYAH_COUNT;
  } catch {
    return false;
  }
}
