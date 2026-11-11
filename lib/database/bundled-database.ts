import { importDatabaseFromAssetAsync } from "expo-sqlite";

/** Web seeds OPFS from the prebuilt Quran database; expo-sqlite skips an existing database. */
export async function importBundledDatabase(databaseName: string, assetId: number): Promise<void> {
  await importDatabaseFromAssetAsync(databaseName, { assetId });
}
