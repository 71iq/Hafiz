import path from "node:path";
import {
  bandOf,
  loadLemmaIndex,
  parseMeaningCardId,
  positionKey,
  wordSkeleton,
  type LemmaIndex,
} from "@/lib/meanings/lemma-index";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/** The lemma index behind generated meaning cards (SPEC 3.6), over the bundled word tables. */
let store: OutboxDatabase;
let index: LemmaIndex;

beforeAll(async () => {
  store = await openOutboxDatabase();
  store.sql.exec(`ATTACH DATABASE '${path.resolve(__dirname, "../../assets/data/quran.db")}' AS bundled`);
  for (const table of ["word_roots", "word_irab", "word_meanings_ar"]) {
    store.sql.exec(`DELETE FROM main.${table}`);
    store.sql.exec(`INSERT INTO main.${table} SELECT * FROM bundled.${table}`);
  }
  index = await loadLemmaIndex(store.db);
}, 60_000);

afterAll(async () => {
  await store.close();
});

it("has one entry per (lemma, root) pair, banded by occurrences as the spec's table", () => {
  expect(index.lemmas).toHaveLength(4635);
  const perBand = [0, 0, 0, 0, 0, 0];
  for (const entry of index.lemmas) perBand[entry.band] += 1;
  expect(perBand).toEqual([129, 258, 330, 866, 1117, 1935]);
  // Commonest first.
  expect(index.lemmas[0].occurrences).toBeGreaterThanOrEqual(index.lemmas[1].occurrences);
});

it("offers an Arabic card only on a one-word meaning entry, and an English card on any aligned word", () => {
  const withArabic = [0, 0, 0, 0, 0, 0];
  for (const entry of index.lemmas) if (entry.positions.ar.length > 0) withArabic[entry.band] += 1;
  expect(withArabic).toEqual([117, 246, 311, 762, 840, 1204]);
  expect(index.lemmas.every((entry) => entry.positions.en.length >= entry.positions.ar.length)).toBe(true);
});

it("drops the 88 positions in 15 ayat where the two word numberings disagree", () => {
  const eligible = new Set(
    index.lemmas.flatMap((entry) => entry.positions.en.map((p) => positionKey(p.surah, p.ayah, p.pos))),
  );
  const dropped = [...index.lemmaAt.keys()].filter((key) => !eligible.has(key));
  expect(dropped).toHaveLength(88);
  expect(new Set(dropped.map((key) => key.split(":").slice(0, 2).join(":"))).size).toBe(15);
});

it("is built once per database", async () => {
  expect(await loadLemmaIndex(store.db)).toBe(index);
});

it("keeps the helpers' rules", () => {
  expect([70, 69, 23, 22, 11, 10, 4, 3, 2, 1].map(bandOf)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  expect(wordSkeleton("بِسْمِ")).toBe("بسم");
  expect(wordSkeleton("ٱلرَّحْمَٰنِ")).toBe(wordSkeleton("الرَّحْمَنِ"));
  expect(parseMeaningCardId("word:2:255:10")).toEqual({ surah: 2, ayah: 255, pos: 10 });
  expect(parseMeaningCardId("mutashabihat:2:255")).toBeNull();
});
