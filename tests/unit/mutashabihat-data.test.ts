import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MUTASHABIHAT_DATA_VERSION, parseMutashabihatRows } from "@/lib/database/mutashabihat-rows";

const ROOT = path.join(__dirname, "../..");
const MAX_FILL = 12;
const WINDOW_AYAT = 3;

type Ref = {
  group_id: string;
  sort_order: number;
  surah: number;
  ayah: number;
  surah_name_ar: string | null;
  tail_5: string | null;
  pre_text: string | null;
  similar_text: string | null;
  post_text: string | null;
};
type Group = { id: string; kind: "similar" | "tail"; cue: string; source: string; sort_order: number };
type SourceGroup = { id: string; refs?: { surah: unknown; ayah: unknown }[] };

const words = (text: string | null) => (text ?? "").split(/\s+/).filter(Boolean);

const db = new DatabaseSync(path.join(ROOT, "assets/data/quran.db"), { readOnly: true });
const ayat = db.prepare("SELECT surah, ayah, text_uthmani FROM quran_text ORDER BY surah, ayah").all() as {
  surah: number;
  ayah: number;
  text_uthmani: string;
}[];
const groups = db
  .prepare("SELECT id, kind, cue, source, sort_order FROM mutashabihat_groups ORDER BY sort_order")
  .all() as Group[];
const refs = db
  .prepare(
    `SELECT r.group_id, r.sort_order, r.surah, r.ayah, r.surah_name_ar, r.tail_5, r.pre_text, r.similar_text, r.post_text
       FROM mutashabihat_refs r JOIN mutashabihat_groups g ON g.id = r.group_id
      ORDER BY g.sort_order, r.sort_order`,
  )
  .all() as Ref[];
db.close();
const kinds = new Map(groups.map((group) => [group.id, group.kind]));
const similarRefs = refs.filter((ref) => kinds.get(ref.group_id) === "similar");

function windowAround(surah: number, ayah: number): { word: string; ayah: number }[] {
  const basmala = words(ayat[0].text_uthmani);
  const list: { word: string; ayah: number }[] = [];
  if (surah !== 1 && surah !== 9 && ayah - WINDOW_AYAT <= 0) for (const word of basmala) list.push({ word, ayah: 0 });
  for (const row of ayat) {
    if (row.surah !== surah || Math.abs(row.ayah - ayah) > WINDOW_AYAT) continue;
    for (const word of words(row.text_uthmani)) list.push({ word, ayah: row.ayah });
  }
  return list;
}

function startsOf(run: readonly string[], text: readonly { word: string }[]): number[] {
  const starts: number[] = [];
  for (let at = 0; at + run.length <= text.length; at += 1) {
    if (run.every((word, k) => text[at + k].word === word)) starts.push(at);
  }
  return starts;
}

const allowedSkip = (skip: number) => skip === 0 || skip > MAX_FILL;

function segmentProblem(ref: Ref): string | null {
  const [pre, similar, post] = [ref.pre_text, ref.similar_text, ref.post_text].map(words);
  if (similar.length === 0) return "no similar words";
  const text = windowAround(ref.surah, ref.ayah);
  const fits = startsOf(similar, text).some((start) => {
    const end = start + similar.length;
    if (!text.slice(start, end).some((word) => word.ayah === ref.ayah)) return false;
    const preFits =
      pre.length === 0 ||
      startsOf(pre, text).some((at) => at + pre.length <= start && allowedSkip(start - at - pre.length));
    const postFits = post.length === 0 || startsOf(post, text).some((at) => at >= end && allowedSkip(at - end));
    return preFits && postFits;
  });
  return fits ? null : "not exact runs of its surah's Uthmani words in order, with only long skips between them";
}

describe("the bundled similar-verse passages", () => {
  it("are exact runs of Uthmani words in Mushaf order, and a skip between segments is longer than 12 words", () => {
    const failures = similarRefs.flatMap((ref) => {
      const problem = segmentProblem(ref);
      return problem ? [`${ref.group_id}#${ref.sort_order} (${ref.surah}:${ref.ayah}): ${problem}`] : [];
    });
    expect(similarRefs.length).toBeGreaterThan(1900);
    expect(failures).toEqual([]);
  });

  it("keep each source sort order on its source ayah, give relabelled refs new ones, and leave no group with one verse", () => {
    const source = JSON.parse(
      fs.readFileSync(path.join(ROOT, "assets/data/mutashabihat/nourquran_hafiz.json"), "utf8"),
    ) as {
      similar_groups: SourceGroup[];
      tail_groups: SourceGroup[];
    };
    const sourceRefs = new Map(
      [...source.similar_groups, ...source.tail_groups].map((group) => [
        group.id,
        (group.refs ?? []).filter((ref) => Number.isInteger(ref.surah) && Number.isInteger(ref.ayah)),
      ]),
    );
    const moved: string[] = [];
    const relabelled: string[] = [];
    for (const ref of refs) {
      const list = sourceRefs.get(ref.group_id) ?? [];
      const was = list[ref.sort_order];
      if (ref.sort_order >= list.length) relabelled.push(`${ref.group_id}#${ref.sort_order} ${ref.surah}:${ref.ayah}`);
      else if (was.surah !== ref.surah || was.ayah !== ref.ayah) moved.push(`${ref.group_id}#${ref.sort_order}`);
    }
    expect(moved).toEqual([]);
    expect(relabelled).toHaveLength(20);
    expect(relabelled).toEqual(
      expect.arrayContaining([
        "nq-sim-6b0cb090bae7db#2 2:265",
        "nq-sim-f58bbe09e8ddf0#2 65:2",
        "nq-sim-1b532f39044afd#3 11:13",
        "nq-sim-7d0576c830de2e#3 7:8",
        "nq-sim-7d0576c830de2e#4 23:102",
        "nq-sim-7d0576c830de2e#5 101:6",
      ]),
    );
    expect(refs.some((ref) => ref.group_id === "nq-sim-6b0cb090bae7db" && ref.sort_order === 1)).toBe(false);
    expect(refs.some((ref) => ref.group_id === "nq-sim-7d0576c830de2e" && ref.sort_order === 2)).toBe(false);

    const versesPerGroup = new Map<string, Set<string>>();
    for (const ref of similarRefs) {
      const set = versesPerGroup.get(ref.group_id) ?? new Set<string>();
      set.add(`${ref.surah}:${ref.ayah}`);
      versesPerGroup.set(ref.group_id, set);
    }
    const lonely = [...versesPerGroup].filter(([, verses]) => verses.size < 2).map(([id]) => id);
    expect(lonely).toEqual([]);
  });

  it("list every source sort order left without its ayah as retired, and give no retired slot a ref", () => {
    const source = JSON.parse(
      fs.readFileSync(path.join(ROOT, "assets/data/mutashabihat/nourquran_hafiz.json"), "utf8"),
    ) as { similar_groups: SourceGroup[]; tail_groups: SourceGroup[] };
    const retired = new Set(
      (
        JSON.parse(
          fs.readFileSync(path.join(ROOT, "assets/data/mutashabihat/nourquran_hafiz_retired_cards.json"), "utf8"),
        ) as { cards: string[] }
      ).cards,
    );
    const cardId = (groupId: string, sortOrder: number) =>
      `${kinds.get(groupId) === "tail" ? "similar-tail" : "mutashabihat"}:${groupId}:${sortOrder}`;
    const live = new Map(refs.map((ref) => [cardId(ref.group_id, ref.sort_order), `${ref.surah}:${ref.ayah}`]));
    const unlisted: string[] = [];
    for (const group of [...source.similar_groups, ...source.tail_groups]) {
      if (!kinds.has(group.id)) continue;
      const list = (group.refs ?? []).filter((ref) => Number.isInteger(ref.surah) && Number.isInteger(ref.ayah));
      list.forEach((ref, sortOrder) => {
        const id = cardId(group.id, sortOrder);
        if (live.get(id) !== `${ref.surah}:${ref.ayah}` && !retired.has(id)) unlisted.push(id);
      });
    }
    expect(unlisted).toEqual([]);
    expect([...retired].filter((id) => live.has(id))).toEqual([]);
    expect(
      [...retired].filter((id) => !/^(mutashabihat|similar-tail):(.+):\d+$/.test(id) || !kinds.has(id.split(":")[1])),
    ).toEqual([]);
    expect([...retired]).toEqual(
      expect.arrayContaining(["mutashabihat:nq-sim-6b0cb090bae7db:1", "mutashabihat:nq-sim-7d0576c830de2e:2"]),
    );
    expect(retired.size).toBe(20);
  });

  it("are the rows of the rows file the app refreshes from, at the version it expects", () => {
    const text = fs.readFileSync(path.join(ROOT, "assets/data/mutashabihat/nourquran_hafiz_rows.json"), "utf8");
    const file = parseMutashabihatRows(JSON.parse(text));
    expect(file.version).toBe(MUTASHABIHAT_DATA_VERSION);
    const hash = createHash("sha256")
      .update(JSON.stringify({ groups: file.groups, refs: file.refs }))
      .digest("hex")
      .slice(0, 16);
    expect(hash).toBe(file.version);
    expect(file.groups).toEqual(
      groups.map((group) => [group.id, group.kind, group.cue, group.source, group.sort_order]),
    );
    const key = (groupId: string, sortOrder: number) => `${groupId}#${sortOrder}`;
    const fromFile = new Map(file.refs.map((row) => [key(row[0], row[1]), row]));
    expect(fromFile.size).toBe(refs.length);
    for (const ref of refs) {
      expect(fromFile.get(key(ref.group_id, ref.sort_order))).toEqual([
        ref.group_id,
        ref.sort_order,
        ref.surah,
        ref.ayah,
        ref.surah_name_ar,
        ref.tail_5,
        ref.pre_text,
        ref.similar_text,
        ref.post_text,
      ]);
    }
  });
});
