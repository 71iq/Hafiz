import { DatabaseSync } from "node:sqlite";
import type { DatabaseExecutor } from "@/lib/database/types";
import { getLocalSurahProgress } from "@/lib/profile/progress";

jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => false, supabase: {} }));

// The hifz plan's cards (page, half, seam, chunk) and weak-spot cloze cards have ids with no surah
// before the first colon. Read as surah 0, one of them failed the server's 1 to 114 check and with it
// the whole upload of the account's surah progress, after every sync (found on an Android phone).
describe("local surah progress with hifz cards", () => {
  let sql: DatabaseSync;
  let db: DatabaseExecutor;

  beforeEach(() => {
    sql = new DatabaseSync(":memory:");
    sql.exec(`CREATE TABLE study_cards (
      id TEXT PRIMARY KEY, deck_id TEXT NOT NULL, reps INTEGER NOT NULL DEFAULT 0,
      last_review TEXT, deleted_at TEXT)`);
    sql.exec("CREATE TABLE surahs (number INTEGER PRIMARY KEY, name_arabic TEXT, name_english TEXT)");
    sql.exec("INSERT INTO surahs VALUES (78, 'النبإ', 'An-Naba'), (80, 'عبس', 'Abasa')");
    db = {
      getAllAsync: async (query: string, params: unknown[] = []) =>
        sql.prepare(query).all(...(params as (string | number | null)[])),
    } as unknown as DatabaseExecutor;
  });

  afterEach(() => sql.close());

  function card(id: string, deckId: string, reps = 0) {
    sql.prepare("INSERT INTO study_cards (id, deck_id, reps) VALUES (?, ?, ?)").run(id, deckId, reps);
  }

  it("counts ayah cards by surah and leaves out every card whose id has no surah", async () => {
    card("78:1", "default-ayah", 2);
    card("78:2", "default-ayah");
    card("80:24", "default-ayah", 1);
    card("page:madani15:582", "hifz-pages", 3);
    card("half:madani15:582:a", "hifz-pages", 1);
    card("seam:madani15:582", "hifz-pages");
    card("chunk:madani15:581:1-7", "hifz-sabaq", 1);
    card("cloze:78:3:4", "hifz-pages");
    card("0:1", "default-ayah");
    card("115:1", "default-ayah");
    card("7a:1", "default-ayah");

    const rows = await getLocalSurahProgress(db);

    expect(rows.map(({ surah, totalCards, memorized }) => ({ surah, totalCards, memorized }))).toEqual([
      { surah: 78, totalCards: 2, memorized: 1 },
      { surah: 80, totalCards: 1, memorized: 1 },
    ]);
    expect(rows.every((row) => row.surah >= 1 && row.surah <= 114)).toBe(true);
  });
});
