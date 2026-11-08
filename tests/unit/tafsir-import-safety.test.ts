import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { AppDatabase } from "@/lib/database/types";
import { createConnectionOwner } from "@/lib/database/connection-owner";
import { createDatabaseBridgeClient, createDatabaseBridgeHost } from "@/lib/database/bridge-connection";
import { decodeDbMessage } from "@/lib/database/bridge-messages";
import { TAFSIR_SOURCES } from "@/lib/tafsir/sources";
import { ensureTafsirSourceImported } from "@/lib/database/init";

type SourceRow = { surah: number; ayah: number; source: string; text: string };
type SourceFileLoader = (source: string, surah: number) => unknown | Promise<unknown>;

let mockPlatformOS: "android" | "web" = "android";
let mockLoadSourceFile: SourceFileLoader = () => null;
const mockLoaderCalls: { source: string; surah: number }[] = [];
const originalDecompressionStream = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");

jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
}));
jest.mock("@/lib/database/native-loaders", () => ({
  nativeRequires: {},
  nativeTafseerRequires: {},
  nativeTafsirSourceLoader: (source: string, surah: number) => () => {
    mockLoaderCalls.push({ source, surah });
    return mockLoadSourceFile(source, surah);
  },
}));
jest.mock("@/lib/database/schema", () => ({
  createSchema: jest.fn(),
  createTextSearchIndex: jest.fn(),
  migrateUserSchema: jest.fn(),
}));
jest.mock("@/lib/arabic", () => ({
  normalizeArabicCore: jest.fn((value: string) => value),
  normalizeArabicWord: jest.fn((value: string) => value),
}));
jest.mock("@/lib/reflection-journey/schema", () => ({
  buildAyahCountIndex: jest.fn(),
  computeReflectionJourneyFingerprint: jest.fn(),
  loadAndValidateReflectionJourneySeed: jest.fn(),
}));
jest.mock("../../assets/data/surah-english-names.json", () => ({ __esModule: true, default: [] }));

function isSqlInputValue(value: unknown): value is SQLInputValue {
  return (
    value === null ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string" ||
    ArrayBuffer.isView(value)
  );
}

function bindValues(args: unknown[]): SQLInputValue[] {
  const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (!values.every(isSqlInputValue)) throw new Error("Invalid synthetic SQLite binding");
  return values;
}

let sql: DatabaseSync;
let db: AppDatabase;
let owner: ReturnType<typeof createConnectionOwner>;
let beforeExecute: ((statement: string, values: SQLInputValue[]) => Promise<void>) | null;
let afterExec: ((statement: string) => void) | null;
const commands: string[] = [];
const bridgeCleanup: (() => void)[] = [];
const mutationSql: string[] = [];

function rememberMutation(statement: string) {
  if (/^\s*(?:DELETE|INSERT|REPLACE|UPDATE)\b/i.test(statement)) mutationSql.push(statement);
}

function sourceRows(source: string): SourceRow[] {
  return sql
    .prepare("SELECT surah, ayah, source, text FROM tafseer WHERE source = ? ORDER BY surah, ayah")
    .all(source)
    .map((row) => ({
      surah: Number(row.surah),
      ayah: Number(row.ayah),
      source: String(row.source),
      text: String(row.text),
    }));
}

function snapshot() {
  return {
    target: sourceRows("qurtubi"),
    unrelated: sourceRows("other-source"),
    settings: sql.prepare("SELECT key, value FROM user_settings ORDER BY key").all(),
    queue: sql.prepare("SELECT id, data, status FROM sync_queue ORDER BY id").all(),
  };
}

function addStoredRows(source: string, count: number, textPrefix: string) {
  const insert = sql.prepare("INSERT INTO tafseer (surah, ayah, source, text) VALUES (?, ?, ?, ?)");
  for (let index = 0; index < count; index += 1) {
    insert.run(1, index + 1, source, textPrefix + index);
  }
}

function syntheticFiles(uniqueCount: number, includeLastDuplicate = false): Map<number, unknown[]> {
  const files = new Map<number, unknown[]>();
  for (let index = 0; index < uniqueCount; index += 1) {
    const surah = (index % 114) + 1;
    const ayah = Math.floor(index / 114) + 1;
    const fileRows = files.get(surah) ?? [];
    const text =
      index === 0 ? "<b>tuple candidate</b>" : index === 114 ? "<i>object candidate</i>" : "synthetic row " + index;
    fileRows.push(index === 0 ? [surah, ayah, text] : { surah, ayah, text });
    files.set(surah, fileRows);
  }
  if (includeLastDuplicate) {
    const lastFile = files.get(114) ?? [];
    lastFile.push({ surah: 114, ayah: 1, text: "<p>last duplicate</p>" });
    files.set(114, lastFile);
  }
  return files;
}

function selectNativeFiles(files: Map<number, unknown[]>, rejectSurah?: number) {
  mockPlatformOS = "android";
  mockLoadSourceFile = async (source, surah) => {
    if (surah === rejectSurah) throw new Error("synthetic source-load failure at " + surah);
    return files.get(surah) ?? [];
  };
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for synthetic source loader");
}

beforeEach(() => {
  mockPlatformOS = "android";
  mockLoadSourceFile = () => null;
  mockLoaderCalls.length = 0;
  mutationSql.length = 0;
  commands.length = 0;
  bridgeCleanup.length = 0;
  beforeExecute = null;
  afterExec = null;
  sql = new DatabaseSync(":memory:");
  sql.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE tafseer (
      surah INTEGER NOT NULL,
      ayah INTEGER NOT NULL,
      source TEXT NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (surah, ayah, source)
    );
    CREATE TABLE user_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sync_queue (id INTEGER PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL);
  `);
  const raw: Parameters<typeof createConnectionOwner>[0] = {
    execAsync: async (statement) => {
      commands.push(statement);
      sql.exec(statement);
      afterExec?.(statement);
    },
    prepareAsync: async (source) => {
      const statement = sql.prepare(source);
      return {
        executeAsync: async (...args: unknown[]) => {
          const values = bindValues(args);
          await beforeExecute?.(source, values);
          rememberMutation(source);
          const result = statement.columns().length ? null : statement.run(...values);
          return {
            changes: Number(result?.changes ?? 0),
            lastInsertRowId: Number(result?.lastInsertRowid ?? 0),
            getFirstAsync: async <T>() => (statement.get(...values) as T | undefined) ?? null,
            getAllAsync: async <T>() => statement.all(...values) as T[],
          };
        },
        // Node's statement lifecycle is automatic; this is not native-finalizer evidence.
        finalizeAsync: async () => {},
      };
    },
    closeAsync: async () => sql.close(),
  };
  owner = createConnectionOwner(raw);
  db = owner.database;
  addStoredRows("qurtubi", 2, "old target ");
  addStoredRows("other-source", 1, "other ");
  sql.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run("synthetic-setting", "retained");
  sql.prepare("INSERT INTO sync_queue (id, data, status) VALUES (1, ?, 'pending')").run('{"marker":"retained"}');
});

afterEach(async () => {
  for (const cleanup of bridgeCleanup) cleanup();
  await owner.close();
  if (originalDecompressionStream) {
    Object.defineProperty(globalThis, "DecompressionStream", originalDecompressionStream);
  } else {
    Reflect.deleteProperty(globalThis, "DecompressionStream");
  }
  jest.restoreAllMocks();
});

describe("RF-155 tafsir candidate staging", () => {
  it.each(
    TAFSIR_SOURCES.filter((source) => source.importKind === "surahRows").map((source) => ({
      id: source.id,
      expected: source.expectedRows ?? 6236,
    })),
  )("keeps the $id complete-count fast path", async ({ id, expected }) => {
    sql.prepare("DELETE FROM tafseer WHERE source = 'qurtubi'").run();
    addStoredRows(id, expected, "complete ");
    mutationSql.length = 0;

    await ensureTafsirSourceImported(db, id);

    expect(mockLoaderCalls).toEqual([]);
    expect(mutationSql).toEqual([]);
    expect(sourceRows(id)).toHaveLength(expected);
  });

  it.each([1, 114])("retains all data when source file %i fails", async (failedSurah) => {
    selectNativeFiles(new Map(), failedSurah);
    const before = snapshot();

    await expect(ensureTafsirSourceImported(db, "qurtubi")).rejects.toThrow(
      "synthetic source-load failure at " + failedSurah,
    );

    expect(snapshot()).toEqual(before);
    expect(mutationSql).toEqual([]);
  });

  it("does not mutate retained data while the final source file is pending", async () => {
    let releaseFinal: ((value: unknown) => void) | undefined;
    const finalFile = new Promise<unknown>((resolve) => {
      releaseFinal = resolve;
    });
    mockLoadSourceFile = async (_source, surah) => (surah === 114 ? finalFile : []);
    const before = snapshot();
    const importing = ensureTafsirSourceImported(db, "qurtubi");
    const unavailable = expect(importing).rejects.toThrow("Tafsir source qurtubi is unavailable");

    try {
      await waitUntil(() => mockLoaderCalls.some((call) => call.surah === 114));
      expect(snapshot()).toEqual(before);
      expect(mutationSql).toEqual([]);
    } finally {
      releaseFinal?.([]);
    }

    await unavailable;
    expect(snapshot()).toEqual(before);
    expect(mutationSql).toEqual([]);
    expect(mockLoaderCalls.map((call) => call.surah)).toEqual(Array.from({ length: 114 }, (_, index) => index + 1));
  });

  it("rejects a candidate whose raw row count reaches threshold only through duplicate coordinates", async () => {
    const files = syntheticFiles(6233, true);
    selectNativeFiles(files);
    const before = snapshot();

    await expect(ensureTafsirSourceImported(db, "qurtubi")).rejects.toThrow("Tafsir source qurtubi is unavailable");

    expect(snapshot()).toEqual(before);
    expect(mutationSql).toEqual([]);
    expect(mockLoaderCalls).toHaveLength(114);
  });

  it("retains old data for unavailable and all-empty candidates", async () => {
    mockLoadSourceFile = async () => null;
    const before = snapshot();

    await expect(ensureTafsirSourceImported(db, "qurtubi")).rejects.toThrow("Tafsir source qurtubi is unavailable");

    expect(snapshot()).toEqual(before);
    expect(mutationSql).toEqual([]);
    expect(mockLoaderCalls).toHaveLength(114);
  });

  it.each(["http", "invalid JSON"])("retains old data on web %s failure", async (failureKind) => {
    mockPlatformOS = "web";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(".gz")) return new Response(null, { status: 404 });
      if (failureKind === "http") return new Response("unavailable", { status: 503 });
      return new Response("{", { status: 200 });
    });
    const before = snapshot();

    await expect(ensureTafsirSourceImported(db, "qurtubi")).rejects.toThrow();

    expect(snapshot()).toEqual(before);
    expect(mutationSql).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("falls back from a failed optional gzip request to complete synthetic JSON files", async () => {
    const files = syntheticFiles(6234, true);
    mockPlatformOS = "web";
    Object.defineProperty(globalThis, "DecompressionStream", {
      configurable: true,
      value: class SyntheticDecompressionStream {},
    });
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(".gz")) return new Response(null, { status: 404 });
      const match = /\/(\d+)\.json$/.exec(url);
      const surah = Number(match?.[1]);
      return new Response(JSON.stringify(files.get(surah) ?? []), { status: 200 });
    });

    await ensureTafsirSourceImported(db, "qurtubi");

    expect(sourceRows("qurtubi")).toHaveLength(6234);
    expect(sourceRows("other-source")).toHaveLength(1);
    expect(sourceRows("qurtubi").find((row) => row.surah === 1 && row.ayah === 1)?.text).toBe("tuple candidate");
    expect(sourceRows("qurtubi").find((row) => row.surah === 1 && row.ayah === 2)?.text).toBe("object candidate");
    expect(sourceRows("qurtubi").find((row) => row.surah === 114 && row.ayah === 1)?.text).toBe("last duplicate");
    expect(fetchMock).toHaveBeenCalledTimes(228);
  });

  it("retries after a failed candidate and replaces only its source with the complete last-wins candidate", async () => {
    mockLoadSourceFile = async (_source, surah) => {
      if (surah === 1) throw new Error("synthetic retryable loader failure");
      return [];
    };
    const before = snapshot();
    await expect(ensureTafsirSourceImported(db, "qurtubi")).rejects.toThrow("synthetic retryable loader failure");
    expect(snapshot()).toEqual(before);
    expect(mutationSql).toEqual([]);

    const completeFiles = syntheticFiles(6234, true);
    const finalRows = completeFiles.get(114) ?? [];
    finalRows.push(
      { surah: 114, ayah: 101, text: 42 },
      { surah: 114, ayah: 102, text: true },
      { surah: "114", ayah: 103, text: "invalid string coordinate" },
      { surah: 114, ayah: "104", text: "invalid string coordinate" },
      { surah: 114, ayah: 105.5, text: "non-integer coordinate" },
      { surah: 114, ayah: 106, text: "<p><br></p>" },
      null,
    );
    completeFiles.set(114, finalRows);
    selectNativeFiles(completeFiles);
    mutationSql.length = 0;
    await ensureTafsirSourceImported(db, "qurtubi");

    expect(sourceRows("qurtubi")).toHaveLength(6236);
    expect(sourceRows("other-source")).toHaveLength(1);
    expect(sql.prepare("SELECT key, value FROM user_settings ORDER BY key").all()).toEqual([
      { key: "synthetic-setting", value: "retained" },
    ]);
    expect(sql.prepare("SELECT id, data, status FROM sync_queue ORDER BY id").all()).toEqual([
      { id: 1, data: '{"marker":"retained"}', status: "pending" },
    ]);
    expect(sourceRows("qurtubi").find((row) => row.surah === 114 && row.ayah === 1)?.text).toBe("last duplicate");
    expect(sourceRows("qurtubi").find((row) => row.surah === 114 && row.ayah === 101)?.text).toBe("42");
    expect(sourceRows("qurtubi").find((row) => row.surah === 114 && row.ayah === 102)?.text).toBe("true");
    expect(
      sourceRows("qurtubi").some(
        (row) => row.surah === 114 && (row.ayah === 103 || row.ayah === 104 || row.ayah === 105.5 || row.ayah === 106),
      ),
    ).toBe(false);
  });
});

describe("RF104 atomic tafsir replacement", () => {
  it.each(["tuple candidate", "synthetic row 700"])(
    "restores retained content after SQLite rejects %s",
    async (failedText) => {
      selectNativeFiles(syntheticFiles(6234));
      // The trigger text is a fixed synthetic fixture value, bound through a one-row guard table.
      sql.exec("CREATE TEMP TABLE rejected_text (value TEXT)");
      sql.prepare("INSERT INTO rejected_text VALUES (?)").run(failedText);
      sql.exec(`CREATE TEMP TRIGGER fail_tafsir_insert BEFORE INSERT ON tafseer
      WHEN NEW.source='qurtubi' AND NEW.text IN (SELECT value FROM rejected_text)
      BEGIN SELECT RAISE(ABORT, 'synthetic replacement insert rejected'); END`);
      const before = snapshot();
      await expect(ensureTafsirSourceImported(db, "qurtubi")).rejects.toThrow("synthetic replacement insert rejected");
      expect(snapshot()).toEqual(before);
      expect(commands.filter((command) => command === "ROLLBACK")).toHaveLength(1);
      sql.exec("DROP TRIGGER fail_tafsir_insert");
      await ensureTafsirSourceImported(db, "qurtubi");
      expect(sourceRows("qurtubi")).toHaveLength(6234);
      expect(sourceRows("other-source")).toEqual(before.unrelated);
      expect(snapshot().settings).toEqual(before.settings);
      expect(snapshot().queue).toEqual(before.queue);
    },
  );

  it("restores the old generation after a real deferred-constraint COMMIT failure and can retry", async () => {
    selectNativeFiles(syntheticFiles(6234));
    sql.exec(`CREATE TEMP TABLE commit_parent (id INTEGER PRIMARY KEY);
      CREATE TEMP TABLE commit_tripwire (parent_id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TEMP TRIGGER fail_tafsir_commit AFTER INSERT ON tafseer
      WHEN NEW.source='qurtubi' AND NEW.text='tuple candidate'
      BEGIN INSERT INTO commit_tripwire VALUES (999); END;`);
    const before = snapshot();
    await expect(ensureTafsirSourceImported(db, "qurtubi")).rejects.toThrow("FOREIGN KEY constraint failed");
    expect(commands.filter((command) => command === "COMMIT")).toHaveLength(1);
    expect(commands.filter((command) => command === "ROLLBACK")).toHaveLength(1);
    expect(snapshot()).toEqual(before);
    expect(sql.prepare("SELECT count(*) AS count FROM commit_tripwire").get()).toEqual({ count: 0 });
    sql.exec("DROP TRIGGER fail_tafsir_commit");
    await ensureTafsirSourceImported(db, "qurtubi");
    expect(sourceRows("qurtubi")).toHaveLength(6234);
    expect(sourceRows("other-source")).toEqual(before.unrelated);
    expect(snapshot().settings).toEqual(before.settings);
    expect(snapshot().queue).toEqual(before.queue);
  });

  it("treats a successful COMMIT with a lost acknowledgement as unknown without partial replay", async () => {
    selectNativeFiles(syntheticFiles(6234));
    const lostAck = Object.freeze(new Error("synthetic lost COMMIT acknowledgement"));
    const before = snapshot();
    afterExec = (command) => {
      if (command === "COMMIT") throw lostAck;
    };
    await expect(ensureTafsirSourceImported(db, "qurtubi")).rejects.toMatchObject({ primaryError: lostAck });
    expect(commands.filter((command) => command === "COMMIT")).toHaveLength(1);
    expect(commands.filter((command) => command === "ROLLBACK")).toHaveLength(1);
    expect(sourceRows("qurtubi")).toHaveLength(6234);
    expect(sourceRows("qurtubi").some((row) => row.text.startsWith("old target "))).toBe(false);
    expect(sourceRows("other-source")).toEqual(before.unrelated);
    expect(snapshot().settings).toEqual(before.settings);
    expect(snapshot().queue).toEqual(before.queue);
    await expect(ensureTafsirSourceImported(db, "qurtubi")).rejects.toThrow("no longer active");
  });
});

function gate() {
  let entered = false,
    release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release,
    async waitForStart() {
      await waitUntil(() => entered);
    },
    async wait() {
      entered = true;
      await waiting;
    },
  };
}

function generationFiles(count: number, generation: string, extra = false) {
  const files = syntheticFiles(count);
  for (const [surah, rows] of files) {
    files.set(
      surah,
      rows.map((value) => {
        if (Array.isArray(value)) return [value[0], value[1], generation + String(value[2])];
        if (value && typeof value === "object" && "text" in value)
          return { ...value, text: generation + String(value.text) };
        throw new Error("Invalid synthetic generation");
      }),
    );
  }
  if (extra) (files.get(114) ?? []).push({ surah: 114, ayah: 999, text: generation + "extra" });
  return files;
}

describe("RF104 concurrent source generations", () => {
  it.each(["qurtubi", "jalalayn"] as const)(
    "serializes a qurtubi replacement with %s and an ordinary write",
    async (secondSource) => {
      const aFinal = gate(),
        bFinal = gate(),
        firstInsert = gate();
      const aFiles = generationFiles(6234, "A:", true);
      const secondCount = TAFSIR_SOURCES.find((source) => source.id === secondSource)?.expectedRows ?? 6236;
      const bFiles = generationFiles(secondCount, "B:");
      let generation = 0;
      mockLoadSourceFile = async (_source, surah) => {
        if (surah === 1) generation += 1;
        const first = generation === 1;
        const rows = (first ? aFiles : bFiles).get(surah) ?? [];
        if (surah === 114) await (first ? aFinal : bFinal).wait();
        return rows;
      };
      let held = false,
        seenAtOrdinaryWrite: number | undefined;
      beforeExecute = async (statement, values) => {
        if (!held && /INSERT OR REPLACE INTO tafseer/.test(statement) && String(values[3]).startsWith("A:")) {
          held = true;
          await firstInsert.wait();
        }
        if (statement === "INSERT INTO user_settings VALUES (?, ?)" && values[0] === "ordinary-write")
          seenAtOrdinaryWrite = sourceRows("qurtubi").length;
      };
      const first = ensureTafsirSourceImported(db, "qurtubi");
      void first.catch(() => {});
      let second: Promise<void> | undefined;
      let ordinary: ReturnType<AppDatabase["runAsync"]> | undefined;
      try {
        await aFinal.waitForStart();
        second = ensureTafsirSourceImported(db, secondSource);
        void second.catch(() => {});
        await bFinal.waitForStart();
        aFinal.release();
        await firstInsert.waitForStart();
        ordinary = db.runAsync("INSERT INTO user_settings VALUES (?, ?)", "ordinary-write", "retained");
        bFinal.release();
        // Both candidates are staged while the first actual INSERT is held.
        for (let index = 0; index < 80; index++) await Promise.resolve();
      } finally {
        aFinal.release();
        bFinal.release();
        firstInsert.release();
      }
      await Promise.all([first, second, ordinary]);
      expect(seenAtOrdinaryWrite).toBe(6235);
      const expectedTargetCount = secondSource === "qurtubi" ? secondCount : 6235;
      expect(sourceRows("qurtubi")).toHaveLength(expectedTargetCount);
      expect(sourceRows("qurtubi").every((row) => row.text.startsWith(secondSource === "qurtubi" ? "B:" : "A:"))).toBe(
        true,
      );
      if (secondSource !== "qurtubi") {
        expect(sourceRows(secondSource)).toHaveLength(secondCount);
        expect(sourceRows(secondSource).every((row) => row.text.startsWith("B:"))).toBe(true);
      }
      expect(sourceRows("other-source")).toHaveLength(1);
      expect(sql.prepare("SELECT value FROM user_settings WHERE key='ordinary-write'").get()).toEqual({
        value: "retained",
      });
      expect(sql.prepare("SELECT value FROM user_settings WHERE key='synthetic-setting'").get()).toEqual({
        value: "retained",
      });
      expect(snapshot().queue).toEqual([{ id: 1, data: '{"marker":"retained"}', status: "pending" }]);
    },
  );
});

function bridgeClients() {
  const clients: ReturnType<typeof createDatabaseBridgeClient>[] = [];
  let serial = 0;
  const host = createDatabaseBridgeHost(owner, {
    hostId: "synthetic-tafsir-host",
    isActive: () => true,
    uniqueId: () => "token-" + ++serial,
    postMessage(message) {
      if (message.type === "response") for (const client of clients) client.handleResponse(message);
      return true;
    },
  });
  function client(tabId: string) {
    const client = createDatabaseBridgeClient({
      tabId,
      hostId: "synthetic-tafsir-host",
      isActive: () => true,
      uniqueId: () => "request-" + ++serial,
      onDisconnect: () => {},
      postMessage(value) {
        const message = decodeDbMessage(value);
        if (message?.type === "request") void host.handleRequest(message);
        return true;
      },
    });
    clients.push(client);
    return client.database;
  }
  bridgeCleanup.push(() => {
    for (const client of clients) client.retire(new Error("Synthetic fixture finished"));
    host.retire(new Error("Synthetic fixture finished"));
  });
  return [client("import-tab"), client("ordinary-tab")] as const;
}

describe("RF104 bridge importer integration", () => {
  it("rolls back a remote replacement failure before admitting another tab's ordinary write", async () => {
    selectNativeFiles(syntheticFiles(6234));
    sql.exec(`CREATE TEMP TRIGGER fail_remote_import BEFORE INSERT ON tafseer
      WHEN NEW.source='qurtubi' AND NEW.text='synthetic row 700'
      BEGIN SELECT RAISE(ABORT, 'synthetic remote insert rejected'); END;`);
    const before = snapshot();
    const firstInsert = gate();
    let held = false;
    beforeExecute = async (statement) => {
      if (!held && /INSERT OR REPLACE INTO tafseer/.test(statement)) {
        held = true;
        await firstInsert.wait();
      }
    };
    const [remote, ordinaryTab] = bridgeClients();
    const importing = ensureTafsirSourceImported(remote, "qurtubi");
    const failed = expect(importing).rejects.toThrow("synthetic remote insert rejected");
    let ordinary: ReturnType<AppDatabase["runAsync"]> | undefined;
    try {
      await firstInsert.waitForStart();
      ordinary = ordinaryTab.runAsync("INSERT INTO user_settings VALUES (?, ?)", "other-tab", "retained");
    } finally {
      firstInsert.release();
    }
    await failed;
    await ordinary;
    expect(sourceRows("qurtubi")).toEqual(before.target);
    expect(sourceRows("other-source")).toEqual(before.unrelated);
    expect(snapshot().queue).toEqual(before.queue);
    expect(sql.prepare("SELECT key, value FROM user_settings ORDER BY key").all()).toEqual([
      { key: "other-tab", value: "retained" },
      { key: "synthetic-setting", value: "retained" },
    ]);
    expect(commands.filter((command) => command === "ROLLBACK")).toHaveLength(1);
  });
});
