import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";

const inFlight = new Map<number, Promise<unknown>>();

/**
 * Read a bundled dataset that Metro ships as an asset (RF188). On Android, release assets are packed
 * resources that expo-asset copies to the cache before they can be read. That copy is removed once
 * parsed so the datasets do not stay duplicated in the cache. expo-asset keeps one Asset per file
 * and skips downloadAsync once it is marked downloaded, so the asset is reset after the delete and a
 * later read (a translation chosen again, an import retry) copies it again. Overlapping reads of one
 * file share a single read so none of them sees the file after another deleted it. iOS reads the
 * file in place from the app bundle.
 */
export function readBundledJson(moduleId: number): Promise<unknown> {
  const pending = inFlight.get(moduleId);
  if (pending) return pending;
  const read = readOnce(moduleId).finally(() => inFlight.delete(moduleId));
  inFlight.set(moduleId, read);
  return read;
}

async function readOnce(moduleId: number): Promise<unknown> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri;
  if (!uri) throw new Error(`Bundled data file ${asset.name} is unavailable`);
  const file = new File(uri);
  const text = await file.text();
  if (uri.startsWith(Paths.cache.uri)) {
    try {
      file.delete();
    } catch {}
    asset.downloaded = false;
    asset.localUri = null;
  }
  return JSON.parse(text);
}
