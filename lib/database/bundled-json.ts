/** The web fetches datasets from /data/ and never reads bundled native assets. */
export async function readBundledJson(_moduleId: number): Promise<unknown> {
  throw new Error("Bundled native data is not available on this platform");
}
