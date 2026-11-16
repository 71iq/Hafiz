import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";
import { defaultDatabaseDirectory, importDatabaseFromAssetAsync } from "expo-sqlite";

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
