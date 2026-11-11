jest.mock("expo-asset", () => ({ Asset: { fromModule: jest.fn() } }));

import { resolveContentImportState } from "@/lib/database/init";

type Counts = Record<string, number>;

function fakeDb(counts: Counts, settings: Record<string, string> = {}) {
  const writes: Array<[string, string]> = [];
  const db = {
    getFirstAsync: async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM user_settings")) {
        const key = String((params ?? [])[0]);
        return key in settings ? { value: settings[key] } : null;
      }
      const table = Object.keys(counts).find((name) => sql.includes(`FROM ${name}`));
      return { count: table ? counts[table] : 0 };
    },
    runAsync: async (_sql: string, params: unknown[]) => {
      writes.push([String(params[0]), String(params[1])]);
      settings[String(params[0])] = String(params[1]);
      return { changes: 1, lastInsertRowId: 0 };
    },
  };
  return { db: db as any, writes };
}

const complete: Counts = {
  surahs: 114,
  quran_text: 6236,
  translations: 6236,
  "tafseer WHERE source = 'muyassar'": 6236,
  juz_map: 135,
  hizb_map: 60,
  page_map: 604,
  word_roots: 50268,
  word_translations: 77429,
  word_irab: 77411,
  tajweed_rules: 60057,
};

describe("resolveContentImportState", () => {
  it("imports from scratch when surahs are missing", async () => {
    const { db } = fakeDb({ surahs: 0 });
    await expect(resolveContentImportState(db)).resolves.toBe("fresh");
  });

  it("resumes when Android killed the import after surahs were written", async () => {
    const { db, writes } = fakeDb({ surahs: 114, quran_text: 6236, translations: 0 });
    await expect(resolveContentImportState(db)).resolves.toBe("resume");
    expect(writes).toEqual([]);
  });

  it("accepts and marks an older complete install without the marker", async () => {
    const { db, writes } = fakeDb(complete);
    await expect(resolveContentImportState(db)).resolves.toBe("complete");
    expect(writes).toEqual([["content_import_complete_v1", "1"]]);
  });

  it("trusts the marker without recounting", async () => {
    const { db } = fakeDb({ surahs: 114 }, { content_import_complete_v1: "1" });
    await expect(resolveContentImportState(db)).resolves.toBe("complete");
  });
});
