import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createConnectionOwner } from "@/lib/database/connection-owner";
import type { DatabasePreparedCommand, TransactionDatabase } from "@/lib/database/types";

type RawConnection = Parameters<typeof createConnectionOwner>[0];
type Gate = { entered: Promise<void>; release(): void; wait(): Promise<void> };

function gate(): Gate {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const waiting = new Promise<void>((resolve) => (release = resolve));
  return {
    entered,
    release,
    async wait() {
      enter();
      await waiting;
    },
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

class SQLiteHarness {
  readonly sqlite = new DatabaseSync(":memory:");
  readonly events: string[] = [];
  beforeExec: ((sql: string) => Promise<void>) | null = null;
  beforeRead: ((kind: "first" | "all", sql: string) => Promise<void>) | null = null;
  beforeExecute: ((sql: string) => Promise<void>) | null = null;
  beforeFinalize: ((sql: string) => Promise<void>) | null = null;
  failExec: ((sql: string) => unknown | null) | null = null;
  rejectAfterExec: ((sql: string) => unknown | null) | null = null;
  failFinalize: unknown = null;
  failFinalizeSql: string | null = null;
  closeCount = 0;
  closeError: unknown = null;

  readonly raw: RawConnection = {
    execAsync: async (sql) => {
      this.events.push("exec:" + sql);
      await this.beforeExec?.(sql);
      const failure = this.failExec?.(sql);
      if (failure) throw failure;
      this.sqlite.exec(sql);
      const lostAck = this.rejectAfterExec?.(sql);
      if (lostAck) throw lostAck;
    },
    prepareAsync: async (sql) => {
      this.events.push("prepare:" + sql);
      const statement = this.sqlite.prepare(sql);
      return {
        executeAsync: async (...params: unknown[]) => {
          this.events.push("execute:" + sql);
          await this.beforeExecute?.(sql);
          const bindings = params.length === 1 ? params[0] : params;
          const values = (Array.isArray(bindings) ? bindings : [bindings]) as SQLInputValue[];
          const isRead = /^\s*(SELECT|PRAGMA)\b/i.test(sql);
          let result: { lastInsertRowid: number | bigint; changes: number | bigint } | undefined;
          if (!isRead) result = statement.run(...values);
          return {
            lastInsertRowId: Number(result?.lastInsertRowid ?? 0),
            changes: Number(result?.changes ?? 0),
            getFirstAsync: async <T>() => {
              this.events.push("first:" + sql);
              await this.beforeRead?.("first", sql);
              return (statement.get(...values) as T | undefined) ?? null;
            },
            getAllAsync: async <T>() => {
              this.events.push("all:" + sql);
              await this.beforeRead?.("all", sql);
              return statement.all(...values) as T[];
            },
          };
        },
        finalizeAsync: async () => {
          this.events.push("finalize:" + sql);
          await this.beforeFinalize?.(sql);
          if (this.failFinalize && (!this.failFinalizeSql || this.failFinalizeSql === sql)) throw this.failFinalize;
          // StatementSync releases through Node's handle lifecycle; this adapter records finalization.
        },
      };
    },
    closeAsync: async () => {
      this.closeCount += 1;
      this.events.push("close");
      if (this.closeError) throw this.closeError;
      this.sqlite.close();
    },
  };
}

function ownerFor(raw: RawConnection, onFatal?: (error: Error) => void | Promise<void>) {
  return createConnectionOwner(raw, onFatal);
}

async function insert(owner: ReturnType<typeof ownerFor>, key: string, value: number) {
  await owner.database.runAsync("INSERT INTO records VALUES (?, ?)", key, value);
}

async function rows(owner: ReturnType<typeof ownerFor>) {
  return owner.database.getAllAsync<{ key: string; value: number }>("SELECT key, value FROM records ORDER BY key");
}

function makeTable(harness: SQLiteHarness) {
  harness.sqlite.exec("CREATE TABLE records (key TEXT PRIMARY KEY, value INTEGER NOT NULL)");
}

describe("private SQLite connection owner", () => {
  let harness: SQLiteHarness;
  let owner: ReturnType<typeof ownerFor>;

  beforeEach(() => {
    harness = new SQLiteHarness();
    makeTable(harness);
    owner = ownerFor(harness.raw);
  });

  afterEach(async () => {
    await owner.close().catch(() => undefined);
  });

  test("ordinary SQL errors release the FIFO and later SQL succeeds", async () => {
    await expect(owner.database.runAsync("INSERT INTO missing VALUES (1)")).rejects.toThrow();
    await insert(owner, "ok", 7);
    expect(await rows(owner)).toEqual([{ key: "ok", value: 7 }]);
  });

  test("ordinary read holds the FIFO through getAll and finalization", async () => {
    const readGate = gate();
    harness.beforeRead = async (kind) => {
      if (kind === "all") await readGate.wait();
    };
    const read = rows(owner);
    await readGate.entered;
    const next = insert(owner, "later", 2);
    await Promise.resolve();
    const close = owner.close();
    expect(harness.events.some((event) => event === "prepare:INSERT INTO records VALUES (?, ?)")).toBe(false);
    readGate.release();
    await Promise.all([read, next]);
    await close;
    const finalizeIndex = harness.events.indexOf("finalize:SELECT key, value FROM records ORDER BY key");
    expect(finalizeIndex).toBeLessThan(harness.events.indexOf("prepare:INSERT INTO records VALUES (?, ?)"));
    expect(harness.events.indexOf("close")).toBeGreaterThan(finalizeIndex);
  });

  test("whole transaction reserves unrelated writes and rollback preserves the outside write", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const transaction = owner.database.withTransactionAsync(async (scope) => {
      await scope.runAsync("INSERT INTO records VALUES (?, ?)", "A", 1);
      entered.resolve();
      await release.promise;
      throw new Error("rollback A");
    });
    await entered.promise;
    const outside = insert(owner, "B", 2);
    await Promise.resolve();
    expect(harness.events.filter((event) => event === "exec:BEGIN")).toHaveLength(1);
    release.resolve();
    await expect(transaction).rejects.toThrow("rollback A");
    await outside;
    expect(await rows(owner)).toEqual([{ key: "B", value: 2 }]);
  });

  test.each(["caught", "unawaited"] as const)(
    "%s scoped SQL error poisons and rolls back the transaction",
    async (mode) => {
      await expect(
        owner.database.withTransactionAsync(async (scope) => {
          await scope.runAsync("INSERT INTO records VALUES (?, ?)", "A", 1);
          const fail = scope.runAsync("INSERT INTO missing VALUES (1)");
          if (mode === "caught") await fail.catch(() => undefined);
        }),
      ).rejects.toThrow();
      expect(harness.events).toContain("exec:ROLLBACK");
      expect(await rows(owner)).toEqual([]);
    },
  );

  test("unfinalized prepared handles finalize before commit and retained scopes and commands reject", async () => {
    let command: DatabasePreparedCommand | undefined;
    let scopeRef: TransactionDatabase | undefined;
    await owner.database.withTransactionAsync(async (scope) => {
      scopeRef = scope;
      command = await scope.prepareAsync("INSERT INTO records VALUES (?, ?)");
      await command.executeAsync("A", 1);
    });
    expect(harness.events.indexOf("finalize:INSERT INTO records VALUES (?, ?)")).toBeLessThan(
      harness.events.indexOf("exec:COMMIT"),
    );
    await expect(command?.executeAsync("B", 2)).rejects.toThrow();
    await expect(command?.finalizeAsync()).rejects.toThrow();
    await expect(scopeRef?.runAsync("SELECT 1")).rejects.toThrow();
  });

  test("execute admitted before finalize still runs after finalize admission closes the handle", async () => {
    const executeGate = gate();
    harness.beforeExecute = async () => executeGate.wait();
    let command!: DatabasePreparedCommand;
    const transaction = owner.database.withTransactionAsync(async (scope) => {
      command = await scope.prepareAsync("INSERT INTO records VALUES (?, ?)");
      const execute = command.executeAsync("A", 1);
      const finalize = command.finalizeAsync();
      await executeGate.entered;
      executeGate.release();
      await execute;
      await finalize;
    });
    await transaction;
    expect(await rows(owner)).toEqual([{ key: "A", value: 1 }]);
  });

  test("finalize and rollback failures retain the frozen primary error", async () => {
    const primary = Object.freeze(new Error("primary callback failure"));
    const finalize = new Error("finalize failed");
    const rollback = new Error("rollback failed");
    harness.failFinalize = finalize;
    harness.failFinalizeSql = "SELECT 1";
    harness.failExec = (sql) => (sql === "ROLLBACK" ? rollback : null);
    let observed: unknown;
    try {
      await owner.database.withTransactionAsync(async (scope) => {
        await scope.runAsync("INSERT INTO records VALUES (?, ?)", "A", 1);
        await scope.prepareAsync("SELECT 1");
        throw primary;
      });
    } catch (error) {
      observed = error;
    }
    expect(observed).toMatchObject({ primaryError: primary, additionalErrors: [finalize, rollback] });
    expect(primary.message).toBe("primary callback failure");
  });

  test("quarantine blocks queued and new SQL and sends one nonblocking fatal notification", async () => {
    const notified: Error[] = [];
    const local = ownerFor(harness.raw, (error) => {
      notified.push(error);
      throw new Error("observer failed");
    });
    const finalizeError = new Error("cannot finalize");
    const finalizeGate = gate();
    harness.beforeFinalize = async () => finalizeGate.wait();
    harness.failFinalize = finalizeError;
    const first = local.database.runAsync("INSERT INTO records VALUES (?, ?)", "A", 1);
    await finalizeGate.entered;
    const queued = local.database.runAsync("INSERT INTO records VALUES (?, ?)", "B", 2);
    finalizeGate.release();
    await expect(first).rejects.toBe(finalizeError);
    await expect(queued).rejects.toThrow();
    await expect(local.database.runAsync("INSERT INTO records VALUES (?, ?)", "C", 3)).rejects.toThrow();
    expect(notified).toEqual([finalizeError]);
    await local.close();
  });

  test("close promise is cached and raw close runs once after rejection", async () => {
    const localHarness = new SQLiteHarness();
    const local = ownerFor(localHarness.raw);
    const closeError = new Error("close failed");
    localHarness.closeError = closeError;
    const first = local.close();
    const second = local.close();
    expect(first).toBe(second);
    await expect(first).rejects.toBe(closeError);
    await expect(local.close()).rejects.toBe(closeError);
    expect(localHarness.closeCount).toBe(1);
  });

  test.each(["failed before BEGIN", "BEGIN succeeded but acknowledgement failed"])(
    "%s never replays or calls callback and rejects queued SQL before close",
    async (scenario) => {
      const localHarness = new SQLiteHarness();
      makeTable(localHarness);
      const local = ownerFor(localHarness.raw);
      const beginGate = gate();
      const failure = new Error(scenario);
      localHarness.beforeExec = async (sql) => {
        if (sql === "BEGIN") await beginGate.wait();
      };
      if (scenario === "failed before BEGIN") localHarness.failExec = (sql) => (sql === "BEGIN" ? failure : null);
      else localHarness.rejectAfterExec = (sql) => (sql === "BEGIN" ? failure : null);
      let callbackCalls = 0;
      const tx = local.database.withTransactionAsync(async () => {
        callbackCalls += 1;
      });
      await beginGate.entered;
      const queued = local.database.getFirstAsync("SELECT 1");
      beginGate.release();
      await expect(tx).rejects.toBe(failure);
      await expect(queued).rejects.toThrow();
      expect(callbackCalls).toBe(0);
      expect(localHarness.events.filter((event) => event === "exec:BEGIN")).toHaveLength(1);
      await local.close();
      expect(localHarness.events.indexOf("close")).toBeGreaterThan(localHarness.events.indexOf("exec:BEGIN"));
    },
  );

  test("retirement rejects queued BEGIN while admitted callback settles before close", async () => {
    const localHarness = new SQLiteHarness();
    makeTable(localHarness);
    const local = ownerFor(localHarness.raw);
    const entered = deferred<void>();
    const release = deferred<void>();
    const active = local.reserveTransaction(async (scope) => {
      await scope.runAsync("INSERT INTO records VALUES (?, ?)", "A", 1);
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const queued = local.reserveTransaction(async () => {
      throw new Error("must not run");
    });
    local.retire();
    const newAdmission = local.reserveTransaction(async () => {
      throw new Error("must not run");
    });
    const close = local.close();
    release.resolve();
    await active;
    await expect(queued).rejects.toThrow();
    await expect(newAdmission).rejects.toThrow();
    await close;
    expect(localHarness.events.indexOf("exec:COMMIT")).toBeLessThan(localHarness.events.indexOf("close"));
    expect(localHarness.events.filter((event) => event === "exec:BEGIN")).toHaveLength(1);
  });

  test("COMMIT failure attempts one rollback and preserves owner usability and error identity", async () => {
    const failure = Object.freeze(new Error("commit rejected"));
    harness.failExec = (sql) => (sql === "COMMIT" ? failure : null);
    await expect(
      owner.database.withTransactionAsync(async (tx) => {
        await tx.runAsync("INSERT INTO records VALUES (?, ?)", "A", 1);
      }),
    ).rejects.toBe(failure);
    expect(harness.events.filter((event) => event === "exec:COMMIT")).toHaveLength(1);
    expect(harness.events.filter((event) => event === "exec:ROLLBACK")).toHaveLength(1);
    await insert(owner, "B", 2);
    expect(await rows(owner)).toEqual([{ key: "B", value: 2 }]);
  });

  test("ordinary finalization settles before a queued write or private close can start", async () => {
    const finalize = gate();
    harness.beforeFinalize = async (sql) => {
      if (sql.startsWith("SELECT")) await finalize.wait();
    };
    const read = rows(owner);
    await finalize.entered;
    const next = insert(owner, "B", 2);
    const close = owner.close();
    await Promise.resolve();
    expect(harness.events).not.toContain("prepare:INSERT INTO records VALUES (?, ?)");
    expect(harness.events).not.toContain("close");
    finalize.release();
    await Promise.all([read, next, close]);
    expect(harness.events.at(-1)).toBe("close");
  });

  test("caught explicit prepared finalization failure poisons and quarantines the transaction", async () => {
    const failure = new Error("explicit finalize failed");
    harness.failFinalize = failure;
    harness.failFinalizeSql = "INSERT INTO records VALUES (?, ?)";
    await expect(
      owner.database.withTransactionAsync(async (tx) => {
        const statement = await tx.prepareAsync("INSERT INTO records VALUES (?, ?)");
        await statement.executeAsync("A", 1);
        await statement.finalizeAsync().catch(() => {});
      }),
    ).rejects.toBe(failure);
    expect(harness.events).toContain("exec:ROLLBACK");
    expect(harness.events).not.toContain("exec:COMMIT");
    await expect(insert(owner, "B", 2)).rejects.toThrow();
    expect(harness.sqlite.prepare("SELECT count(*) AS count FROM records").get()).toEqual({ count: 0 });
  });

  test("successful cleanup preserves a sole frozen callback error by identity", async () => {
    const failure = Object.freeze(new Error("frozen callback"));
    await expect(
      owner.database.withTransactionAsync(async (tx) => {
        await tx.runAsync("INSERT INTO records VALUES (?, ?)", "A", 1);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await rows(owner)).toEqual([]);
  });

  test.each(["caught", "unawaited", "propagated"] as const)(
    "%s explicit finalization retains its cleanup error after an earlier SQL failure",
    async (mode) => {
      await insert(owner, "existing", 1);
      const finalizationError = Object.freeze(new Error("explicit finalization failed"));
      harness.failFinalize = finalizationError;
      harness.failFinalizeSql = "INSERT INTO records VALUES (?, ?)";
      let sqlError: unknown, observed: unknown;
      try {
        await owner.database.withTransactionAsync(async (tx) => {
          const statement = await tx.prepareAsync("INSERT INTO records VALUES (?, ?)");
          await statement.executeAsync("existing", 2).catch((error: unknown) => {
            sqlError = error;
            if (error && typeof error === "object") Object.freeze(error);
          });
          const finalizing = statement.finalizeAsync();
          if (mode === "caught") await finalizing.catch(() => {});
          else if (mode === "propagated") await finalizing;
        });
      } catch (error) {
        observed = error;
      }
      expect(sqlError).toMatchObject({ message: expect.stringContaining("UNIQUE constraint failed") });
      expect(observed).toMatchObject({ primaryError: sqlError, additionalErrors: [finalizationError] });
      expect(harness.events.filter((event) => event === "exec:ROLLBACK")).toHaveLength(1);
      await expect(insert(owner, "forbidden", 3)).rejects.toThrow();
      expect(harness.sqlite.prepare("SELECT key, value FROM records").all()).toEqual([{ key: "existing", value: 1 }]);
    },
  );

  test("unawaited explicit cleanup and an independent callback failure both survive", async () => {
    const cleanupError = Object.freeze(new Error("unawaited cleanup"));
    const callbackError = Object.freeze(new Error("independent callback"));
    harness.failFinalize = cleanupError;
    await expect(
      owner.database.withTransactionAsync(async (tx) => {
        const statement = await tx.prepareAsync("SELECT 1");
        void statement.finalizeAsync();
        throw callbackError;
      }),
    ).rejects.toMatchObject({ primaryError: cleanupError, additionalErrors: [callbackError] });
    expect(harness.events.filter((event) => event === "exec:ROLLBACK")).toHaveLength(1);
  });

  test("retains distinct explicit and automatic cleanup failures even when they reuse one error object", async () => {
    await insert(owner, "existing", 1);
    const cleanupError = Object.freeze(new Error("shared finalization error"));
    harness.failFinalize = cleanupError;
    let sqlError: unknown, observed: unknown;
    try {
      await owner.database.withTransactionAsync(async (tx) => {
        const explicit = await tx.prepareAsync("INSERT INTO records VALUES (?, ?)");
        await tx.prepareAsync("SELECT 1");
        await explicit.executeAsync("existing", 2).catch((error: unknown) => {
          sqlError = error;
        });
        await explicit.finalizeAsync().catch(() => {});
      });
    } catch (error) {
      observed = error;
    }
    expect(sqlError).toMatchObject({ message: expect.stringContaining("UNIQUE constraint failed") });
    expect(observed).toMatchObject({ primaryError: sqlError, additionalErrors: [cleanupError, cleanupError] });
  });
});
