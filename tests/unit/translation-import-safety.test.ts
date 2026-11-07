import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createConnectionOwner } from "@/lib/database/connection-owner";
import { importTranslation } from "@/lib/translations/import";

type TranslationRow = { surah: number; ayah: number; text: string };
let mockLoadTranslation: (code: string) => Promise<TranslationRow[] | null>;
jest.mock("@/lib/translations/translation-requires", () => ({
  loadTranslation: (code: string) => mockLoadTranslation(code),
}));

let sqlite: DatabaseSync;
let owner: ReturnType<typeof createConnectionOwner>;
let beforeExecute: ((source: string, values: SQLInputValue[]) => Promise<void>) | null;
let afterExec: ((source: string) => void) | null;
const commands: string[] = [];
const releases: (() => void)[] = [];

function candidate(prefix = "candidate:", count = 1001): TranslationRow[] {
  return Array.from({ length: count }, (_, index) => ({ surah: 1, ayah: index + 1, text: prefix + (index + 1) }));
}
function valuesFrom(args: unknown[]): SQLInputValue[] {
  const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (
    !values.every(
      (value): value is SQLInputValue =>
        value === null ||
        typeof value === "number" ||
        typeof value === "string" ||
        typeof value === "bigint" ||
        ArrayBuffer.isView(value),
    )
  )
    throw new Error("Invalid synthetic translation binding");
  return values;
}
function rows() {
  return sqlite.prepare("SELECT surah,ayah,text FROM translation_active ORDER BY surah,ayah").all();
}
function snapshot() {
  return {
    target: rows(),
    other: sqlite.prepare("SELECT * FROM other_content").all(),
    settings: sqlite.prepare("SELECT * FROM user_settings ORDER BY key").all(),
    queue: sqlite.prepare("SELECT * FROM sync_queue ORDER BY id").all(),
  };
}
function gate() {
  let entered = false,
    release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return {
    release,
    async wait() {
      entered = true;
      await waiting;
    },
    async waitForStart() {
      for (let index = 0; index < 100; index++) {
        if (entered) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      throw new Error("Synthetic translation barrier was never reached");
    },
  };
}
beforeEach(() => {
  commands.length = 0;
  releases.length = 0;
  beforeExecute = null;
  afterExec = null;
  mockLoadTranslation = async () => candidate();
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE translation_active (surah INTEGER NOT NULL,ayah INTEGER NOT NULL,text TEXT NOT NULL,
      PRIMARY KEY(surah,ayah));
    CREATE TABLE other_content (value TEXT);
    INSERT INTO other_content VALUES ('unrelated retained');
    CREATE TABLE user_settings (key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO user_settings VALUES ('translation_active_lang','old-language');
    CREATE TABLE sync_queue (id INTEGER PRIMARY KEY,data TEXT,status TEXT);
    INSERT INTO sync_queue VALUES (1,'retained queue','pending');
    INSERT INTO translation_active VALUES (1,1,'old one'),(1,2,'old two');`);
  const raw: Parameters<typeof createConnectionOwner>[0] = {
    async execAsync(source) {
      commands.push(source);
      sqlite.exec(source);
      afterExec?.(source);
    },
    async prepareAsync(source) {
      const statement = sqlite.prepare(source);
      return {
        async executeAsync(...args: unknown[]) {
          const values = valuesFrom(args);
          await beforeExecute?.(source, values);
          const result = statement.columns().length ? null : statement.run(...values);
          return {
            changes: Number(result?.changes ?? 0),
            lastInsertRowId: Number(result?.lastInsertRowid ?? 0),
            getFirstAsync: async <T>() => (statement.get(...values) as T | undefined) ?? null,
            getAllAsync: async <T>() => statement.all(...values) as T[],
          };
        },
        // Node owns StatementSync finalization. Actual SDK behavior is covered separately.
        async finalizeAsync() {},
      };
    },
    async closeAsync() {
      sqlite.close();
    },
  };
  owner = createConnectionOwner(raw);
});
afterEach(async () => {
  for (const release of releases) release();
  await owner.close();
});

describe("atomic active-translation replacement", () => {
  it.each(["throws", "missing"] as const)("retains content and metadata when the loader %s", async (mode) => {
    const failure = Object.freeze(new Error("synthetic loader rejected"));
    mockLoadTranslation = async () => {
      if (mode === "throws") throw failure;
      return null;
    };
    const before = snapshot();
    const importing = importTranslation(owner.database, "synthetic-language");
    if (mode === "throws") await expect(importing).rejects.toBe(failure);
    else await expect(importing).rejects.toThrow("No bundled translation for language: synthetic-language");
    expect(snapshot()).toEqual(before);
    expect(commands).toEqual([]);
  });

  it("keeps the old generation while an asynchronous load is pending", async () => {
    const loading = gate();
    const before = snapshot();
    mockLoadTranslation = async () => {
      await loading.wait();
      return candidate();
    };
    const importing = importTranslation(owner.database, "synthetic-language");
    try {
      await loading.waitForStart();
      expect(snapshot()).toEqual(before);
      expect(commands).toEqual([]);
    } finally {
      loading.release();
    }
    await importing;
    expect(rows()).toEqual(candidate());
  });

  it("replaces the complete candidate without changing other content or language metadata", async () => {
    const before = snapshot();
    await importTranslation(owner.database, "synthetic-language");
    expect(rows()).toEqual(candidate());
    expect(snapshot()).toEqual({ ...before, target: candidate() });
  });

  it.each(["candidate:1", "candidate:701"])(
    "rolls back an actual SQLite INSERT rejection at %s and retries",
    async (failedText) => {
      sqlite.exec("CREATE TEMP TABLE rejected_translation (value TEXT)");
      sqlite.prepare("INSERT INTO rejected_translation VALUES (?)").run(failedText);
      sqlite.exec(`CREATE TEMP TRIGGER reject_translation BEFORE INSERT ON translation_active
      WHEN NEW.text IN (SELECT value FROM rejected_translation)
      BEGIN SELECT RAISE(ABORT,'synthetic translation INSERT rejected'); END;`);
      const before = snapshot();
      await expect(importTranslation(owner.database, "synthetic-language")).rejects.toThrow(
        "synthetic translation INSERT rejected",
      );
      expect(snapshot()).toEqual(before);
      expect(commands.filter((source) => source === "ROLLBACK")).toHaveLength(1);
      sqlite.exec("DROP TRIGGER reject_translation");
      await importTranslation(owner.database, "synthetic-language");
      expect(snapshot()).toEqual({ ...before, target: candidate() });
    },
  );

  it("rolls back an actual deferred-constraint COMMIT failure and retries", async () => {
    sqlite.exec(`CREATE TEMP TABLE commit_parent (id INTEGER PRIMARY KEY);
      CREATE TEMP TABLE commit_child (parent_id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TEMP TRIGGER reject_translation_commit AFTER INSERT ON translation_active
      WHEN NEW.text='candidate:701' BEGIN INSERT INTO commit_child VALUES (999); END;`);
    const before = snapshot();
    await expect(importTranslation(owner.database, "synthetic-language")).rejects.toThrow(
      "FOREIGN KEY constraint failed",
    );
    expect(snapshot()).toEqual(before);
    expect(commands.filter((source) => source === "ROLLBACK")).toHaveLength(1);
    sqlite.exec("DROP TRIGGER reject_translation_commit");
    await importTranslation(owner.database, "synthetic-language");
    expect(snapshot()).toEqual({ ...before, target: candidate() });
  });

  it("publishes complete last-admitted generations around an unrelated write", async () => {
    const aLoad = gate(),
      bLoad = gate(),
      aInsert = gate();
    const before = snapshot();
    mockLoadTranslation = async (code) => {
      await (code === "A" ? aLoad : bLoad).wait();
      return candidate(code + ":", code === "A" ? 1002 : 1001);
    };
    let held = false,
      observedCount: number | undefined;
    beforeExecute = async (source, values) => {
      if (!held && source.startsWith("INSERT INTO translation_active") && values[2] === "A:1") {
        held = true;
        await aInsert.wait();
      }
      if (source === "INSERT INTO user_settings VALUES (?, ?)") observedCount = rows().length;
    };
    const first = importTranslation(owner.database, "A"),
      second = importTranslation(owner.database, "B");
    void first.catch(() => {});
    void second.catch(() => {});
    let ordinary: Promise<unknown> | undefined;
    try {
      await aLoad.waitForStart();
      await bLoad.waitForStart();
      aLoad.release();
      await aInsert.waitForStart();
      ordinary = owner.database.runAsync("INSERT INTO user_settings VALUES (?, ?)", "ordinary-write", "retained");
      bLoad.release();
      for (let index = 0; index < 80; index++) await Promise.resolve();
    } finally {
      aLoad.release();
      bLoad.release();
      aInsert.release();
    }
    await Promise.all([first, second, ordinary]);
    expect(observedCount).toBe(1002);
    expect(rows()).toEqual(candidate("B:", 1001));
    expect(snapshot().other).toEqual(before.other);
    expect(snapshot().queue).toEqual(before.queue);
    expect(snapshot().settings).toEqual([{ key: "ordinary-write", value: "retained" }, ...before.settings]);
  });

  it("never replays a successful COMMIT whose acknowledgement was lost", async () => {
    const failure = Object.freeze(new Error("synthetic translation COMMIT acknowledgement lost"));
    const before = snapshot();
    afterExec = (source) => {
      if (source === "COMMIT") throw failure;
    };
    await expect(importTranslation(owner.database, "synthetic-language")).rejects.toMatchObject({
      primaryError: failure,
    });
    expect(snapshot()).toEqual({ ...before, target: candidate() });
    expect(commands.filter((source) => source === "COMMIT")).toHaveLength(1);
    await expect(importTranslation(owner.database, "synthetic-language")).rejects.toThrow("no longer active");
  });
});
