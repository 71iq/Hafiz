import fs from "node:fs";
import path from "node:path";
import { translationRequires } from "@/lib/translations/translation-membership";

const root = path.resolve(__dirname, "../..");
const { datasetFiles } = require("../../scripts/pack-android-content.cjs") as { datasetFiles: () => string[] };

describe("Android packed reader content", () => {
  // Android reads datasets by name from the packed APK assets. iOS reads the same names through the
  // native require maps, so a dataset added only there would fail on Android at runtime.
  it("packs every dataset the native loaders read by name", () => {
    const loaders = fs.readFileSync(path.join(root, "lib/database/native-loaders.native.ts"), "utf8");
    const required = [...loaders.matchAll(/^\s*"([^"]+\.json)":/gm)].map((match) => match[1]);
    expect(required).toContain("quran-data.json");
    expect(required).toContain("wbw/wbw.json");
    for (let surah = 1; surah <= 114; surah += 1) required.push(`tafseer/${surah}.json`);
    for (const language of Object.keys(translationRequires)) required.push(`translations/${language}.json`);

    const packed = new Set(datasetFiles());
    // The names ReaderContentModule.readDataset accepts.
    const readable = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)?\.json$/;
    expect(required.filter((name) => !packed.has(name) || !readable.test(name))).toEqual([]);
  });
});
