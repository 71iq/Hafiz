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

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.channels.add(this);
  }

  postMessage(message: unknown) {
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

    jest.useFakeTimers();
    hostDb.getFirstAsync.mockReturnValueOnce(new Promise<null>(() => {}));
    const timedOut = database.getFirstAsync("SELECT timeout");
    const timeoutExpectation = expect(timedOut).rejects.toThrow("Database request timed out");
    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    await timeoutExpectation;
    jest.useRealTimers();

    hostDb.getFirstAsync.mockReturnValue(new Promise<null>(() => {}));
    const unmounted = database.getFirstAsync("SELECT unmount");
    const unmountExpectation = expect(unmounted).rejects.toThrow("Database provider closed");
    await proxy.unmountAsync();
    await unmountExpectation;
    await new Promise((resolve) => setTimeout(resolve, 250));

    const replacementStatuses: ReturnType<typeof useDatabaseStatus>[] = [];
    const replacement = render(
      <DatabaseProvider>
        <StatusProbe onStatus={(status) => replacementStatuses.push(status)} />
      </DatabaseProvider>,
    );
    await waitFor(() => expect(replacementStatuses.at(-1)?.isReady).toBe(true));
    const replacementDatabase = replacementStatuses.at(-1)?.db;
    if (!replacementDatabase) throw new Error("Expected replacement remote database proxy");
    const pageHidden = replacementDatabase.getFirstAsync("SELECT hidden");
    const pageHiddenExpectation = expect(pageHidden).rejects.toThrow("Database page hidden");
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await pageHiddenExpectation;
    external.close();
    await replacement.unmountAsync();
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
});
