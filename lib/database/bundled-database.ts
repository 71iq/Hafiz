import { importDatabaseFromAssetAsync, openDatabaseAsync } from "expo-sqlite";

const QURAN_AYAH_COUNT = 6236;

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
