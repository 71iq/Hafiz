import path from "node:path";
import { computeUniqueFront } from "@/lib/fsrs/uniqueness";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/**
 * A repeated ayah's card front adds the ayahs before it until the front is unique. The front draws
 * each of them in its own page font, so the context comes back as rows with their glyphs and pages,
 * not only as one joined Unicode string. Ayat are the bundled database's.
 */
let store: OutboxDatabase;

beforeAll(async () => {
  store = await openOutboxDatabase();
  store.sql.exec(`ATTACH DATABASE '${path.resolve(__dirname, "../../assets/data/quran.db")}' AS bundled`);
  for (const table of ["quran_text", "surahs"]) {
    store.sql.exec(`DELETE FROM main.${table}`);
    store.sql.exec(`INSERT INTO main.${table} SELECT * FROM bundled.${table}`);
  }
});

afterAll(async () => {
  await store.close();
});

function ayahRow(surah: number, ayah: number) {
  return store.sql
    .prepare("SELECT text_uthmani, text_qcf2, v2_page FROM quran_text WHERE surah = ? AND ayah = ?")
    .get(surah, ayah) as { text_uthmani: string; text_qcf2: string; v2_page: number };
}

test("a unique ayah needs no context", async () => {
  const front = await computeUniqueFront(store.db, 2, 255);
  expect(front).toMatchObject({ contextCount: 0, context: [], needsExplicitLabel: false });
});

test("a repeated ayah returns its context ayah with glyphs and page", async () => {
  // "فَبِأَىِّ ءَالَآءِ رَبِّكُمَا تُكَذِّبَانِ" first comes at 55:13; 55:12 before it is unique to it.
  const front = await computeUniqueFront(store.db, 55, 13);
  const previous = ayahRow(55, 12);
  expect(front.contextCount).toBe(1);
  expect(front.context).toEqual([
    { surah: 55, ayah: 12, textUthmani: previous.text_uthmani, textQcf2: previous.text_qcf2, v2Page: previous.v2_page },
  ]);
  expect(front.text.startsWith(previous.text_uthmani)).toBe(true);
});

test("every context row matches its ayah and comes in order", async () => {
  for (const ayah of [16, 18, 21, 23, 25, 28, 30]) {
    const front = await computeUniqueFront(store.db, 55, ayah);
    expect(front.context).toHaveLength(front.contextCount);
    front.context.forEach((row, index) => {
      expect(row.ayah).toBe(ayah - front.contextCount + index);
      expect(row.textQcf2).toBe(ayahRow(55, row.ayah).text_qcf2);
    });
  }
});
