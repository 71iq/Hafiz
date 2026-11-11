import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";
import { defaultDatabaseDirectory, importDatabaseFromAssetAsync } from "expo-sqlite";

/**
 * Seeds the local database from the prebuilt Quran database the app already bundles, so a fresh
 * install copies one file instead of parsing and inserting ~70 MB of JSON on the JS thread. An
 * existing database is never touched: the check runs before expo-asset copies the 63 MB resource,
 * so warm launches do no file work. Android's resource copy in the cache is removed afterwards so
 * the content is not stored twice.
 */
export async function importBundledDatabase(databaseName: string, assetId: number): Promise<void> {
  const target = new File(`file://${defaultDatabaseDirectory}`, databaseName);
  if (target.exists) return;

  await importDatabaseFromAssetAsync(databaseName, { assetId });

  const asset = Asset.fromModule(assetId);
  const uri = asset.localUri;
  if (uri?.startsWith(Paths.cache.uri)) {
    try {
      new File(uri).delete();
    } catch {}
    asset.downloaded = false;
    asset.localUri = null;
  }
}
