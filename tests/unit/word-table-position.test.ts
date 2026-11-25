import path from "node:path";
import { fetchTableWordPos } from "@/lib/word/queries";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/** The reader's glyph number to the word tables' position (SPEC 3.10), over the bundled Quran text. */
let store: OutboxDatabase;

beforeAll(async () => {
  store = await openOutboxDatabase();
  store.sql.exec(`ATTACH DATABASE '${path.resolve(__dirname, "../../assets/data/quran.db")}' AS bundled`);
  store.sql.exec("DELETE FROM main.quran_text");
  store.sql.exec("INSERT INTO main.quran_text SELECT * FROM bundled.quran_text");
});

afterAll(async () => {
  await store.close();
});

it("keeps the number in an ayah with one glyph per word", async () => {
  expect(await fetchTableWordPos(store.db, 2, 255, 10)).toBe(10);
});

it("steps back one past the hizb mark, and names the first word for a tap on the mark", async () => {
  // 2:26 opens a hizb quarter: glyph 1 is the mark, glyph 2 the first word.
  expect(await fetchTableWordPos(store.db, 2, 26, 1)).toBe(1);
  expect(await fetchTableWordPos(store.db, 2, 26, 2)).toBe(1);
  expect(await fetchTableWordPos(store.db, 2, 26, 3)).toBe(2);
});

it("steps back past the pause mark in 36:52 only after it", async () => {
  expect(await fetchTableWordPos(store.db, 36, 52, 5)).toBe(5);
  // Glyph 7 is the pause mark over the end of word 6; glyph 8 is word 7.
  expect(await fetchTableWordPos(store.db, 36, 52, 7)).toBe(6);
  expect(await fetchTableWordPos(store.db, 36, 52, 8)).toBe(7);
});

it("keeps the reader's number for an ayah it cannot read", async () => {
  expect(await fetchTableWordPos(store.db, 999, 1, 4)).toBe(4);
});
