import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * The similar-verse alignment rule (scripts/mutashabihat-align.mjs) on refs from the NourQuran source
 * and on made-up ones, with the bundled Uthmani text. The module is a build script, so it runs in Node
 * itself; the rule's results come back as JSON.
 */
const ROOT = path.join(__dirname, "../..");

type Rebuilt = {
  status: "rebuilt" | "relabelled" | "kept";
  relabel?: { surah: number; ayah: number };
  segments: { pre: string; similar: string; post: string };
  change?: { gapsLeft: { pre: number; post: number }; cut: number[]; restored: number; added: number };
};

const SCRIPT = `
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [root, cases] = [process.argv[1], JSON.parse(process.argv[2])];
const { rebuildRef } = await import(root + "/scripts/mutashabihat-align.mjs");
const db = new DatabaseSync(root + "/assets/data/quran.db", { readOnly: true });
const verses = new Map(); const counts = new Map(); const ordered = [];
for (const row of db.prepare("SELECT surah, ayah, text_uthmani FROM quran_text ORDER BY surah, ayah").all()) {
  const list = row.text_uthmani.split(/\\s+/).filter(Boolean);
  verses.set(row.surah + ":" + row.ayah, list);
  counts.set(row.surah, Math.max(counts.get(row.surah) ?? 0, row.ayah));
  ordered.push([row.surah, row.ayah, list]);
}
const quran = { ayahWords: (s, a) => verses.get(s + ":" + a), ayahCount: (s) => counts.get(s), basmala: verses.get("1:1"), allAyat: () => ordered };
const source = JSON.parse(fs.readFileSync(root + "/assets/data/mutashabihat/nourquran_hafiz.json", "utf8"));
const words = (key, from, to) => verses.get(key).slice(from, to).join(" ");
const out = cases.map((c) => {
  let ref = c.ref;
  if (c.source) ref = source.similar_groups.find((g) => g.id === c.source[0]).refs[c.source[1]];
  if (c.made) ref = { surah: c.made.surah, ayah: c.made.ayah, ...Object.fromEntries(Object.entries(c.made.parts).map(([k, v]) => [k + "_text", v.map((p) => words(...p)).join(" ")])) };
  const r = rebuildRef(ref, quran);
  return { status: r.status, relabel: r.relabel, segments: r.segments, change: r.change, words: c.expect ? Object.fromEntries(Object.entries(c.expect).map(([k, p]) => [k, p.map((q) => words(...q)).join(" ")])) : null };
});
console.log(JSON.stringify(out));
`;

function rebuild(cases: unknown[]): (Rebuilt & { words: Record<string, string> | null })[] {
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", SCRIPT, ROOT, JSON.stringify(cases)], {
      encoding: "utf8",
    }),
  );
}

describe("the similar-verse alignment rule", () => {
  const results = rebuild([
    // 45:30: the source skips 6 words of 45:29 and 8 of 45:30, both filled.
    {
      source: ["nq-sim-052faae2cfb3fd", 1],
      expect: {
        pre: [["45:29"]],
        post: [
          ["45:30", 5],
          ["45:31", 0, 8],
        ],
      },
    },
    // 2:217: the source jumps from its similar words to the start of 2:218, past 51 words.
    {
      source: ["nq-sim-9da9670d95133e", 2],
      expect: { pre: [["2:216", -5]], similar: [["2:217", 0, 6]], post: [["2:218", 0, 6]] },
    },
    // A made-up post that skips 16 words of 2:255 inside it: it ends at the skip.
    {
      made: {
        surah: 2,
        ayah: 255,
        parts: {
          pre: [],
          similar: [["2:255", 0, 4]],
          post: [
            ["2:255", 4, 9],
            ["2:255", 25, 31],
          ],
        },
      },
      expect: { post: [["2:255", 4, 9]] },
    },
    // 5:41: "عظيم", from elsewhere, ends the post; the rest of 5:41 is longer than 12 words.
    { source: ["nq-sim-f7544313788ff1", 1], expect: { similar: [["5:41", 0, 8]], post: [["5:41", 8, 16]] } },
    // 2:264 holds the text of 2:265.
    {
      source: ["nq-sim-6b0cb090bae7db", 1],
      expect: { pre: [["2:264", 18]], similar: [["2:265", 0, 4]], post: [["2:265", 4, 13]] },
    },
  ]);

  it("fills a skip of 12 words or fewer with the Quran's own words", () => {
    const [ref] = results;
    expect(ref.status).toBe("rebuilt");
    expect(ref.segments.pre).toBe(ref.words!.pre);
    expect(ref.segments.post).toBe(ref.words!.post);
    expect(ref.change!.restored).toBe(14);
  });

  it("leaves a longer skip at a join open, keeping the source's words in their Uthmani form", () => {
    const ref = results[1];
    expect(ref.change!.gapsLeft).toEqual({ pre: 0, post: 51 });
    expect(ref.segments).toEqual(ref.words);
  });

  it("ends a segment at a long skip inside it, so no segment hides a gap", () => {
    const ref = results[2];
    expect(ref.segments.post).toBe(ref.words!.post);
    expect(ref.change!.cut).toHaveLength(6);
    expect(ref.change!.gapsLeft).toEqual({ pre: 0, post: 0 });
  });

  it("removes text from elsewhere and fills its place only up to 12 words", () => {
    const ref = results[3];
    expect(ref.segments.similar).toBe(ref.words!.similar);
    expect(ref.segments.post).toBe(ref.words!.post);
    expect(ref.change!.added).toBe(0);
  });

  it("relabels a ref to the ayah whose text it holds, rebuilt from that ayah", () => {
    const ref = results[4];
    expect(ref.status).toBe("relabelled");
    expect(ref.relabel).toEqual({ surah: 2, ayah: 265 });
    expect(ref.segments).toEqual(ref.words);
  });
});
