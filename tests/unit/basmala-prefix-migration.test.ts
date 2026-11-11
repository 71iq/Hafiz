jest.mock("expo-asset", () => ({ Asset: { fromModule: jest.fn() } }));

import { DatabaseSync } from "node:sqlite";
import type { AppDatabase, TransactionDatabase } from "@/lib/database/types";
import { removeBasmalaPrefixFromFirstAyahs } from "@/lib/database/init";

const BASMALA = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";
const BASMALA_CLEAN = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";
const BASMALA_SEARCH = "بسم الله الرحمن الرحيم";

describe("removeBasmalaPrefixFromFirstAyahs", () => {
  let sql: DatabaseSync;
  let db: AppDatabase;

  beforeEach(() => {
    sql = new DatabaseSync(":memory:");
    sql.exec(`CREATE TABLE quran_text (surah INTEGER, ayah INTEGER, text_uthmani TEXT, text_clean TEXT, text_search TEXT,
      PRIMARY KEY (surah, ayah))`);
    const insert = sql.prepare("INSERT INTO quran_text VALUES (?, ?, ?, ?, ?)");
    insert.run(1, 1, BASMALA, BASMALA_CLEAN, BASMALA_SEARCH);
    insert.run(2, 1, `${BASMALA} الٓمٓ`, `${BASMALA_CLEAN} الم`, `${BASMALA_SEARCH} الم`);
    insert.run(9, 1, "بَرَآءَةٌ مِّنَ ٱللَّهِ", "بَرَاءَةٌ مِنَ اللَّهِ", "براءة من الله");
    insert.run(27, 30, `إِنَّهُۥ مِن سُلَيْمَٰنَ وَإِنَّهُۥ ${BASMALA}`, "x", `انه من سليمان وانه ${BASMALA_SEARCH}`);
    insert.run(114, 1, `${BASMALA} قُلْ أَعُوذُ بِرَبِّ ٱلنَّاسِ`, `${BASMALA_CLEAN} قل`, `${BASMALA_SEARCH} قل اعوذ برب الناس`);
    db = {
      getFirstAsync: async (q: string, p: unknown[] = []) => sql.prepare(q).get(...(p as never[])) ?? null,
      getAllAsync: async (q: string, p: unknown[] = []) => sql.prepare(q).all(...(p as never[])),
      withTransactionAsync: async (op: (tx: TransactionDatabase) => Promise<void>) => {
        await op({
          prepareAsync: async (q: string) => {
            const stmt = sql.prepare(q);
            return { executeAsync: async (p: unknown[]) => stmt.run(...(p as never[])), finalizeAsync: async () => {} };
          },
          runAsync: async (q: string, p: unknown[] = []) => sql.prepare(q).run(...(p as never[])),
        } as unknown as TransactionDatabase);
      },
    } as unknown as AppDatabase;
  });

  afterEach(() => sql.close());

  const text = (surah: number, ayah: number) =>
    sql.prepare("SELECT text_uthmani, text_clean, text_search FROM quran_text WHERE surah = ? AND ayah = ?").get(surah, ayah);

  it("removes the Basmala from first ayahs while keeping Al-Fatiha, At-Tawba and An-Naml 27:30", async () => {
    await expect(removeBasmalaPrefixFromFirstAyahs(db)).resolves.toBe(2);
    expect(text(2, 1)).toEqual({ text_uthmani: "الٓمٓ", text_clean: "الم", text_search: "الم" });
    expect(text(114, 1)).toMatchObject({ text_uthmani: "قُلْ أَعُوذُ بِرَبِّ ٱلنَّاسِ", text_search: "قل اعوذ برب الناس" });
    expect(text(1, 1)).toMatchObject({ text_uthmani: BASMALA });
    expect(text(9, 1)).toMatchObject({ text_search: "براءة من الله" });
    expect((text(27, 30) as { text_search: string }).text_search.endsWith(BASMALA_SEARCH)).toBe(true);
  });

  it("does nothing once the data is corrected", async () => {
    await removeBasmalaPrefixFromFirstAyahs(db);
    await expect(removeBasmalaPrefixFromFirstAyahs(db)).resolves.toBe(0);
    expect(text(2, 1)).toMatchObject({ text_uthmani: "الٓمٓ" });
  });
});
