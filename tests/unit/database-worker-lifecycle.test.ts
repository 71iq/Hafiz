import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { TextEncoder, TextDecoder } from "node:util";
import ts from "typescript";

const workerPath = path.join(process.cwd(), "node_modules/expo-sqlite/web/worker.ts");
const workerSource = fs.readFileSync(workerPath, "utf8");
const workerJavaScript = ts.transpileModule(workerSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

function deferred() {
  let resolve!: (value?: void | PromiseLike<void>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type WorkerReply = { id: number; error: Error | null; result: unknown };
type VfsFixture = { close: () => unknown; jAccess?: (...args: unknown[]) => unknown };
type HarnessOptions = {
  persistentCreate?: (...args: unknown[]) => Promise<VfsFixture>;
  memoryCreate?: (...args: unknown[]) => Promise<VfsFixture>;
  fetchImpl?: () => Promise<{ ok: boolean; statusText: string; arrayBuffer: () => Promise<ArrayBuffer> }>;
};
type Options = {
  enableChangeListener?: boolean;
  useNewConnection?: boolean;
  finalizeUnusedStatementsBeforeClosing?: boolean;
};
function createHarness({ persistentCreate, memoryCreate, fetchImpl }: HarnessOptions = {}) {
  const events: string[] = [];
  const createPersistent =
    persistentCreate ?? (async () => ({ close: async () => events.push("persistent.close"), jAccess: async () => {} }));
  const createMemory = memoryCreate ?? (async () => ({ close: async () => events.push("memory.close") }));
  const fetchAsset =
    fetchImpl ?? (async () => ({ ok: true, statusText: "OK", arrayBuffer: async () => new ArrayBuffer(0) }));
  const replies: WorkerReply[] = [];
  const openCalls: { args: unknown[]; pointer: number }[] = [];
  let nextPointer = 10;
  let factoryCalls = 0;
  const sqlite3 = {
    vfs_register: (vfs: unknown) => events.push(vfs === null ? "vfs.register.null" : "vfs.register"),
    open_v2: async (...args: unknown[]) => {
      const pointer = nextPointer++;
      openCalls.push({ args, pointer });
      events.push(`sqlite.open:${pointer}`);
      return pointer;
    },
    close: async (pointer: number) => {
      events.push(`sqlite.close:${pointer}`);
      return 0;
    },
    next_stmt: (_database: number, previous: number | null) => (previous == null ? 71 : 0),
    finalize: async (pointer: number) => {
      events.push(`sqlite.finalize:${pointer}`);
      return 0;
    },
    exec: async (pointer: number, sql: string) => events.push(`sqlite.exec:${pointer}:${sql}`),
    deserialize: async () => {},
    backup: async () => {},
    statements: () => ({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ value: 71 }), return: async () => ({ done: true }) }),
    }),
    update_hook: () => {},
  };

  const imports: Record<string, unknown> = {
    "./SQLAction": { createSQLAction: (value: unknown) => value },
    "./SQLiteOptions": {
      SQLiteOptions: class SQLiteOptions {
        enableChangeListener: boolean;
        useNewConnection: boolean;
        finalizeUnusedStatementsBeforeClosing: boolean;
        constructor(options: Options = {}) {
          this.enableChangeListener = options.enableChangeListener ?? false;
          this.useNewConnection = options.useNewConnection ?? false;
          this.finalizeUnusedStatementsBeforeClosing = options.finalizeUnusedStatementsBeforeClosing ?? true;
        }
        equals(other: Options) {
          return (
            this.enableChangeListener === other.enableChangeListener &&
            this.useNewConnection === other.useNewConnection &&
            this.finalizeUnusedStatementsBeforeClosing === other.finalizeUnusedStatementsBeforeClosing
          );
        }
      },
    },
    "./WorkerChannel": {
      sendWorkerResult: (reply: WorkerReply) => {
        replies.push(reply);
        events.push(`reply:${reply.id}`);
      },
    },
    "./wa-sqlite/AccessHandlePoolVFS": {
      AccessHandlePoolVFS: {
        create: async (...args: unknown[]) => {
          events.push("persistent.create");
          return createPersistent(...args);
        },
      },
    },
    "./wa-sqlite/MemoryVFS": {
      MemoryVFS: {
        create: async (...args: unknown[]) => {
          events.push("memory.create");
          return createMemory(...args);
        },
      },
    },
    "./wa-sqlite/sqlite-api": { Factory: (module: { sqlite3: unknown }) => module.sqlite3 },
    "./wa-sqlite/sqlite-constants": {
      SQLITE_ROW: 100,
      SQLITE_DONE: 101,
      SQLITE_OK: 0,
      SQLITE_OPEN_READWRITE: 2,
      SQLITE_OPEN_CREATE: 4,
      SQLITE_INTEGER: 1,
      SQLITE_FLOAT: 2,
      SQLITE_TEXT: 3,
      SQLITE_BLOB: 4,
      SQLITE_NULL: 5,
    },
    "./wa-sqlite/wa-sqlite": async () => {
      factoryCalls += 1;
      events.push("wasm.init");
      return { sqlite3 };
    },
    "./wa-sqlite/wa-sqlite.wasm": { default: {} },
  };
  const self: { onmessage: ((event: unknown) => Promise<void>) | null } = { onmessage: null };
  const module = { exports: {} };
  const context = {
    exports: module.exports,
    module,
    require: (specifier: string) => {
      if (!(specifier in imports)) throw new Error(`Unexpected worker import: ${specifier}`);
      return imports[specifier];
    },
    self,
    fetch: fetchAsset,
    DataView,
    ArrayBuffer,
    Uint8Array,
    BigInt,
    Number,
    Map,
    Set,
    Promise,
    Error,
    console,
  };
  vm.runInNewContext(workerJavaScript, context, { filename: workerPath });

  return {
    events,
    replies,
    openCalls,
    sqlite3,
    get factoryCalls() {
      return factoryCalls;
    },
    dispatch(type: string, data: Record<string, unknown>, id = replies.length + 1) {
      const handler = self.onmessage;
      if (!handler) throw new Error("Worker message handler was not installed");
      return handler({ data: { id, type, data } });
    },
  };
}

const open = (nativeDatabaseId: number, databasePath = `db-${nativeDatabaseId}.sqlite`) => ({
  nativeDatabaseId,
  databasePath,
  options: {},
});

function replyFor(harness: ReturnType<typeof createHarness>, id: number) {
  return harness.replies.find((reply) => reply.id === id);
}

describe("installed Expo SQLite web worker lifecycle (current source)", () => {
  test("serializes concurrent first opens through one WASM and VFS initialization", async () => {
    const gate = deferred();
    const poolStarted = deferred();
    let poolCreateCount = 0;
    const harness = createHarness({
      persistentCreate: async () => {
        poolCreateCount += 1;
        poolStarted.resolve();
        await gate.promise;
        return { close: async () => {}, jAccess: async () => {} };
      },
    });

    const first = harness.dispatch("open", open(1), 1);
    const second = harness.dispatch("open", open(2), 2);
    await poolStarted.promise;
    expect(harness.factoryCalls).toBe(1);
    expect(poolCreateCount).toBe(1);
    expect(harness.openCalls).toHaveLength(0);
    gate.resolve();
    await Promise.all([first, second]);

    expect(harness.replies.map((reply) => reply.id)).toEqual([1, 2]);
    expect(harness.replies.every((reply) => reply.error == null)).toBe(true);
    expect(harness.openCalls).toHaveLength(2);
    expect(harness.events.filter((event) => event === "memory.create")).toHaveLength(1);
  });

  test("retries initialization after VFS creation fails without retaining partial state", async () => {
    let attempts = 0;
    const harness = createHarness({
      persistentCreate: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("first VFS attempt failed");
        return { close: async () => {}, jAccess: async () => {} };
      },
    });

    await harness.dispatch("open", open(1), 1);
    expect(replyFor(harness, 1)?.error?.message).toContain("first VFS attempt failed");
    await harness.dispatch("open", open(2), 2);

    expect(replyFor(harness, 2)?.error).toBeFalsy();
    expect(attempts).toBe(2);
    expect(harness.openCalls).toHaveLength(1);
    expect(harness.events.filter((event) => event.startsWith("reply:"))).toEqual(["reply:1", "reply:2"]);
  });

  test("finalizes before SQL close and retires both VFS layers before the last-close reply", async () => {
    const harness = createHarness();
    await harness.dispatch("open", open(1), 1);
    harness.events.length = 0;

    await harness.dispatch("close", { nativeDatabaseId: 1 }, 2);

    expect(replyFor(harness, 2)?.error).toBeFalsy();
    expect(harness.events).toEqual([
      "sqlite.finalize:71",
      "sqlite.close:10",
      "persistent.close",
      "memory.close",
      "reply:2",
    ]);
  });

  test("holds the close reply and queued reopen until VFS retirement completes", async () => {
    const gate = deferred();
    const closeStarted = deferred();
    let closeCount = 0;
    const harness = createHarness({
      persistentCreate: async () => ({
        close: async () => {
          closeCount += 1;
          if (closeCount === 1) {
            closeStarted.resolve();
            await gate.promise;
          }
          harness.events.push("persistent.close");
        },
        jAccess: async () => {},
      }),
    });
    await harness.dispatch("open", open(1), 1);

    const closeWork = harness.dispatch("close", { nativeDatabaseId: 1 }, 2);
    await closeStarted.promise;
    expect(replyFor(harness, 2)).toBeUndefined();
    const reopenWork = harness.dispatch("open", open(2), 3);
    expect(harness.openCalls).toHaveLength(1);

    gate.resolve();
    await Promise.all([closeWork, reopenWork]);
    expect(replyFor(harness, 2)?.error).toBeFalsy();
    expect(replyFor(harness, 3)?.error).toBeFalsy();
    expect(harness.openCalls).toHaveLength(2);
    expect(harness.factoryCalls).toBe(2);
  });

  test("keeps shared VFS alive while another database remains, then reopens a fresh runtime", async () => {
    const harness = createHarness();
    await harness.dispatch("open", open(1), 1);
    await harness.dispatch("open", open(2), 2);
    harness.events.length = 0;

    await harness.dispatch("close", { nativeDatabaseId: 1 }, 3);
    expect(harness.events).not.toContain("persistent.close");
    expect(harness.events).not.toContain("memory.close");

    await harness.dispatch("close", { nativeDatabaseId: 2 }, 4);
    expect(harness.events).toContain("persistent.close");
    expect(harness.events).toContain("memory.close");
    await harness.dispatch("open", open(3), 5);
    expect(replyFor(harness, 5)?.error).toBeFalsy();
    expect(harness.factoryCalls).toBe(2);
  });

  test.each(["SQL close", "statement finalize"])(
    "%s failure quarantines the runtime and retains VFS ownership",
    async (failure) => {
      const harness = createHarness();
      await harness.dispatch("open", open(1), 1);
      if (failure === "SQL close") {
        harness.sqlite3.close = async () => {
          harness.events.push("sqlite.close.failed");
          throw new Error("SQL close failed");
        };
      } else {
        harness.sqlite3.finalize = async () => {
          harness.events.push("sqlite.finalize.failed");
          throw new Error("statement finalize failed");
        };
      }

      await harness.dispatch("close", { nativeDatabaseId: 1 }, 2);
      expect(replyFor(harness, 2)?.error?.message).toContain("SQLite worker cleanup failed:");
      expect(harness.events).not.toContain("persistent.close");
      expect(harness.events).not.toContain("memory.close");
      await harness.dispatch("exec", { nativeDatabaseId: 1, source: "SELECT 1" }, 3);
      expect(replyFor(harness, 3)?.error?.message).toContain("SQLite worker cleanup failed:");
      expect(harness.events).not.toContain("sqlite.exec:10:SELECT 1");
      await harness.dispatch("open", open(2), 4);
      expect(replyFor(harness, 4)?.error?.message).toContain("SQLite worker cleanup failed:");
      expect(harness.factoryCalls).toBe(1);
    },
  );

  test.each(["success", "deserialize failure", "backup failure", "temporary close failure"])(
    "closes import temporary databases and releases an idle runtime after %s",
    async (outcome) => {
      const harness = createHarness();
      if (outcome === "deserialize failure") {
        harness.sqlite3.deserialize = async () => {
          throw new Error("deserialize failed");
        };
      }
      if (outcome === "backup failure") {
        harness.sqlite3.backup = async () => {
          throw new Error("backup failed");
        };
      }
      if (outcome === "temporary close failure") {
        harness.sqlite3.close = (pointer) => {
          harness.events.push(`sqlite.close:${pointer}`);
          throw new Error("temporary close failed");
        };
      }

      await harness.dispatch(
        "importAssetDatabase",
        {
          databasePath: "synthetic-destination.sqlite",
          assetDatabasePath: "synthetic://asset",
          forceOverwrite: true,
        },
        1,
      );

      const reply = replyFor(harness, 1);
      if (outcome === "success") expect(reply?.error).toBeFalsy();
      else if (outcome === "temporary close failure")
        expect(reply?.error?.message).toContain("SQLite worker cleanup failed:");
      else expect(reply?.error?.message).toContain(outcome.split(" ")[0]);
      const closeEvents = harness.events.filter((event) => event.startsWith("sqlite.close:"));
      expect(closeEvents).toHaveLength(outcome === "deserialize failure" ? 1 : 2);
      if (outcome === "temporary close failure") {
        expect(harness.events).not.toContain("persistent.close");
        expect(harness.events).not.toContain("memory.close");
        await harness.dispatch("open", open(2), 2);
        expect(replyFor(harness, 2)?.error?.message).toContain("SQLite worker cleanup failed:");
        expect(harness.openCalls).toHaveLength(2);
      } else {
        expect(harness.events.indexOf("persistent.close")).toBeGreaterThan(
          harness.events.lastIndexOf(closeEvents.at(-1)!),
        );
        expect(harness.events.indexOf("memory.close")).toBeGreaterThan(harness.events.indexOf("persistent.close"));
        expect(harness.events.indexOf("memory.close")).toBeLessThan(harness.events.indexOf("reply:1"));
      }
    },
  );

  test("quarantines a runtime when VFS cleanup fails and rejects later operations", async () => {
    const harness = createHarness({
      persistentCreate: async () => ({
        close: async () => {
          throw new Error("pool close failed");
        },
        jAccess: async () => {},
      }),
    });
    await harness.dispatch("open", open(1), 1);
    await harness.dispatch("close", { nativeDatabaseId: 1 }, 2);

    expect(replyFor(harness, 2)?.error?.message).toContain("SQLite worker cleanup failed:");
    await harness.dispatch("open", open(2), 3);
    expect(replyFor(harness, 3)?.error?.message).toContain("SQLite worker cleanup failed:");
    expect(harness.openCalls).toHaveLength(1);
    expect(harness.factoryCalls).toBe(1);
  });
});

test("worker awaits held statement finalization and SQL close before releasing the pool", async () => {
  const harness = createHarness();
  await harness.dispatch("open", open(1), 1);
  const finalizeStarted = deferred(),
    finishFinalize = deferred(),
    closeStarted = deferred(),
    finishClose = deferred();
  harness.sqlite3.finalize = async () => {
    finalizeStarted.resolve();
    await finishFinalize.promise;
    return 0;
  };
  harness.sqlite3.close = async () => {
    closeStarted.resolve();
    await finishClose.promise;
    return 0;
  };
  const work = harness.dispatch("close", { nativeDatabaseId: 1 }, 2);
  await finalizeStarted.promise;
  expect(harness.events).not.toContain("persistent.close");
  expect(replyFor(harness, 2)).toBeUndefined();
  finishFinalize.resolve();
  await closeStarted.promise;
  expect(harness.events).not.toContain("persistent.close");
  expect(replyFor(harness, 2)).toBeUndefined();
  finishClose.resolve();
  await work;
  expect(replyFor(harness, 2)?.error).toBeNull();
  expect(harness.events).toContain("persistent.close");
});

test("worker preserves an explicitly disabled finalize-before-close option", async () => {
  const harness = createHarness();
  await harness.dispatch("open", { ...open(1), options: { finalizeUnusedStatementsBeforeClosing: false } }, 1);
  await harness.dispatch("close", { nativeDatabaseId: 1 }, 2);
  expect(harness.events).not.toContain("sqlite.finalize:71");
  expect(harness.events).toContain("sqlite.close:10");
  expect(replyFor(harness, 2)?.error).toBeNull();
});

test("worker completes an import and idle cleanup before admitting a queued open", async () => {
  const started = deferred(),
    downloaded = deferred();
  const harness = createHarness({
    fetchImpl: async () => {
      started.resolve();
      await downloaded.promise;
      return { ok: true, statusText: "OK", arrayBuffer: async () => new ArrayBuffer(0) };
    },
  });
  const importing = harness.dispatch(
    "importAssetDatabase",
    { databasePath: "synthetic.sqlite", assetDatabasePath: "synthetic://asset", forceOverwrite: true },
    1,
  );
  await started.promise;
  const opening = harness.dispatch("open", open(2), 2);
  expect(harness.openCalls).toHaveLength(0);
  expect(replyFor(harness, 1)).toBeUndefined();
  downloaded.resolve();
  await Promise.all([importing, opening]);
  expect(harness.replies.map((reply) => reply.error)).toEqual([null, null]);
  expect(harness.events.indexOf("persistent.close")).toBeLessThan(harness.events.indexOf("reply:1"));
  expect(harness.events.lastIndexOf("wasm.init")).toBeGreaterThan(harness.events.indexOf("reply:1"));
  expect(harness.factoryCalls).toBe(2);
});

test("synchronous memory VFS cleanup failure retires the worker instead of replying success", async () => {
  const harness = createHarness({
    memoryCreate: async () => ({
      close: () => {
        throw new Error("memory close failed");
      },
    }),
  });
  await harness.dispatch(
    "importAssetDatabase",
    { databasePath: "synthetic.sqlite", assetDatabasePath: "synthetic://asset", forceOverwrite: true },
    1,
  );
  expect(replyFor(harness, 1)?.error?.message).toContain("SQLite worker cleanup failed:");
  await harness.dispatch("open", open(2), 2);
  expect(replyFor(harness, 2)?.error?.message).toContain("memory close failed");
  expect(harness.factoryCalls).toBe(1);
});

test.each([false, true])(
  "actual OPFS pool settles late acquisitions and attempts every cleanup, closeFailure=%s",
  async (closeFailure) => {
    const started = deferred(),
      late = deferred();
    const firstClose = jest.fn(() => {
      if (closeFailure) throw new Error("first handle close failed");
    });
    const lateClose = jest.fn();
    const handle = (close: () => void) => ({
      read: () => 0,
      write: () => 0,
      truncate: () => {},
      flush: () => {},
      close,
    });
    const directory = {
      getDirectoryHandle: async () => directory,
      async *[Symbol.asyncIterator]() {
        yield [
          "blocked",
          {
            kind: "file",
            createSyncAccessHandle: async () => {
              throw new Error("synthetic OPFS lock held");
            },
          },
        ];
        yield ["first", { kind: "file", createSyncAccessHandle: async () => handle(firstClose) }];
        yield [
          "late",
          {
            kind: "file",
            createSyncAccessHandle: async () => {
              started.resolve();
              await late.promise;
              return handle(lateClose);
            },
          },
        ];
      },
    };
    const module = { exports: {} };
    const poolPath = path.join(process.cwd(), "node_modules/expo-sqlite/web/wa-sqlite/AccessHandlePoolVFS.js");
    const code = ts.transpileModule(fs.readFileSync(poolPath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true },
    }).outputText;
    vm.runInNewContext(
      code,
      {
        exports: module.exports,
        module,
        require: (name: string) => {
          if (name === "./FacadeVFS.js") return { FacadeVFS: class {} };
          if (name === "./VFS.js")
            return {
              SQLITE_OPEN_MAIN_DB: 256,
              SQLITE_OPEN_MAIN_JOURNAL: 2048,
              SQLITE_OPEN_SUPER_JOURNAL: 16384,
              SQLITE_OPEN_WAL: 524288,
            };
          throw new Error("Unexpected pool import " + name);
        },
        navigator: { storage: { getDirectory: async () => directory } },
        TextEncoder,
        TextDecoder,
        console: { warn: jest.fn() },
      },
      { filename: poolPath },
    );
    const Pool = (
      module.exports as { AccessHandlePoolVFS: { create: (name: string, module: object) => Promise<unknown> } }
    ).AccessHandlePoolVFS;
    let settled = false;
    const creating = Pool.create("synthetic-opfs", {}).then(
      () => {
        settled = true;
        return null;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await started.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(firstClose).not.toHaveBeenCalled();
    late.resolve();
    const error = await creating;
    expect(String(error)).toContain(
      closeFailure ? "SQLite worker cleanup failed: Error: first handle close failed" : "synthetic OPFS lock held",
    );
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(lateClose).toHaveBeenCalledTimes(1);
  },
);

test("private same-file opens bypass the worker cache and close only their own pointer", async () => {
  const cached = createHarness();
  await cached.dispatch("open", open(1, "same.sqlite"), 1);
  await cached.dispatch("open", open(2, "same.sqlite"), 2);
  expect(cached.openCalls).toHaveLength(1);

  const privateHandles = createHarness();
  const privateOpen = (id: number) => ({ ...open(id, "same.sqlite"), options: { useNewConnection: true } });
  await privateHandles.dispatch("open", privateOpen(1), 1);
  await privateHandles.dispatch("open", privateOpen(2), 2);
  expect(privateHandles.openCalls.map((call) => call.pointer)).toEqual([10, 11]);
  privateHandles.events.length = 0;
  await privateHandles.dispatch("close", { nativeDatabaseId: 1 }, 3);
  expect(privateHandles.events).toContain("sqlite.close:10");
  expect(privateHandles.events).not.toContain("sqlite.close:11");
  expect(privateHandles.events).not.toContain("persistent.close");
  await privateHandles.dispatch("exec", { nativeDatabaseId: 2, source: "SELECT 161" }, 4);
  expect(replyFor(privateHandles, 4)?.error).toBeNull();
  expect(privateHandles.events).toContain("sqlite.exec:11:SELECT 161");
  await privateHandles.dispatch("close", { nativeDatabaseId: 2 }, 5);
  expect(privateHandles.events).toContain("sqlite.close:11");
  expect(privateHandles.events).toContain("persistent.close");
});
