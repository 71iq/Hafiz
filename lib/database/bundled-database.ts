import { importDatabaseFromAssetAsync, openDatabaseAsync } from "expo-sqlite";

const QURAN_AYAH_COUNT = 6236;

/**
 * Web seeds OPFS from the prebuilt Quran database; expo-sqlite skips any database that already exists.
 * A reload while that first copy was still writing left a partial file, which was then skipped on every
 * later visit, and the app fell back to JSON imports the site does not serve ("Database Error" for
 * good). A database without the complete Quran text is copied again. User data is only written after
 * setup succeeds, so a database that fails this check holds none.
 */
export async function importBundledDatabase(databaseName: string, assetId: number): Promise<void> {
  await importDatabaseFromAssetAsync(databaseName, { assetId });
  if (await hasCompleteQuranText(databaseName)) return;
  console.warn("[Database] The stored Quran database is incomplete; copying it again.");
  await importDatabaseFromAssetAsync(databaseName, { assetId, forceOverwrite: true });
}

async function hasCompleteQuranText(databaseName: string): Promise<boolean> {
  let database: Awaited<ReturnType<typeof openDatabaseAsync>> | null = null;
  try {
    database = await openDatabaseAsync(databaseName, { useNewConnection: true });
    const row = await database.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM quran_text");
    return (row?.count ?? 0) >= QURAN_AYAH_COUNT;
  } catch {
    return false;
  } finally {
    await database?.closeAsync().catch(() => undefined);
  }
}
