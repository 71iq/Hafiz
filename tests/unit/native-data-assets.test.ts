import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readBundledJson } from "@/lib/database/bundled-json.native";

type MockAsset = {
  name: string;
  source: string;
  localUri: string | null;
  downloaded: boolean;
  downloadAsync: () => Promise<void>;
};
const mockAssets = new Map<number, MockAsset>();
const mockFiles = new Map<string, string>();
const mockDeleted: string[] = [];
const CACHE = "file:///data/user/0/synthetic/cache/";

// Like expo-asset: one Asset object per module, and downloadAsync is a no-op once downloaded.
function mockAsset(id: number, name: string, source: string, cacheUri: string | null) {
  const asset: MockAsset = {
    name,
    source,
    localUri: null,
    downloaded: false,
    async downloadAsync() {
      if (asset.downloaded) return;
      await Promise.resolve();
      if (cacheUri) {
        mockFiles.set(cacheUri, asset.source);
        asset.localUri = cacheUri;
      }
      asset.downloaded = true;
    },
  };
  mockAssets.set(id, asset);
  return asset;
}

jest.mock("expo-asset", () => ({
  Asset: {
    fromModule: (id: number) => {
      const entry = mockAssets.get(id);
      if (!entry) throw new Error(`Unknown asset ${id}`);
      return entry;
    },
  },
}));
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///data/user/0/synthetic/cache/" } },
  File: class {
    mockUri: string;
    constructor(mockUri: string) {
      this.mockUri = mockUri;
    }
    async text() {
      await Promise.resolve();
      const text = mockFiles.get(this.mockUri);
      if (text === undefined) throw new Error("missing file");
      return text;
    }
    delete() {
      mockDeleted.push(this.mockUri);
      mockFiles.delete(this.mockUri);
    }
  },
}));

const { mirrorNativeData } = require("../../scripts/native-data-mirror.cjs") as {
  mirrorNativeData: (root: string) => number;
};

beforeEach(() => {
  mockAssets.clear();
  mockFiles.clear();
  mockDeleted.length = 0;
});

describe("RF-188 bundled native datasets", () => {
  it("parses an Android cache copy and removes it after reading", async () => {
    mockAsset(1, "zilal", '{"surah":1}', `${CACHE}ExponentAsset-abc.hafizdata`);

    await expect(readBundledJson(1)).resolves.toEqual({ surah: 1 });
    expect(mockDeleted).toEqual([`${CACHE}ExponentAsset-abc.hafizdata`]);
    expect(mockFiles.size).toBe(0);
  });

  it("reads the same Android asset again after its cache copy was removed", async () => {
    mockAsset(4, "fr", '{"lang":"fr"}', `${CACHE}ExponentAsset-fr.hafizdata`);

    await expect(readBundledJson(4)).resolves.toEqual({ lang: "fr" });
    await expect(readBundledJson(4)).resolves.toEqual({ lang: "fr" });
  });

  it("serves overlapping reads of one Android asset", async () => {
    mockAsset(5, "id", '{"lang":"id"}', `${CACHE}ExponentAsset-id.hafizdata`);

    await expect(Promise.all([readBundledJson(5), readBundledJson(5)])).resolves.toEqual([
      { lang: "id" },
      { lang: "id" },
    ]);
    expect(mockFiles.size).toBe(0);
  });

  it("reads an iOS bundle file in place without deleting it", async () => {
    const bundled = "file:///private/var/containers/Bundle/Application/X/Hafiz.app/assets/zilal.hafizdata";
    const asset = mockAsset(2, "zilal", "[1,2]", null);
    asset.localUri = bundled;
    asset.downloaded = true;
    mockFiles.set(bundled, "[1,2]");

    await expect(readBundledJson(2)).resolves.toEqual([1, 2]);
    expect(mockDeleted).toEqual([]);
  });

  it("fails clearly when the asset has no local file", async () => {
    mockAsset(3, "zilal", "{}", null);

    await expect(readBundledJson(3)).rejects.toThrow("Bundled data file zilal is unavailable");
  });

  it("requires only mirrors of existing protected dataset files", () => {
    const root = path.resolve(__dirname, "../..");
    for (const file of ["lib/database/native-loaders.native.ts", "lib/translations/translation-requires.ts"]) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source).not.toMatch(/require\("[^"]*assets\/data\/[^"]*\.json"\)/);
      const targets = [...source.matchAll(/require\("\.\.\/\.\.\/assets\/native-data\/([^"]+)\.hafizdata"\)/g)];
      expect(targets.length).toBeGreaterThan(0);
      for (const [, relative] of targets) {
        expect(fs.existsSync(path.join(root, "assets/data", `${relative}.json`))).toBe(true);
      }
    }
  });

  it("mirrors datasets as links, skips unchanged files and refreshes a replaced source", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hafiz-mirror-"));
    try {
      fs.mkdirSync(path.join(root, "assets/data/tafseer"), { recursive: true });
      fs.writeFileSync(path.join(root, "assets/data/tafseer/1.json"), '{"a":1}');
      fs.writeFileSync(path.join(root, "assets/data/readme.txt"), "not data");

      expect(mirrorNativeData(root)).toBe(1);
      const mirror = path.join(root, "assets/native-data/tafseer/1.hafizdata");
      expect(fs.readFileSync(mirror, "utf8")).toBe('{"a":1}');
      expect(fs.existsSync(path.join(root, "assets/native-data/readme.hafizdata"))).toBe(false);
      expect(mirrorNativeData(root)).toBe(0);

      // A checkout replaces the file with a new inode; the mirror must follow it.
      fs.rmSync(path.join(root, "assets/data/tafseer/1.json"));
      fs.writeFileSync(path.join(root, "assets/data/tafseer/1.json"), '{"a":2}');
      expect(mirrorNativeData(root)).toBe(1);
      expect(fs.readFileSync(mirror, "utf8")).toBe('{"a":2}');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
