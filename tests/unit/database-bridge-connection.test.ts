import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createConnectionOwner } from "@/lib/database/connection-owner";
import { createDatabaseBridgeClient, createDatabaseBridgeHost } from "@/lib/database/bridge-connection";
import {
  DB_BRIDGE_VERSION,
  decodeDbMessage,
  type DbMessage,
  type DbResponseMessage,
} from "@/lib/database/bridge-messages";
import type { TransactionDatabase } from "@/lib/database/types";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE records (key TEXT PRIMARY KEY, value INTEGER)");
  const events: string[] = [];
  const releases: (() => void)[] = [];
  let beforeExecute: ((sql: string) => Promise<void>) | undefined;
  let beforeExec: ((sql: string) => Promise<void>) | undefined;
  let failExec: ((sql: string) => unknown) | undefined;
  const raw: Parameters<typeof createConnectionOwner>[0] = {
    async execAsync(sql) {
      events.push(sql);
      await beforeExec?.(sql);
      const failure = failExec?.(sql);
      if (failure) throw failure;
      sqlite.exec(sql);
    },
    async prepareAsync(sql) {
      events.push("prepare:" + sql);
      const statement = sqlite.prepare(sql);
      return {
        async executeAsync(...args: unknown[]) {
          await beforeExecute?.(sql);
          const bindings =
            args.length === 1 &&
            (Array.isArray(args[0]) ||
              (args[0] !== null && typeof args[0] === "object" && !(args[0] instanceof Uint8Array)))
              ? args[0]
              : args;
          const values = (Array.isArray(bindings) ? bindings : [bindings]) as SQLInputValue[];
          const result = statement.columns().length ? null : statement.run(...values);
          return {
            changes: Number(result?.changes ?? 0),
            lastInsertRowId: Number(result?.lastInsertRowid ?? 0),
            getFirstAsync: async <T>() => (statement.get(...values) as T | undefined) ?? null,
            getAllAsync: async <T>() => statement.all(...values) as T[],
          };
        },
        async finalizeAsync() {
          events.push("finalize:" + sql);
        },
      };
    },
    async closeAsync() {
      events.push("close");
      sqlite.close();
    },
  };
  const owner = createConnectionOwner(raw);
  const responses: DbResponseMessage[] = [];
  const sent: DbMessage[] = [];
  const clients: ReturnType<typeof createDatabaseBridgeClient>[] = [];
  const disconnected: Error[] = [];
  let serial = 0;
  let deliverReplies = true;
  let failRenew = false;
  const host = createDatabaseBridgeHost(owner, {
    hostId: "host-generation",
    isActive: () => true,
    uniqueId: () => "token-" + ++serial,
    postMessage(message) {
      if (message.type !== "response") throw new Error("Unexpected host message");
      responses.push(message);
      if (deliverReplies) for (const client of clients) client.handleResponse(message);
      return true;
    },
  });
  const pending = new Set<Promise<void>>();
  function receive(value: unknown) {
    const message = decodeDbMessage(value);
    if (message?.type !== "request") return;
    const work = host.handleRequest(message);
    pending.add(work);
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work),
    );
  }
  function client(tabId: string) {
    const result = createDatabaseBridgeClient({
      tabId,
      hostId: "host-generation",
      isActive: () => true,
      uniqueId: () => "request-" + ++serial,
      onDisconnect: (error) => disconnected.push(error),
      postMessage(message) {
        sent.push(message);
        if (message.type === "request" && message.operation === "renew" && failRenew) {
          result.handleResponse({
            type: "response",
            version: DB_BRIDGE_VERSION,
            requestId: message.requestId,
            fromTabId: "host-generation",
            targetTabId: tabId,
            ok: false,
            error: "renew rejected",
          });
        } else receive(message);
        return true;
      },
    });
    clients.push(result);
    return result;
  }
  function submit(data: Record<string, unknown>) {
    const request = {
      type: "request",
      version: DB_BRIDGE_VERSION,
      requestId: "manual-" + ++serial,
      fromTabId: "manual-client",
      targetTabId: "host-generation",
      ...data,
    };
    receive(request);
    return request.requestId;
  }
  function reply(id: string) {
    return responses.find((item) => item.requestId === id);
  }
  async function begin(nonce = "nonce") {
    const id = submit({ operation: "begin", nonce });
    await flush();
    expect(reply(id)?.ok).toBe(true);
    return { nonce, token: (reply(id)?.result as { token: string }).token };
  }
  function gateExecute(sql: string) {
    const entered = deferred(),
      released = deferred();
    releases.push(released.resolve);
    beforeExecute = async (source) => {
      if (source === sql) {
        entered.resolve();
        await released.promise;
      }
    };
    return { entered: entered.promise, release: released.resolve };
  }
  function gateExec(sql: string) {
    const entered = deferred(),
      released = deferred();
    releases.push(released.resolve);
    beforeExec = async (source) => {
      if (source === sql) {
        entered.resolve();
        await released.promise;
      }
    };
    return { entered: entered.promise, release: released.resolve };
  }
  return {
    sqlite,
    owner,
    host,
    client,
    responses,
    sent,
    disconnected,
    submit,
    reply,
    begin,
    gateExecute,
    gateExec,
    set failExec(value: (sql: string) => unknown) {
      failExec = value;
    },
    set deliverReplies(value: boolean) {
      deliverReplies = value;
    },
    set failRenew(value: boolean) {
      failRenew = value;
    },
    events,
    hold() {
      const held = deferred();
      releases.push(held.resolve);
      return held;
    },
    rows: () =>
      owner.database.getAllAsync<{ key: string; value: number }>("SELECT key, value FROM records ORDER BY key"),
    async close() {
      releases.forEach((release) => release());
      clients.forEach((item) => item.retire());
      host.retire(new Error("test cleanup"));
      await Promise.allSettled([...pending]);
      await owner.close();
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
let current: Fixture;
beforeEach(() => {
  current = fixture();
});
afterEach(async () => {
  await current.close();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("two clients keep an unrelated write outside a rolled back transaction", async () => {
  const a = current.client("A"),
    b = current.client("B");
  const entered = deferred(),
    release = current.hold();
  const work = a.database.withTransactionAsync(async (tx) => {
    await tx.runAsync("INSERT INTO records VALUES (?, ?)", "A", 1);
    entered.resolve();
    await release.promise;
    throw new Error("cancel A");
  });
  const rejected = expect(work).rejects.toThrow("cancel A");
  await entered.promise;
  const outside = b.database.runAsync("INSERT INTO records VALUES (?, ?)", "B", 2);
  await flush();
  expect(current.sqlite.prepare("SELECT count(*) AS count FROM records").get()).toEqual({ count: 1 });
  release.resolve();
  await rejected;
  await outside;
  expect(await current.rows()).toEqual([{ key: "B", value: 2 }]);
});

test("virtual prepared commands drain accepted executions before finalize and reject retained scopes", async () => {
  const client = current.client("A");
  let retained: TransactionDatabase | undefined;
  await client.database.withTransactionAsync(async (tx) => {
    retained = tx;
    const command = await tx.prepareAsync("INSERT INTO records VALUES (?, ?)");
    const writing = command.executeAsync(["prepared", 3]);
    await command.finalizeAsync();
    await expect(command.executeAsync("too-late", 4)).rejects.toThrow();
    await writing;
  });
  await expect(retained?.execAsync("DELETE FROM records")).rejects.toThrow();
  expect(await current.rows()).toEqual([{ key: "prepared", value: 3 }]);
});

test("owner SQL failure remains authoritative after host commit admission", async () => {
  const tx = await current.begin();
  current.sqlite.exec("INSERT INTO records VALUES ('existing', 1)");
  const gate = current.gateExecute("INSERT INTO records VALUES (?, ?)");
  const write = current.submit({
    operation: "run",
    source: "INSERT INTO records VALUES (?, ?)",
    params: ["existing", 2],
    transaction: tx,
  });
  await gate.entered;
  const commit = current.submit({ operation: "commit", ...tx });
  await flush();
  expect(current.reply(commit)).toBeUndefined();
  gate.release();
  await flush();
  expect(current.reply(write)?.ok).toBe(false);
  expect(current.reply(commit)?.ok).toBe(false);
  expect(current.events).toContain("ROLLBACK");
  expect(current.events).not.toContain("COMMIT");
  expect(await current.rows()).toEqual([]);
});

test("legacy and wrong-version SQL including bare BEGIN never reach SQLite", async () => {
  const valid = {
    type: "request",
    version: DB_BRIDGE_VERSION,
    requestId: "legacy",
    fromTabId: "old",
    targetTabId: "host-generation",
    operation: "exec",
    source: "BEGIN",
    params: [],
  };
  expect(decodeDbMessage({ ...valid, version: undefined })).toBeNull();
  expect(decodeDbMessage({ ...valid, version: DB_BRIDGE_VERSION + 1 })).toBeNull();
  current.submit({ ...valid, version: undefined });
  current.submit({ ...valid, version: 2 });
  await flush();
  expect(current.events).toEqual([]);
});

test("nonce cancellation prevents a queued BEGIN from reaching the private connection", async () => {
  const entered = deferred(),
    release = current.hold();
  const local = current.owner.database.withTransactionAsync(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const begin = current.submit({ operation: "begin", nonce: "waiting" });
  current.submit({ operation: "cancel", nonce: "waiting" });
  await flush();
  release.resolve();
  await local;
  await flush();
  expect(current.reply(begin)?.ok).toBe(false);
  expect(current.events.filter((value) => value === "BEGIN")).toHaveLength(1);
});

test.each(["renew", "commit", "sql"] as const)(
  "expired %s cannot revive a lease before its timer runs",
  async (operation) => {
    jest.useFakeTimers();
    const tx = await current.begin();
    jest.setSystemTime(Date.now() + 60_001);
    const id =
      operation === "sql"
        ? current.submit({
            operation: "run",
            source: "INSERT INTO records VALUES ('late', 1)",
            params: [],
            transaction: tx,
          })
        : current.submit({ operation, ...tx });
    await flush();
    expect(current.reply(id)?.ok).toBe(false);
    expect(current.events).toContain("ROLLBACK");
    expect(current.events).not.toContain("COMMIT");
    expect(await current.rows()).toEqual([]);
  },
);

test("renewal invalidates the previous timer but expires at the new deadline", async () => {
  jest.useFakeTimers();
  const timers = jest.spyOn(globalThis, "setTimeout");
  const tx = await current.begin();
  const staleTimer = timers.mock.calls[0][0];
  await jest.advanceTimersByTimeAsync(45_000);
  const renewed = current.submit({ operation: "renew", ...tx });
  await flush();
  expect(current.reply(renewed)?.ok).toBe(true);
  await jest.advanceTimersByTimeAsync(15_001);
  if (typeof staleTimer === "function") staleTimer();
  await flush();
  expect(current.events).not.toContain("ROLLBACK");
  await jest.advanceTimersByTimeAsync(45_000);
  await flush();
  expect(current.events).toContain("ROLLBACK");
});

test("client identity and reservation token cannot control another client's transaction", async () => {
  const tx = await current.begin();
  for (const data of [
    { operation: "commit", ...tx, fromTabId: "intruder" },
    { operation: "renew", ...tx, token: "old-generation-token" },
  ]) {
    const id = current.submit(data);
    await flush();
    expect(current.reply(id)?.ok).toBe(false);
  }
  const commit = current.submit({ operation: "commit", ...tx });
  await flush();
  expect(current.reply(commit)?.ok).toBe(true);
});

test("retirement aborts active host reservations and releases the owner FIFO", async () => {
  const tx = await current.begin();
  current.submit({ operation: "run", source: "INSERT INTO records VALUES ('A', 1)", params: [], transaction: tx });
  await flush();
  current.host.retire(new Error("page hidden"));
  await flush();
  expect(current.events).toContain("ROLLBACK");
  await current.owner.database.runAsync("INSERT INTO records VALUES ('B', 2)");
  expect(await current.rows()).toEqual([{ key: "B", value: 2 }]);
});

test("retirement after commit admission joins the real commit without concurrent rollback", async () => {
  const tx = await current.begin();
  const gate = current.gateExec("COMMIT");
  current.submit({ operation: "commit", ...tx });
  await gate.entered;
  current.host.retire(new Error("page hidden"));
  current.owner.retire();
  const close = current.owner.close();
  await flush();
  expect(current.events).not.toContain("ROLLBACK");
  expect(current.events).not.toContain("close");
  gate.release();
  await close;
  expect(current.events).not.toContain("ROLLBACK");
  expect(current.events.at(-1)).toBe("close");
});

test("heartbeat failure rejects a held callback and cancels its nonce", async () => {
  jest.useFakeTimers();
  const client = current.client("A");
  current.failRenew = true;
  const entered = deferred();
  const work = client.database.withTransactionAsync(async (tx) => {
    await tx.runAsync("INSERT INTO records VALUES ('A', 1)");
    entered.resolve();
    await new Promise(() => {});
  });
  const rejected = expect(work).rejects.toThrow("renew rejected");
  await entered.promise;
  await jest.advanceTimersByTimeAsync(15_000);
  await rejected;
  await flush();
  expect(current.sent.some((message) => message.type === "request" && message.operation === "cancel")).toBe(true);
  expect(current.events).toContain("ROLLBACK");
  expect(await current.rows()).toEqual([]);
});

test("heartbeats continue after callback settlement while accepted SQL drains", async () => {
  jest.useFakeTimers();
  const client = current.client("A");
  const gate = current.gateExecute("INSERT INTO records VALUES ('A', 1)");
  const work = client.database.withTransactionAsync(async (tx) => {
    void tx.runAsync("INSERT INTO records VALUES ('A', 1)");
  });
  await gate.entered;
  await jest.advanceTimersByTimeAsync(45_000);
  expect(current.sent.filter((message) => message.type === "request" && message.operation === "renew")).toHaveLength(3);
  expect(current.events).not.toContain("ROLLBACK");
  gate.release();
  await work;
  expect(await current.rows()).toEqual([{ key: "A", value: 1 }]);
});

test("lost commit acknowledgement times out with one commit and no replay", async () => {
  jest.useFakeTimers();
  const client = current.client("A");
  const entered = deferred(),
    release = current.hold();
  const work = client.database.withTransactionAsync(async (tx) => {
    await tx.runAsync("INSERT INTO records VALUES ('A', 1)");
    entered.resolve();
    await release.promise;
  });
  const rejected = expect(work).rejects.toThrow("Database request timed out");
  await entered.promise;
  current.deliverReplies = false;
  release.resolve();
  await flush();
  expect(current.events.filter((value) => value === "COMMIT")).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(60_000);
  await rejected;
  expect(current.disconnected).toHaveLength(1);
  expect(current.events.filter((value) => value === "BEGIN")).toHaveLength(1);
  expect(current.events.filter((value) => value === "COMMIT")).toHaveLength(1);
  expect(await current.rows()).toEqual([{ key: "A", value: 1 }]);
});

test.each(["caught", "unawaited"] as const)(
  "remote %s SQL failure waits for successful rollback without inventing a cleanup failure",
  async (mode) => {
    const client = current.client("A");
    const gate = current.gateExec("ROLLBACK");
    let observed: unknown,
      settled = false;
    const work = client.database
      .withTransactionAsync(async (tx) => {
        await tx.runAsync("INSERT INTO records VALUES ('A', 1)");
        const invalid = tx.runAsync("INSERT INTO missing VALUES (1)");
        if (mode === "caught") await invalid.catch(() => {});
      })
      .catch((error: unknown) => {
        observed = error;
      })
      .finally(() => {
        settled = true;
      });
    await gate.entered;
    await flush();
    expect(settled).toBe(false);
    gate.release();
    await work;
    expect(String(observed)).toContain("no such table: missing");
    expect(observed).not.toHaveProperty("additionalErrors");
    expect(await current.rows()).toEqual([]);
  },
);

test("a queued BEGIN expires from receipt time before a delayed timer can run", async () => {
  jest.useFakeTimers();
  const entered = deferred(),
    release = current.hold();
  const local = current.owner.database.withTransactionAsync(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const id = current.submit({ operation: "begin", nonce: "queued-expired" });
  jest.setSystemTime(Date.now() + 60_001);
  release.resolve();
  await local;
  await flush();
  expect(current.reply(id)?.ok).toBe(false);
  expect(current.events.filter((value) => value === "BEGIN")).toHaveLength(1);
});

test("cleanup outcome stays successful when expired admitted SQL later fails", async () => {
  jest.useFakeTimers();
  current.sqlite.exec("INSERT INTO records VALUES ('existing', 1)");
  const tx = await current.begin();
  const sql = "INSERT INTO records VALUES (?, ?)";
  const gate = current.gateExecute(sql);
  const write = current.submit({ operation: "run", source: sql, params: ["existing", 2], transaction: tx });
  await gate.entered;
  jest.setSystemTime(Date.now() + 60_001);
  const renewal = current.submit({ operation: "renew", ...tx });
  await flush();
  expect(current.reply(renewal)?.ok).toBe(false);
  gate.release();
  await flush();
  expect(current.reply(write)?.ok).toBe(false);
  const cleanup = current.submit({ operation: "rollback", ...tx });
  await flush();
  expect(current.reply(cleanup)?.ok).toBe(true);
  expect(await current.rows()).toEqual([{ key: "existing", value: 1 }]);
});

test("evicted cleanup receipts return unknown instead of pretending rollback succeeded", async () => {
  jest.useFakeTimers();
  const first = await current.begin("receipt-0");
  current.submit({ operation: "cancel", nonce: first.nonce });
  await flush();
  let last = first;
  for (let i = 1; i <= 64; i++) {
    last = await current.begin("receipt-" + i);
    current.submit({ operation: "cancel", nonce: last.nonce });
    await flush();
  }
  const forgotten = current.submit({ operation: "rollback", ...first });
  await flush();
  expect(current.reply(forgotten)).toMatchObject({ ok: false, error: expect.stringContaining("no longer known") });
  const known = current.submit({ operation: "rollback", ...last });
  await flush();
  expect(current.reply(known)?.ok).toBe(true);
});

test("expired cleanup receipts are unknown even before the cleanup timer runs", async () => {
  jest.useFakeTimers();
  const tx = await current.begin();
  current.submit({ operation: "cancel", nonce: tx.nonce });
  await flush();
  jest.setSystemTime(Date.now() + 60_001);
  const cleanup = current.submit({ operation: "rollback", ...tx });
  await flush();
  expect(current.reply(cleanup)).toMatchObject({ ok: false, error: expect.stringContaining("no longer known") });
});

test("an actual rollback failure rejects cleanup and quarantines the private owner", async () => {
  const tx = await current.begin();
  current.failExec = (sql) => (sql === "ROLLBACK" ? new Error("raw rollback failed") : null);
  const cleanup = current.submit({ operation: "rollback", ...tx });
  await flush();
  expect(current.reply(cleanup)).toMatchObject({
    ok: false,
    error: expect.stringContaining("additional database cleanup failed"),
  });
  expect(current.events.filter((event) => event === "ROLLBACK")).toHaveLength(1);
  await expect(current.owner.database.runAsync("INSERT INTO records VALUES ('forbidden', 1)")).rejects.toThrow();
  expect(current.events).not.toContain("prepare:INSERT INTO records VALUES ('forbidden', 1)");
});

test("cleanup during a held commit waits for its outcome and never starts concurrent rollback", async () => {
  const tx = await current.begin();
  const gate = current.gateExec("COMMIT");
  const commit = current.submit({ operation: "commit", ...tx });
  await gate.entered;
  const cleanup = current.submit({ operation: "rollback", ...tx });
  await flush();
  expect(current.reply(cleanup)).toBeUndefined();
  expect(current.events).not.toContain("ROLLBACK");
  gate.release();
  await flush();
  expect(current.reply(commit)?.ok).toBe(true);
  expect(current.reply(cleanup)).toMatchObject({ ok: false, error: "Database transaction did not roll back" });
  expect(current.events.filter((event) => event === "COMMIT")).toHaveLength(1);
  expect(current.events).not.toContain("ROLLBACK");
});
