import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";

const inFlight = new Map<number, Promise<unknown>>();

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
