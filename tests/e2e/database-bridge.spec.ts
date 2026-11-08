import { expect, test } from "@playwright/test";
import { assertHealthyPage, captureConsole, waitForQaReady } from "./helpers";

test("isolated Chrome database bridge ignores malformed messages and serves a valid query", async ({
  browser,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "");
  expect(origin.protocol).toBe("http:");
  expect(origin.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);

  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    const capture = captureConsole(page);
    await waitForQaReady(page);

    const result = await page.evaluate(async () => {
      const channel = new BroadcastChannel("hafiz-db-bridge");
      const clientId = `rf139-qa-${crypto.randomUUID()}`;
      const malformedRequestId = `rf139-malformed-${crypto.randomUUID()}`;
      const validRequestId = `rf139-valid-${crypto.randomUUID()}`;
      const legacyRequestId = `rf161-legacy-${crypto.randomUUID()}`;
      const wrongVersionRequestId = `rf161-version-${crypto.randomUUID()}`;
      const legacyBeginRequestId = `rf161-legacy-begin-${crypto.randomUUID()}`;
      const wrongVersionBeginRequestId = `rf161-version-begin-${crypto.randomUUID()}`;

      try {
        const hostTabId = await new Promise<string>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("RF139 host discovery timed out")), 20_000);
          channel.addEventListener("message", function onMessage(event: MessageEvent<unknown>) {
            const message = event.data;
            if (
              !message ||
              typeof message !== "object" ||
              Array.isArray(message) ||
              !("type" in message) ||
              message.type !== "host-ready" ||
              !("version" in message) ||
              message.version !== 1 ||
              !("tabId" in message) ||
              typeof message.tabId !== "string" ||
              message.tabId === clientId
            ) {
              return;
            }
            window.clearTimeout(timeout);
            channel.removeEventListener("message", onMessage);
            resolve(message.tabId);
          });
          channel.postMessage({ type: "host-probe", version: 1, tabId: clientId });
        });

        let malformedResponseCount = 0;
        const malformedListener = (event: MessageEvent<unknown>) => {
          const message = event.data;
          if (
            message &&
            typeof message === "object" &&
            !Array.isArray(message) &&
            "type" in message &&
            message.type === "response" &&
            "requestId" in message &&
            (message.requestId === malformedRequestId ||
              message.requestId === legacyRequestId ||
              message.requestId === wrongVersionRequestId ||
              message.requestId === legacyBeginRequestId ||
              message.requestId === wrongVersionBeginRequestId)
          ) {
            malformedResponseCount += 1;
          }
        };
        channel.addEventListener("message", malformedListener);

        channel.postMessage(7);
        channel.postMessage({ type: "not-a-bridge-message" });
        channel.postMessage({
          type: "request",
          version: 1,
          requestId: malformedRequestId,
          fromTabId: clientId,
          targetTabId: hostTabId,
          operation: "run",
          source: "SELECT 'malformed' AS value",
          params: [new Date()],
        });
        // Deliberately omit a version on the legacy SQL request.
        channel.postMessage({
          type: "request",
          requestId: legacyRequestId,
          fromTabId: clientId,
          targetTabId: hostTabId,
          operation: "exec",
          source: "CREATE TEMP TABLE rf161_legacy_probe (value INTEGER)",
          params: [],
        });
        channel.postMessage({
          type: "request",
          version: 2,
          requestId: wrongVersionRequestId,
          fromTabId: clientId,
          targetTabId: hostTabId,
          operation: "exec",
          source: "CREATE TEMP TABLE rf161_wrong_version_probe (value INTEGER)",
          params: [],
        });
        channel.postMessage({
          type: "request",
          requestId: legacyBeginRequestId,
          fromTabId: clientId,
          targetTabId: hostTabId,
          operation: "exec",
          source: "BEGIN",
          params: [],
        });
        channel.postMessage({
          type: "request",
          version: 2,
          requestId: wrongVersionBeginRequestId,
          fromTabId: clientId,
          targetTabId: hostTabId,
          operation: "exec",
          source: "BEGIN",
          params: [],
        });
        channel.postMessage({
          type: "response",
          version: 1,
          requestId: validRequestId,
          fromTabId: "wrong-host",
          targetTabId: clientId,
          ok: "true",
          result: { value: "ignored" },
        });

        function versionedRequest(
          operation: string,
          fields: Record<string, unknown>,
          requestId: string = crypto.randomUUID(),
        ) {
          return new Promise<unknown>((resolve, reject) => {
            const timeout = window.setTimeout(
              () => reject(new Error("RF161 versioned request timed out: " + operation)),
              20_000,
            );
            const listener = (event: MessageEvent<unknown>) => {
              const message = event.data;
              if (
                !message ||
                typeof message !== "object" ||
                Array.isArray(message) ||
                !("type" in message) ||
                message.type !== "response" ||
                !("version" in message) ||
                message.version !== 1 ||
                !("requestId" in message) ||
                message.requestId !== requestId ||
                !("fromTabId" in message) ||
                message.fromTabId !== hostTabId ||
                !("targetTabId" in message) ||
                message.targetTabId !== clientId ||
                !("ok" in message) ||
                typeof message.ok !== "boolean"
              )
                return;
              window.clearTimeout(timeout);
              channel.removeEventListener("message", listener);
              if (message.ok) resolve("result" in message ? message.result : undefined);
              else reject(new Error("error" in message ? String(message.error) : "RF161 versioned request failed"));
            };
            channel.addEventListener("message", listener);
            channel.postMessage({
              type: "request",
              version: 1,
              requestId,
              fromTabId: clientId,
              targetTabId: hostTabId,
              operation,
              ...fields,
            });
          });
        }

        const nonce = crypto.randomUUID();
        const receipt = await versionedRequest("begin", { nonce });
        if (
          !receipt ||
          typeof receipt !== "object" ||
          !("token" in receipt) ||
          typeof receipt.token !== "string" ||
          receipt.token.length === 0
        ) {
          throw new Error("RF161 invalid versioned transaction acknowledgement");
        }
        await versionedRequest("rollback", { nonce, token: receipt.token });
        const validResult = await versionedRequest(
          "getFirst",
          {
            source:
              "SELECT 139 AS value, (SELECT COUNT(*) FROM sqlite_temp_master WHERE name IN ('rf161_legacy_probe', 'rf161_wrong_version_probe')) AS legacyTables",
            params: [],
          },
          validRequestId,
        );

        await new Promise((resolve) => window.setTimeout(resolve, 100));
        channel.removeEventListener("message", malformedListener);
        return { malformedResponseCount, validResult, versionedTransactionSucceeded: true };
      } finally {
        channel.close();
      }
    });

    expect(result).toEqual({
      malformedResponseCount: 0,
      validResult: { value: 139, legacyTables: 0 },
      versionedTransactionSucceeded: true,
    });
    await assertHealthyPage(page, capture);
  } finally {
    await context.close();
  }
});

test("Chrome database bridge recovers across tab handoffs with fresh host identities", async ({ browser, baseURL }) => {
  const origin = new URL(baseURL ?? "");
  expect(origin.protocol).toBe("http:");
  expect(origin.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);

  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
    storageState: { cookies: [], origins: [] },
  });
  let probe: import("@playwright/test").Page | null = null;

  try {
    const pageA = await context.newPage();
    const captureA = captureConsole(pageA);
    await waitForQaReady(pageA);

    await context.route(`${origin.origin}/rf030-probe`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><head><title>RF030 probe</title></head><body>RF030 probe</body></html>",
      }),
    );
    probe = await context.newPage();
    await probe.goto("/rf030-probe", { waitUntil: "domcontentloaded" });
    await probe.evaluate(() => {
      type ProbeApi = {
        messages: unknown[];
        discoverHost: (timeoutMs?: number) => Promise<string | null>;
        request: (targetTabId: string, operation: string, source: string) => Promise<unknown>;
        post: (message: unknown) => void;
        close: () => void;
      };
      const channel = new BroadcastChannel("hafiz-db-bridge");
      const messages: unknown[] = [];
      channel.addEventListener("message", (event) => messages.push(event.data));
      const api: ProbeApi = {
        messages,
        discoverHost(timeoutMs = 1200) {
          const probeId = `rf030-discovery-${crypto.randomUUID()}`;
          return new Promise((resolve) => {
            const finish = (hostId: string | null) => {
              window.clearTimeout(timer);
              channel.removeEventListener("message", listener);
              resolve(hostId);
            };
            const listener = (event: MessageEvent<unknown>) => {
              const message = event.data;
              if (
                message &&
                typeof message === "object" &&
                !Array.isArray(message) &&
                "type" in message &&
                message.type === "host-ready" &&
                "tabId" in message &&
                typeof message.tabId === "string" &&
                message.tabId !== probeId
              ) {
                finish(message.tabId);
              }
            };
            const timer = window.setTimeout(() => finish(null), timeoutMs);
            channel.addEventListener("message", listener);
            channel.postMessage({ type: "host-probe", version: 1, tabId: probeId });
          });
        },
        request(targetTabId, operation, source) {
          const requestId = `rf030-request-${crypto.randomUUID()}`;
          const fromTabId = "rf030-probe-client";
          return new Promise((resolve, reject) => {
            const finish = (error: Error | null, result?: unknown) => {
              window.clearTimeout(timer);
              channel.removeEventListener("message", listener);
              if (error) reject(error);
              else resolve(result);
            };
            const listener = (event: MessageEvent<unknown>) => {
              const message = event.data;
              if (
                !message ||
                typeof message !== "object" ||
                Array.isArray(message) ||
                !("type" in message) ||
                message.type !== "response" ||
                !("requestId" in message) ||
                message.requestId !== requestId ||
                !("fromTabId" in message) ||
                message.fromTabId !== targetTabId ||
                !("targetTabId" in message) ||
                message.targetTabId !== fromTabId ||
                !("ok" in message) ||
                typeof message.ok !== "boolean"
              ) {
                return;
              }
              if (message.ok) finish(null, "result" in message ? message.result : undefined);
              else finish(new Error("error" in message ? String(message.error) : "RF030 request failed"));
            };
            const timer = window.setTimeout(() => finish(new Error("RF030 database request timed out")), 15_000);
            channel.addEventListener("message", listener);
            channel.postMessage({
              type: "request",
              version: 1,
              requestId,
              fromTabId,
              targetTabId,
              operation,
              source,
              params: [],
            });
          });
        },
        post(message) {
          channel.postMessage(message);
        },
        close() {
          channel.close();
          messages.length = 0;
        },
      };
      Object.defineProperty(window, "__rf030", { value: api, configurable: true });
    });

    const discoverHost = () =>
      probe!.evaluate(() =>
        (window as typeof window & { __rf030: { discoverHost: () => Promise<string | null> } }).__rf030.discoverHost(),
      );
    const waitForNewHost = async (retiredIds: string[]) => {
      let found: string | null = null;
      await expect
        .poll(
          async () => {
            const candidate = await discoverHost();
            if (candidate && !retiredIds.includes(candidate)) found = candidate;
            return found;
          },
          { timeout: 30_000, intervals: [250, 500, 1000] },
        )
        .not.toBeNull();
      return found!;
    };
    const appProbes = () =>
      probe!.evaluate(() => {
        const messages = (window as typeof window & { __rf030: { messages: unknown[] } }).__rf030.messages;
        return messages.flatMap((message) =>
          message &&
          typeof message === "object" &&
          !Array.isArray(message) &&
          "type" in message &&
          message.type === "host-probe" &&
          "tabId" in message &&
          typeof message.tabId === "string"
            ? [message.tabId]
            : [],
        );
      });
    const dispatchLifecycle = (page: import("@playwright/test").Page, type: "pagehide" | "pageshow") =>
      page.evaluate((eventType) => window.dispatchEvent(new Event(eventType)), type);

    const hostH1 = await waitForNewHost([]);
    const pageB = await context.newPage();
    const captureB = captureConsole(pageB);
    await waitForQaReady(pageB);

    await expect.poll(async () => (await appProbes()).length, { timeout: 10_000 }).toBeGreaterThan(0);
    const proxyBIds = await appProbes();
    const proxyBId = proxyBIds[0];
    expect(proxyBId).toBeTruthy();

    await dispatchLifecycle(pageA, "pagehide");
    const hostH2 = await waitForNewHost([hostH1]);
    await dispatchLifecycle(pageA, "pageshow");
    await expect
      .poll(async () => (await appProbes()).some((tabId) => tabId !== proxyBId), { timeout: 10_000 })
      .toBe(true);

    const proxyBProbeCount = (await appProbes()).filter((tabId) => tabId === proxyBId).length;
    await dispatchLifecycle(pageB, "pagehide");
    const hostH3 = await waitForNewHost([hostH1, hostH2]);
    expect(hostH3).not.toBe(hostH1);
    await dispatchLifecycle(pageB, "pageshow");
    await expect
      .poll(async () => (await appProbes()).filter((tabId) => tabId === proxyBId).length, {
        timeout: 10_000,
      })
      .toBeGreaterThan(proxyBProbeCount);
    expect(await discoverHost()).toBe(hostH3);

    const tableName = `rf030_stale_${crypto.randomUUID().replaceAll("-", "")}`;
    const createResult = await probe.evaluate(
      ({ hostId, table }) =>
        (
          window as typeof window & {
            __rf030: { request: (target: string, operation: string, source: string) => Promise<unknown> };
          }
        ).__rf030.request(hostId, "exec", `CREATE TEMP TABLE ${table} (value INTEGER)`),
      { hostId: hostH3, table: tableName },
    );
    expect(createResult).toBeNull();

    await probe.evaluate(
      ({ hostId, table }) => {
        const api = (window as typeof window & { __rf030: { post: (message: unknown) => void } }).__rf030;
        api.post({
          type: "request",
          version: 1,
          requestId: `rf030-stale-${crypto.randomUUID()}`,
          fromTabId: "rf030-stale-client",
          targetTabId: hostId,
          operation: "run",
          source: `INSERT INTO ${table}(value) VALUES (1)`,
          params: [],
        });
      },
      { hostId: hostH1, table: tableName },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    const currentRead = await probe.evaluate(
      ({ hostId, table }) =>
        (
          window as typeof window & {
            __rf030: {
              request: (target: string, operation: string, source: string) => Promise<unknown>;
            };
          }
        ).__rf030.request(hostId, "getFirst", `SELECT COUNT(*) AS count FROM ${table}`),
      { hostId: hostH3, table: tableName },
    );
    const validRead = await probe.evaluate(
      (hostId) =>
        (
          window as typeof window & {
            __rf030: {
              request: (target: string, operation: string, source: string) => Promise<unknown>;
            };
          }
        ).__rf030.request(hostId, "getFirst", "SELECT 139 AS value"),
      hostH3,
    );

    expect(currentRead).toEqual({ count: 0 });
    expect(validRead).toEqual({ value: 139 });
    await assertHealthyPage(pageA, captureA);
    await assertHealthyPage(pageB, captureB);
  } finally {
    if (probe) {
      await probe
        .evaluate(() => {
          (window as typeof window & { __rf030?: { close: () => void } }).__rf030?.close();
        })
        .catch(() => {});
    }
    await context.close();
  }
});

test("Chrome isolates peer rollback and expires an orphaned transaction lease", async ({ browser, baseURL }) => {
  const origin = new URL(baseURL ?? "");
  expect(origin.protocol).toBe("http:");
  expect(origin.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    const capture = captureConsole(page);
    await waitForQaReady(page);
    const result = await page.evaluate(async () => {
      const version = 1;
      const clients = ["A", "B"].map((suffix) => ({
        id: "rf161-" + suffix + "-" + crypto.randomUUID(),
        channel: new BroadcastChannel("hafiz-db-bridge"),
      }));
      const pending = new Map<
        string,
        { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
      >();
      const onMessage = (event: MessageEvent<unknown>) => {
        const value = event.data;
        if (
          !value ||
          typeof value !== "object" ||
          !("type" in value) ||
          value.type !== "response" ||
          !("version" in value) ||
          value.version !== version ||
          !("requestId" in value) ||
          typeof value.requestId !== "string" ||
          !("fromTabId" in value) ||
          value.fromTabId !== host ||
          !("targetTabId" in value) ||
          !clients.some((client) => client.id === value.targetTabId) ||
          !("ok" in value) ||
          typeof value.ok !== "boolean"
        )
          return;
        const entry = pending.get(value.requestId);
        if (!entry) return;
        pending.delete(value.requestId);
        clearTimeout(entry.timer);
        if (value.ok) entry.resolve("result" in value ? value.result : null);
        else entry.reject(new Error("error" in value ? String(value.error) : "Database request failed"));
      };
      let host = "";
      try {
        host = await new Promise<string>((resolve, reject) => {
          const listener = (event: MessageEvent<unknown>) => {
            const message = event.data;
            if (
              message &&
              typeof message === "object" &&
              "type" in message &&
              message.type === "host-ready" &&
              "version" in message &&
              message.version === version &&
              "tabId" in message &&
              typeof message.tabId === "string"
            ) {
              clearTimeout(timer);
              clients[0].channel.removeEventListener("message", listener);
              resolve(message.tabId);
            }
          };
          const timer = setTimeout(() => {
            clients[0].channel.removeEventListener("message", listener);
            reject(new Error("RF161 host discovery timed out"));
          }, 20_000);
          clients[0].channel.addEventListener("message", listener);
          clients[0].channel.postMessage({ type: "host-probe", version, tabId: clients[0].id });
        });
        for (const client of clients) client.channel.addEventListener("message", onMessage);
        function rpc(peer: number, operation: string, data: Record<string, unknown> = {}) {
          const requestId = crypto.randomUUID();
          return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(requestId);
              reject(new Error("RF161 request timed out: " + operation));
            }, 60_000);
            pending.set(requestId, { resolve, reject, timer });
            clients[peer].channel.postMessage({
              type: "request",
              version,
              requestId,
              fromTabId: clients[peer].id,
              targetTabId: host,
              operation,
              ...data,
            });
          });
        }
        async function begin() {
          const nonce = crypto.randomUUID();
          const receipt = await rpc(0, "begin", { nonce });
          if (!receipt || typeof receipt !== "object" || !("token" in receipt) || typeof receipt.token !== "string")
            throw new Error("Missing transaction token");
          return { nonce, token: receipt.token };
        }
        const table = "rf161_" + crypto.randomUUID().replaceAll("-", "");
        const sql = (peer: number, operation: string, source: string, transaction?: { nonce: string; token: string }) =>
          rpc(peer, operation, { source, params: [], ...(transaction ? { transaction } : {}) });
        await sql(0, "exec", "CREATE TEMP TABLE " + table + " (key TEXT PRIMARY KEY)");
        const first = await begin();
        await sql(0, "run", "INSERT INTO " + table + " VALUES ('rolled-back-A')", first);
        let outsideSettled = false;
        const outside = sql(1, "run", "INSERT INTO " + table + " VALUES ('kept-B')").finally(() => {
          outsideSettled = true;
        });
        const inside = await sql(0, "getAll", "SELECT key FROM " + table + " ORDER BY key", first);
        const blockedUntilRollback = !outsideSettled;
        await rpc(0, "rollback", first);
        await outside;
        const afterRollback = await sql(1, "getAll", "SELECT key FROM " + table + " ORDER BY key");
        await sql(1, "run", "DELETE FROM " + table);
        const orphan = await begin();
        await sql(0, "run", "INSERT INTO " + table + " VALUES ('orphan-A')", orphan);
        const leaseStarted = Date.now();
        // Give the host lease a five-second head start over B's ordinary 60-second RPC timeout.
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        await sql(1, "run", "INSERT INTO " + table + " VALUES ('after-expiry-B')");
        const leaseElapsed = Date.now() - leaseStarted;
        const afterExpiry = await sql(1, "getAll", "SELECT key FROM " + table + " ORDER BY key");
        let lateCommitRejected = false;
        try {
          await rpc(0, "commit", orphan);
        } catch {
          lateCommitRejected = true;
        }
        await sql(1, "exec", "DROP TABLE " + table);
        return { inside, blockedUntilRollback, afterRollback, afterExpiry, leaseElapsed, lateCommitRejected };
      } finally {
        for (const entry of pending.values()) {
          clearTimeout(entry.timer);
          entry.reject(new Error("RF161 probe closed"));
        }
        pending.clear();
        for (const client of clients) client.channel.close();
      }
    });
    expect(result.inside).toEqual([{ key: "rolled-back-A" }]);
    expect(result.blockedUntilRollback).toBe(true);
    expect(result.afterRollback).toEqual([{ key: "kept-B" }]);
    expect(result.afterExpiry).toEqual([{ key: "after-expiry-B" }]);
    expect(result.leaseElapsed).toBeGreaterThanOrEqual(59_000);
    expect(result.leaseElapsed).toBeLessThan(90_000);
    expect(result.lateCommitRejected).toBe(true);
    await assertHealthyPage(page, capture);
  } finally {
    await context.close();
  }
});
