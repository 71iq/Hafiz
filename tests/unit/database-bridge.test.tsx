import React, { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import type { SQLiteDatabase } from "expo-sqlite";
import { decodeDbMessage } from "@/lib/database/bridge-messages";
import { DatabaseProvider, useDatabaseStatus } from "@/lib/database/provider";

const mockInitializeDatabase = jest.fn();
const mockBackfillAchievements = jest.fn();
const mockOpenDatabaseAsync = jest.fn();
const mockImportDatabaseFromAssetAsync = jest.fn();

jest.mock("expo-sqlite", () => ({
  __esModule: true,
  importDatabaseFromAssetAsync: (...args: unknown[]) => mockImportDatabaseFromAssetAsync(...args),
  openDatabaseAsync: (...args: unknown[]) => mockOpenDatabaseAsync(...args),
}));
jest.mock("@/lib/database/init", () => ({
  __esModule: true,
  initializeDatabase: (...args: unknown[]) => mockInitializeDatabase(...args),
}));
jest.mock("@/lib/achievements/queries", () => ({
  __esModule: true,
  backfillAchievements: (...args: unknown[]) => mockBackfillAchievements(...args),
}));

type MessageListener = (event: MessageEvent<unknown>) => void;

class FakeBroadcastChannel {
  static channels = new Set<FakeBroadcastChannel>();
  static messages: unknown[] = [];
  readonly name: string;
  private readonly listeners = new Set<MessageListener>();
  private closed = false;

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.channels.add(this);
  }

  postMessage(message: unknown) {
    if (this.closed) throw new Error("BroadcastChannel is closed");
    FakeBroadcastChannel.messages.push(message);
    for (const channel of FakeBroadcastChannel.channels) {
      if (channel === this || channel.name !== this.name) continue;
      queueMicrotask(() => {
        for (const listener of channel.listeners) {
          listener({ data: message } as MessageEvent<unknown>);
        }
      });
    }
  }

  addEventListener(_type: "message", listener: MessageListener) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: MessageListener) {
    this.listeners.delete(listener);
  }

  close() {
    this.closed = true;
    this.listeners.clear();
    FakeBroadcastChannel.channels.delete(this);
  }

  static reset() {
    for (const channel of FakeBroadcastChannel.channels) channel.close();
    FakeBroadcastChannel.messages = [];
  }
}

class FakeLockManager {
  static held = false;

  async request(
    _name: string,
    _options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | void,
  ) {
    if (FakeLockManager.held) {
      await callback(null);
      return;
    }

    FakeLockManager.held = true;
    try {
      await callback({});
    } finally {
      FakeLockManager.held = false;
    }
  }
}

function StatusProbe({ onStatus }: { onStatus: (status: ReturnType<typeof useDatabaseStatus>) => void }) {
  const status = useDatabaseStatus();
  useEffect(() => {
    onStatus(status);
  }, [onStatus, status]);
  return null;
}

function makeDatabase() {
  return {
    closeAsync: jest.fn().mockResolvedValue(undefined),
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    getAllAsync: jest.fn().mockResolvedValue([]),
  };
}

function objectMessage(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function flushMessages() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("database bridge message boundary", () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let lifecycleTarget: EventTarget;
  let hostDb: ReturnType<typeof makeDatabase>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenDatabaseAsync.mockReset();
    mockInitializeDatabase.mockReset();
    mockBackfillAchievements.mockReset();
    mockImportDatabaseFromAssetAsync.mockReset();
    jest.replaceProperty(Platform, "OS", "web");
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: FakeBroadcastChannel,
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: new FakeLockManager(),
    });
    lifecycleTarget = new EventTarget();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: lifecycleTarget,
    });
    FakeBroadcastChannel.reset();
    FakeLockManager.held = false;
    hostDb = makeDatabase();
    mockInitializeDatabase.mockResolvedValue(undefined);
    mockBackfillAchievements.mockResolvedValue(undefined);
    mockImportDatabaseFromAssetAsync.mockResolvedValue(undefined);
    mockOpenDatabaseAsync.mockResolvedValue(hostDb as unknown as SQLiteDatabase);
  });

  afterEach(() => {
    jest.useRealTimers();
    FakeBroadcastChannel.reset();
    jest.restoreAllMocks();
    if (originalBroadcastChannel) {
      Object.defineProperty(globalThis, "BroadcastChannel", {
        configurable: true,
        value: originalBroadcastChannel,
      });
    } else {
      delete (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    }
    if (originalLocks) {
      Object.defineProperty(navigator, "locks", originalLocks);
    } else {
      Reflect.deleteProperty(navigator, "locks");
    }
  });

  afterAll(() => {
    if (originalBroadcastChannel) {
      Object.defineProperty(globalThis, "BroadcastChannel", {
        configurable: true,
        value: originalBroadcastChannel,
      });
    } else {
      delete (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    }
    if (originalLocks) {
      Object.defineProperty(navigator, "locks", originalLocks);
    } else {
      Reflect.deleteProperty(navigator, "locks");
    }
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it.each([
    null,
    true,
    3,
    "response",
    [],
    {},
    { type: "unknown" },
    { type: "host-ready", tabId: "" },
    {
      type: "request",
      requestId: "r1",
      fromTabId: "client",
      targetTabId: "host",
      operation: "unknown",
      source: "SELECT 1",
      params: [],
    },
    {
      type: "request",
      requestId: "r1",
      fromTabId: "client",
      targetTabId: "host",
      operation: "run",
      source: "SELECT 1",
      params: [undefined],
    },
    {
      type: "request",
      requestId: "r1",
      fromTabId: "client",
      targetTabId: "host",
      operation: "run",
      source: "SELECT 1",
      params: [[1, undefined]],
    },
    { type: "response", requestId: "r1", fromTabId: "host", targetTabId: "client", ok: "true" },
  ])("rejects malformed value %j", (value) => {
    expect(decodeDbMessage(value)).toBeNull();
  });

  it.each([
    [undefined],
    [1n],
    [new Date()],
    [[undefined]],
    [new Array(1)],
    [[1], [2]],
    [{ $value: 1 }, 2],
    [{ $value: { nested: true } }],
  ])("rejects invalid binding arguments case %#", (...params) => {
    expect(
      decodeDbMessage({
        type: "request",
        requestId: "invalid",
        fromTabId: "client",
        targetTabId: "host",
        operation: "run",
        source: "SELECT ?",
        params,
      }),
    ).toBeNull();
  });

  it("decodes valid wire binding forms without rewriting them", () => {
    const blob = new Uint8Array([1, 2]);
    const values = ["text", 1, Number.NaN, Number.POSITIVE_INFINITY, true, null, blob];
    const message = decodeDbMessage({
      type: "request",
      requestId: "request-1",
      fromTabId: "client",
      targetTabId: "host",
      operation: "run",
      source: "INSERT INTO test VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: values,
      extra: "ignored",
    });

    expect(message).toEqual({
      type: "request",
      requestId: "request-1",
      fromTabId: "client",
      targetTabId: "host",
      operation: "run",
      source: "INSERT INTO test VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: values,
    });
    expect(
      decodeDbMessage({
        type: "request",
        requestId: "request-2",
        fromTabId: "client",
        targetTabId: "host",
        operation: "run",
        source: "INSERT INTO test VALUES (?, ?)",
        params: [["array", 1]],
      }),
    ).not.toBeNull();
    expect(
      decodeDbMessage({
        type: "request",
        requestId: "request-3",
        fromTabId: "client",
        targetTabId: "host",
        operation: "run",
        source: "INSERT INTO test VALUES ($value, $blob)",
        params: [{ $value: "named", $blob: blob }],
      }),
    ).not.toBeNull();
  });

  it("dispatches valid host operations and keeps a matching proxy reply owner", async () => {
    const hostStatuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const proxyStatuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const host = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => hostStatuses.push(status)} />
      </DatabaseProvider>,
    );
    await waitFor(() => expect(hostStatuses.at(-1)?.isReady).toBe(true));

    const proxy = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => proxyStatuses.push(status)} />
      </DatabaseProvider>,
    );
    await waitFor(() => expect(proxyStatuses.at(-1)?.isReady).toBe(true));
    const database = proxyStatuses.at(-1)?.db;
    if (!database) throw new Error("Expected remote database proxy");

    const blob = new Uint8Array([7]);
    await database.execAsync("SELECT 1");
    await database.runAsync("SELECT ?", "value", 2, true, null, blob);
    await database.runAsync("SELECT ?", ["array", 3]);
    await database.runAsync("SELECT $value", { $value: "named" });
    await expect(database.getFirstAsync("SELECT NULL")).resolves.toBeNull();
    await expect(database.getAllAsync("SELECT 1")).resolves.toEqual([]);

    expect(hostDb.execAsync).toHaveBeenCalledWith("SELECT 1");
    expect(hostDb.runAsync).toHaveBeenNthCalledWith(1, "SELECT ?", "value", 2, true, null, blob);
    expect(hostDb.runAsync).toHaveBeenNthCalledWith(2, "SELECT ?", ["array", 3]);
    expect(hostDb.runAsync).toHaveBeenNthCalledWith(3, "SELECT $value", { $value: "named" });
    expect(hostDb.getFirstAsync).toHaveBeenCalledWith("SELECT NULL");
    expect(hostDb.getAllAsync).toHaveBeenCalledWith("SELECT 1");

    const external = new FakeBroadcastChannel("hafiz-db-bridge");
    const hostReady = FakeBroadcastChannel.messages
      .map(objectMessage)
      .find((message) => message?.type === "host-ready");
    if (!hostReady || typeof hostReady.tabId !== "string") throw new Error("Expected host discovery message");
    const runCallCount = hostDb.runAsync.mock.calls.length;
    external.postMessage(42);
    external.postMessage({
      type: "request",
      requestId: "invalid-request",
      fromTabId: "external",
      targetTabId: hostReady.tabId,
      operation: "run",
      source: "SELECT invalid",
      params: [new Date()],
    });
    await flushMessages();
    expect(hostDb.runAsync).toHaveBeenCalledTimes(runCallCount);

    hostDb.runAsync.mockRejectedValueOnce(new Error("synthetic failure"));
    await expect(database.runAsync("SELECT error")).rejects.toThrow("synthetic failure");

    let releaseDelayed!: (value: { legitimate: boolean }) => void;
    hostDb.getFirstAsync.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseDelayed = resolve;
      }),
    );
    let settled = false;
    const requestPromise = database.getFirstAsync("SELECT delayed").finally(() => {
      settled = true;
    });
    await waitFor(() => expect(hostDb.getFirstAsync).toHaveBeenLastCalledWith("SELECT delayed"));
    const request = FakeBroadcastChannel.messages
      .map(objectMessage)
      .find((message) => message?.type === "request" && message.source === "SELECT delayed");
    if (!request) throw new Error("Expected delayed request envelope");
    const reply = {
      type: "response",
      requestId: request.requestId,
      fromTabId: request.targetTabId,
      targetTabId: request.fromTabId,
      ok: true,
      result: { wrong: true },
    };
    for (const invalid of [
      { ...reply, fromTabId: "wrong-host" },
      { ...reply, targetTabId: "wrong-client" },
      { ...reply, requestId: "unknown-request" },
      { ...reply, ok: "false" },
      { ...reply, ok: false, error: 42 },
    ]) {
      external.postMessage(invalid);
      await flushMessages();
      expect(settled).toBe(false);
    }
    await act(async () => {
      releaseDelayed({ legitimate: true });
    });
    await expect(requestPromise).resolves.toEqual({ legitimate: true });

    let rejectDelayed!: (error: Error) => void;
    hostDb.getFirstAsync.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectDelayed = reject;
      }),
    );
    let failureSettled = false;
    const failedRequest = database.getFirstAsync("SELECT delayed failure").finally(() => {
      failureSettled = true;
    });
    const failureExpectation = expect(failedRequest).rejects.toThrow("synthetic deferred SQL failure");
    await waitFor(() => expect(hostDb.getFirstAsync).toHaveBeenLastCalledWith("SELECT delayed failure"));
    const failureRequest = FakeBroadcastChannel.messages
      .map(objectMessage)
      .find((message) => message?.type === "request" && message.source === "SELECT delayed failure");
    if (!failureRequest) throw new Error("Expected delayed failure request");
    external.postMessage({
      ...reply,
      requestId: failureRequest.requestId,
      fromTabId: "wrong-host",
      targetTabId: failureRequest.fromTabId,
    });
    await flushMessages();
    expect(failureSettled).toBe(false);
    await act(async () => {
      rejectDelayed(new Error("synthetic deferred SQL failure"));
    });
    await failureExpectation;

    external.close();
    await proxy.unmountAsync();
    await host.unmountAsync();
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  it("waits for a valid host-ready message before connecting", async () => {
    FakeLockManager.held = true;
    const external = new FakeBroadcastChannel("hafiz-db-bridge");
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    await waitFor(() =>
      expect(FakeBroadcastChannel.messages.some((value) => objectMessage(value)?.type === "host-probe")).toBe(true),
    );
    for (const invalid of [42, { type: "host-ready", tabId: 123 }, { type: "host-ready", tabId: "" }]) {
      external.postMessage(invalid);
      await flushMessages();
      expect(statuses.at(-1)?.isReady).toBe(false);
      expect(mockOpenDatabaseAsync).not.toHaveBeenCalled();
    }
    external.postMessage({ type: "host-ready", tabId: "synthetic-host" });
    await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
    expect(mockOpenDatabaseAsync).not.toHaveBeenCalled();
    await view.unmountAsync();
    external.close();
  });
  it("RF030 recovers a silently lost host after timeout without replaying its write", async () => {
    FakeLockManager.held = true;
    const external = new FakeBroadcastChannel("hafiz-db-bridge");
    external.addEventListener("message", (event) => {
      if (objectMessage(event.data)?.type === "host-probe")
        external.postMessage({ type: "host-ready", tabId: "lost-host" });
    });
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    try {
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      const old = statuses.at(-1)!.db!;
      external.close();
      FakeLockManager.held = false;
      jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
      const uncertain = old.runAsync("INSERT INTO synthetic_probe VALUES (1)");
      const rejected = expect(uncertain).rejects.toThrow("Database request timed out");
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      await rejected;
      expect(statuses.at(-1)?.isReady).toBe(false);
      expect(statuses.at(-1)?.db).toBeNull();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2_000);
      });
      expect(statuses.at(-1)?.isReady).toBe(true);
      expect(statuses.at(-1)?.db).not.toBe(old);
      expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
      expect(hostDb.runAsync).not.toHaveBeenCalled();
      await expect(statuses.at(-1)!.db!.getAllAsync("SELECT fresh")).resolves.toEqual([]);
    } finally {
      jest.useRealTimers();
      await view.unmountAsync();
      external.close();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  });

  it("RF030 refuses a retained proxy write while its page is hidden", async () => {
    FakeLockManager.held = true;
    const external = new FakeBroadcastChannel("hafiz-db-bridge");
    external.addEventListener("message", (event) => {
      if (objectMessage(event.data)?.type === "host-probe")
        external.postMessage({ type: "host-ready", tabId: "active-host" });
    });
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    try {
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      const old = statuses.at(-1)!.db!;
      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
      });
      let result = "pending";
      void old.runAsync("INSERT hidden").then(
        () => {
          result = "completed";
        },
        () => {
          result = "rejected";
        },
      );
      await flushMessages();
      expect(FakeBroadcastChannel.messages.some((value) => objectMessage(value)?.source === "INSERT hidden")).toBe(
        false,
      );
      expect(result).toBe("rejected");
    } finally {
      await view.unmountAsync();
      external.close();
    }
  });

  it("RF030 uses a new host identity after the same tab reopens", async () => {
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    try {
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      const old = FakeBroadcastChannel.messages.map(objectMessage).find((value) => value?.type === "host-ready")!.tabId;
      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
      await act(async () => {
        window.dispatchEvent(new Event("pageshow"));
      });
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      const current = FakeBroadcastChannel.messages
        .map(objectMessage)
        .filter((value) => value?.type === "host-ready")
        .at(-1)!.tabId;
      expect(current).not.toBe(old);
    } finally {
      await view.unmountAsync();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  });

  it("RF030 retires a pending open before foregrounding and acquires a fresh owned handle", async () => {
    let resolveOpen!: (value: ReturnType<typeof makeDatabase>) => void;
    const old = makeDatabase(),
      current = makeDatabase();
    mockOpenDatabaseAsync
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
      )
      .mockResolvedValueOnce(current);
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    try {
      await waitFor(() => expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1));
      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
        window.dispatchEvent(new Event("pageshow"));
      });
      await act(async () => {
        resolveOpen(old);
      });
      await waitFor(() => expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      expect(old.closeAsync).toHaveBeenCalledTimes(1);
      expect(statuses.at(-1)?.db).toBe(current);
      expect(FakeLockManager.held).toBe(true);
    } finally {
      resolveOpen(old);
      await view.unmountAsync();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  });

  it("RF030 drains admitted host SQL before closing and releasing its lock", async () => {
    let release!: () => void;
    hostDb.runAsync.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    const external = new FakeBroadcastChannel("hafiz-db-bridge");
    try {
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      const host = FakeBroadcastChannel.messages
        .map(objectMessage)
        .find((value) => value?.type === "host-ready")!.tabId;
      external.postMessage({
        type: "request",
        requestId: "held-write",
        fromTabId: "synthetic-client",
        targetTabId: host,
        operation: "run",
        source: "INSERT held",
        params: [],
      });
      await waitFor(() => expect(hostDb.runAsync).toHaveBeenCalledTimes(1));
      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
      });
      expect(hostDb.closeAsync).not.toHaveBeenCalled();
      expect(FakeLockManager.held).toBe(true);
      await act(async () => {
        release();
      });
      await waitFor(() => expect(hostDb.closeAsync).toHaveBeenCalledTimes(1));
      expect(
        FakeBroadcastChannel.messages.some(
          (value) => objectMessage(value)?.requestId === "held-write" && objectMessage(value)?.type === "response",
        ),
      ).toBe(false);
    } finally {
      release?.();
      external.close();
      await view.unmountAsync();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  });
  async function remoteFixture() {
    FakeLockManager.held = true;
    const external = new FakeBroadcastChannel("hafiz-db-bridge");
    const wire = { hostId: "first-host", requests: [] as Record<string, unknown>[] };
    external.addEventListener("message", (event) => {
      const message = objectMessage(event.data);
      if (message?.type === "host-probe") external.postMessage({ type: "host-ready", tabId: wire.hostId });
      if (message?.type === "request") wire.requests.push(message);
    });
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
    return { external, wire, statuses, view, db: statuses.at(-1)!.db! };
  }
  it.each(["unmount", "pagehide"] as const)(
    "RF030 preserves pending %s rejection and rejects every stale proxy method",
    async (mode) => {
      const f = await remoteFixture();
      try {
        const prepared = await f.db.prepareAsync("INSERT prepared");
        const pending = f.db.getFirstAsync("SELECT pending");
        const expectation = expect(pending).rejects.toThrow(
          mode === "unmount" ? "Database provider closed" : "Database page hidden",
        );
        await flushMessages();
        if (mode === "unmount") await f.view.unmountAsync();
        else
          await act(async () => {
            window.dispatchEvent(new Event("pagehide"));
          });
        await expectation;
        const before = f.wire.requests.length;
        for (const operation of [
          () => f.db.execAsync("INSERT stale exec"),
          () => f.db.runAsync("INSERT stale run"),
          () => f.db.getFirstAsync("SELECT stale"),
          () => f.db.getAllAsync("SELECT stale all"),
          () => prepared.executeAsync(),
        ]) {
          await expect(operation()).rejects.toThrow("Database proxy is no longer active");
        }
        await flushMessages();
        expect(f.wire.requests).toHaveLength(before);
      } finally {
        await f.view.unmountAsync();
        f.external.close();
      }
    },
  );
  it("RF030 keeps a new proxy current through delayed old closing and reply messages", async () => {
    const f = await remoteFixture();
    try {
      const oldPending = f.db.getFirstAsync("SELECT old");
      const oldRejected = expect(oldPending).rejects.toThrow("Database host closed");
      await flushMessages();
      const oldRequest = f.wire.requests.at(-1)!;
      f.wire.hostId = "second-host";
      await act(async () => {
        f.external.postMessage({ type: "host-closing", tabId: "first-host" });
      });
      await oldRejected;
      await waitFor(() => expect(f.statuses.at(-1)?.db).not.toBe(f.db));
      await waitFor(() => expect(f.statuses.at(-1)?.isReady).toBe(true));
      const current = f.statuses.at(-1)!.db!;
      let settled = false;
      const result = current.getFirstAsync("SELECT current").finally(() => {
        settled = true;
      });
      await flushMessages();
      const request = f.wire.requests.at(-1)!;
      f.external.postMessage({ type: "host-closing", tabId: "first-host" });
      f.external.postMessage({
        type: "response",
        requestId: oldRequest.requestId,
        fromTabId: "first-host",
        targetTabId: oldRequest.fromTabId,
        ok: true,
        result: "obsolete",
      });
      f.external.postMessage({
        type: "response",
        requestId: request.requestId,
        fromTabId: "first-host",
        targetTabId: request.fromTabId,
        ok: true,
        result: "wrong-tenure",
      });
      await flushMessages();
      expect(settled).toBe(false);
      expect(f.statuses.at(-1)?.isReady).toBe(true);
      f.external.postMessage({
        type: "response",
        requestId: request.requestId,
        fromTabId: "second-host",
        targetTabId: request.fromTabId,
        ok: true,
        result: { current: true },
      });
      await expect(result).resolves.toEqual({ current: true });
      await expect(f.db.runAsync("INSERT old callback")).rejects.toThrow("Database proxy is no longer active");
    } finally {
      await f.view.unmountAsync();
      f.external.close();
    }
  });
  it.each(["import", "open", "initialize", "backfill"] as const)(
    "RF030 retires a pending %s success or error before later initialization phases",
    async (stage) => {
      for (const fails of [false, true]) {
        const old = makeDatabase(),
          fresh = makeDatabase();
        let entered!: () => void, resolve!: (value?: unknown) => void, reject!: (error: Error) => void;
        const started = new Promise<void>((yes) => {
          entered = yes;
        });
        const held = new Promise<unknown>((yes, no) => {
          resolve = yes;
          reject = no;
        });
        let obsoleteProgress: ((value: { phase: string; current: number; total: number }) => void) | undefined;
        mockOpenDatabaseAsync.mockReset().mockResolvedValue(fresh);
        mockImportDatabaseFromAssetAsync.mockReset().mockResolvedValue(undefined);
        mockInitializeDatabase.mockReset().mockResolvedValue(undefined);
        mockBackfillAchievements.mockReset().mockResolvedValue(undefined);
        if (stage === "import")
          mockImportDatabaseFromAssetAsync.mockImplementationOnce(() => {
            entered();
            return held;
          });
        if (stage === "open")
          mockOpenDatabaseAsync.mockImplementationOnce(() => {
            entered();
            return held;
          });
        if (stage === "initialize" || stage === "backfill") mockOpenDatabaseAsync.mockResolvedValueOnce(old);
        if (stage === "initialize")
          mockInitializeDatabase.mockImplementationOnce((_db, progress) => {
            obsoleteProgress = progress;
            entered();
            return held;
          });
        if (stage === "backfill")
          mockBackfillAchievements.mockImplementationOnce(() => {
            entered();
            return held;
          });
        const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
        const view = render(
          <DatabaseProvider>
            <StatusProbe onStatus={(status) => statuses.push(status)} />
          </DatabaseProvider>,
        );
        try {
          await started;
          await act(async () => {
            window.dispatchEvent(new Event("pagehide"));
            window.dispatchEvent(new Event("pageshow"));
          });
          expect(FakeLockManager.held).toBe(true);
          await act(async () => {
            obsoleteProgress?.({ phase: "obsolete", current: 99, total: 100 });
          });
          expect(statuses.at(-1)?.progress).toBeNull();
          await act(async () => {
            if (fails) reject(new Error("obsolete initialization failure"));
            else resolve(stage === "open" ? old : undefined);
          });
          await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
          expect(statuses.at(-1)?.db).toBe(fresh);
          expect(statuses.at(-1)?.error).toBeNull();
          expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(stage === "import" ? 1 : 2);
          expect(old.closeAsync).toHaveBeenCalledTimes(stage === "import" || (stage === "open" && fails) ? 0 : 1);
          if (stage === "initialize") expect(mockBackfillAchievements).toHaveBeenCalledTimes(1);
        } finally {
          resolve(old);
          await view.unmountAsync();
          await new Promise((yes) => setTimeout(yes, 250));
        }
      }
    },
  );
  it("RF030 coalesces repeated foregrounding while a prior handle is still closing", async () => {
    let release!: () => void;
    const held = new Promise<void>((yes) => {
      release = yes;
    });
    const old = hostDb,
      fresh = makeDatabase();
    old.closeAsync.mockReturnValueOnce(held);
    mockOpenDatabaseAsync.mockResolvedValueOnce(old).mockResolvedValue(fresh);
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    try {
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
        window.dispatchEvent(new Event("pageshow"));
      });
      await waitFor(() => expect(old.closeAsync).toHaveBeenCalledTimes(1));
      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
        window.dispatchEvent(new Event("pageshow"));
        window.dispatchEvent(new Event("pageshow"));
      });
      expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
      await act(async () => {
        release();
      });
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      expect(statuses.at(-1)?.db).toBe(fresh);
      expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(2);
      expect(old.closeAsync).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await view.unmountAsync();
      await new Promise((yes) => setTimeout(yes, 250));
    }
  });
  it("RF030 releases a late obsolete lock grant without importing or opening under it", async () => {
    let grant!: () => void;
    const gate = new Promise<void>((yes) => {
      grant = yes;
    });
    const manager = new FakeLockManager();
    let calls = 0;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (...args: Parameters<FakeLockManager["request"]>) => {
          calls++;
          if (calls === 1) await gate;
          return manager.request(...args);
        },
      },
    });
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    try {
      await waitFor(() => expect(calls).toBe(1));
      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
        window.dispatchEvent(new Event("pageshow"));
        grant();
      });
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      expect(calls).toBe(2);
      expect(mockImportDatabaseFromAssetAsync).toHaveBeenCalledTimes(1);
      expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
    } finally {
      grant();
      await view.unmountAsync();
      await new Promise((yes) => setTimeout(yes, 250));
    }
  });
  it("RF030 preserves native initialization and closes its handle on unmount", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
    expect(mockImportDatabaseFromAssetAsync).not.toHaveBeenCalled();
    expect(mockInitializeDatabase).toHaveBeenCalledWith(hostDb, expect.any(Function));
    expect(mockBackfillAchievements).toHaveBeenCalledWith(hostDb, { notify: false });
    await view.unmountAsync();
    await flushMessages();
    expect(hostDb.closeAsync).toHaveBeenCalledTimes(1);
  });
  it("RF030 quarantines a failed close instead of releasing its lock or opening another handle", async () => {
    hostDb.closeAsync.mockRejectedValueOnce(new Error("synthetic close failure"));
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    try {
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
        window.dispatchEvent(new Event("pageshow"));
      });
      await waitFor(() => expect(statuses.at(-1)?.error).toBe("synthetic close failure"));
      expect(statuses.at(-1)?.db).toBeNull();
      expect(statuses.at(-1)?.isReady).toBe(false);
      expect(FakeLockManager.held).toBe(true);
      await act(async () => {
        window.dispatchEvent(new Event("pageshow"));
      });
      expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
      expect(hostDb.closeAsync).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmountAsync();
    }
  });
  it.each(["import", "open"].flatMap((stage) => [false, true].map((retired) => ({ stage, retired }))))(
    "RF030 retains the host lock after $stage worker cleanup fails, retired=$retired",
    async ({ stage, retired }) => {
      let release!: () => void;
      const pending = new Promise<void>((yes) => {
        release = yes;
      });
      const failure = new Error("SQLite worker cleanup failed: synthetic held OPFS handle");
      const operation = stage === "import" ? mockImportDatabaseFromAssetAsync : mockOpenDatabaseAsync;
      operation.mockImplementationOnce(async () => {
        await pending;
        throw failure;
      });
      const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
      const view = render(
        <DatabaseProvider>
          <StatusProbe onStatus={(status) => statuses.push(status)} />
        </DatabaseProvider>,
      );
      try {
        await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
        await act(async () => {
          if (retired) {
            window.dispatchEvent(new Event("pagehide"));
            window.dispatchEvent(new Event("pageshow"));
          }
          release();
        });
        await waitFor(() => expect(statuses.at(-1)?.error).toBe(failure.message));
        expect(statuses.at(-1)?.db).toBeNull();
        expect(statuses.at(-1)?.isReady).toBe(false);
        expect(FakeLockManager.held).toBe(true);
        await act(async () => {
          window.dispatchEvent(new Event("pageshow"));
        });
        expect(operation).toHaveBeenCalledTimes(1);
        expect(mockInitializeDatabase).not.toHaveBeenCalled();
      } finally {
        release();
        await view.unmountAsync();
      }
    },
  );
  it("RF030 does not replay uncertain SQL or roll it back through a reconnected proxy", async () => {
    let release!: () => void,
      commits = 0;
    const held = new Promise<void>((yes) => {
      release = yes;
    });
    hostDb.runAsync.mockImplementationOnce(async () => {
      await held;
      commits++;
      return { lastInsertRowId: 1, changes: 1 };
    });
    const hostStatuses: ReturnType<typeof useDatabaseStatus>[] = [],
      proxyStatuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const hostView = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => hostStatuses.push(status)} />
      </DatabaseProvider>,
    );
    let proxyView: ReturnType<typeof render> | undefined;
    try {
      await waitFor(() => expect(hostStatuses.at(-1)?.isReady).toBe(true));
      proxyView = render(
        <DatabaseProvider>
          <StatusProbe onStatus={(status) => proxyStatuses.push(status)} />
        </DatabaseProvider>,
      );
      await waitFor(() => expect(proxyStatuses.at(-1)?.isReady).toBe(true));
      const old = proxyStatuses.at(-1)!.db!;
      jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
      const transaction = old.withTransactionAsync(async () => {
        await old.runAsync("INSERT uncertain");
      });
      const rejected = expect(transaction).rejects.toThrow("Database request timed out");
      await act(async () => {
        for (let i = 0; i < 100; i++) await Promise.resolve();
      });
      expect(hostDb.runAsync).toHaveBeenCalledTimes(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      await rejected;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2_000);
      });
      expect(proxyStatuses.at(-1)?.isReady).toBe(true);
      expect(proxyStatuses.at(-1)?.db).not.toBe(old);
      expect(hostDb.execAsync.mock.calls.map((args) => args[0])).toEqual(["BEGIN"]);
      expect(commits).toBe(0);
      await act(async () => {
        release();
      });
      expect(commits).toBe(1);
      expect(hostDb.runAsync).toHaveBeenCalledTimes(1);
      hostDb.getFirstAsync.mockResolvedValueOnce({ commits });
      await expect(proxyStatuses.at(-1)!.db!.getFirstAsync("SELECT committed")).resolves.toEqual({ commits: 1 });
      expect(hostDb.execAsync.mock.calls.map((args) => args[0])).toEqual(["BEGIN"]);
    } finally {
      release();
      jest.useRealTimers();
      await proxyView?.unmountAsync();
      await hostView.unmountAsync();
      await new Promise((yes) => setTimeout(yes, 250));
    }
  });
  it("RF030 drains a rejected host operation after unmount without replying on the closed channel", async () => {
    let reject!: (error: Error) => void;
    hostDb.getAllAsync.mockReturnValueOnce(
      new Promise((_resolve, no) => {
        reject = no;
      }),
    );
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    const external = new FakeBroadcastChannel("hafiz-db-bridge");
    try {
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      const hostId = FakeBroadcastChannel.messages
        .map(objectMessage)
        .find((value) => value?.type === "host-ready")!.tabId;
      external.postMessage({
        type: "request",
        requestId: "rejected-drain",
        fromTabId: "synthetic",
        targetTabId: hostId,
        operation: "getAll",
        source: "SELECT drain",
        params: [],
      });
      await waitFor(() => expect(hostDb.getAllAsync).toHaveBeenCalledTimes(1));
      await view.unmountAsync();
      expect(hostDb.closeAsync).not.toHaveBeenCalled();
      await act(async () => {
        reject(new Error("retired SQL failure"));
      });
      await waitFor(() => expect(hostDb.closeAsync).toHaveBeenCalledTimes(1));
      expect(
        FakeBroadcastChannel.messages.some(
          (value) => objectMessage(value)?.requestId === "rejected-drain" && objectMessage(value)?.type === "response",
        ),
      ).toBe(false);
    } finally {
      reject?.(new Error("fixture cleanup"));
      await view.unmountAsync();
      external.close();
      await new Promise((yes) => setTimeout(yes, 250));
    }
  });
  it("RF030 closes an open completed after unmount without starting schema or achievement work", async () => {
    let release!: (db: ReturnType<typeof makeDatabase>) => void;
    mockOpenDatabaseAsync.mockReturnValueOnce(
      new Promise((yes) => {
        release = yes;
      }),
    );
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    try {
      await waitFor(() => expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1));
      await view.unmountAsync();
      expect(hostDb.closeAsync).not.toHaveBeenCalled();
      await act(async () => {
        release(hostDb);
      });
      await waitFor(() => expect(hostDb.closeAsync).toHaveBeenCalledTimes(1));
      expect(mockInitializeDatabase).not.toHaveBeenCalled();
      expect(mockBackfillAchievements).not.toHaveBeenCalled();
      expect(FakeBroadcastChannel.messages.some((value) => objectMessage(value)?.type === "host-ready")).toBe(false);
    } finally {
      release(hostDb);
      await view.unmountAsync();
      await new Promise((yes) => setTimeout(yes, 250));
    }
  });
  it("RF030 retires fallback discovery after an OPFS retry cannot reacquire its lock", async () => {
    const manager = new FakeLockManager();
    let acquisitions = 0;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (...args: Parameters<FakeLockManager["request"]>) => {
          acquisitions++;
          if (acquisitions === 2) {
            await args[2](null);
            return;
          }
          await manager.request(...args);
        },
      },
    });
    mockImportDatabaseFromAssetAsync.mockRejectedValueOnce(
      new Error("NoModificationAllowedError: synthetic OPFS busy"),
    );
    const statuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const view = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => statuses.push(status)} />
      </DatabaseProvider>,
    );
    try {
      await waitFor(
        () =>
          expect(FakeBroadcastChannel.messages.some((value) => objectMessage(value)?.type === "host-probe")).toBe(true),
        { timeout: 2_000 },
      );
      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
        window.dispatchEvent(new Event("pageshow"));
      });
      await waitFor(() => expect(statuses.at(-1)?.isReady).toBe(true));
      expect(statuses.at(-1)?.error).toBeNull();
      expect(mockImportDatabaseFromAssetAsync).toHaveBeenCalledTimes(2);
      expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
      expect(acquisitions).toBe(3);
    } finally {
      await view.unmountAsync();
      await new Promise((yes) => setTimeout(yes, 250));
    }
  });
});
