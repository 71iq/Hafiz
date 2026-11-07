import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { importDatabaseFromAssetAsync, openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { initializeDatabase, type ImportProgress } from "./init";
import { backfillAchievements } from "@/lib/achievements/queries";
import {
  decodeDbMessage,
  isSQLiteBindParams,
  isSQLiteBindValue,
  type DbMessage,
  type DbOperation,
  type DbRequestMessage,
  type DbWireParam,
} from "@/lib/database/bridge-messages";

type DatabaseContextType = {
  db: SQLiteDatabase | null;
  isReady: boolean;
  progress: ImportProgress | null;
  error: string | null;
};

const DatabaseContext = createContext<DatabaseContextType>({
  db: null,
  isReady: false,
  progress: null,
  error: null,
});

const quranDbAsset = require("../../assets/data/quran.db");
const CHANNEL_NAME = "hafiz-db-bridge";
const LOCK_NAME = "hafiz-db-host";
const DATABASE_NAME = "hafiz.db";
const OPEN_MAX_ATTEMPTS = 5;
const OPEN_RETRY_DELAY_MS = 400;
const HOST_WAIT_TIMEOUT_MS = 30000;
const HOST_RETRY_WAIT_TIMEOUT_MS = 1500;
const HOST_CONNECT_RETRY_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 60000;
const POST_CLOSE_SETTLE_MS = 200;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  expectedHostTabId: string;
  owner: object;
};

type WebLockManager = {
  request: (
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | void,
  ) => Promise<void>;
};

type NavigatorWithWebLocks = Navigator & { locks?: WebLockManager };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isOpfsLockError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Access Handles") ||
    message.includes("SyncAccessHandle") ||
    message.includes("NoModificationAllowedError") ||
    message.includes("access handle") ||
    message.includes("already open")
  );
}

function formatRemoteError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toCloneableResult(result: unknown) {
  if (result == null) return null;
  return JSON.parse(JSON.stringify(result)) as unknown;
}

function executeBoundOperation(
  db: SQLiteDatabase,
  operation: Exclude<DbOperation, "exec">,
  source: string,
  params: DbRequestMessage["params"],
) {
  if (params.length === 1 && isSQLiteBindParams(params[0])) {
    switch (operation) {
      case "run":
        return db.runAsync(source, params[0]);
      case "getFirst":
        return db.getFirstAsync(source, params[0]);
      case "getAll":
        return db.getAllAsync(source, params[0]);
    }
  }

  if (params.every(isSQLiteBindValue)) {
    switch (operation) {
      case "run":
        return db.runAsync(source, ...params);
      case "getFirst":
        return db.getFirstAsync(source, ...params);
      case "getAll":
        return db.getAllAsync(source, ...params);
    }
  }

  throw new Error("Invalid database binding parameters");
}

async function executeDbOperation(db: SQLiteDatabase, message: DbRequestMessage) {
  switch (message.operation) {
    case "exec":
      return db.execAsync(message.source);
    case "run":
    case "getFirst":
    case "getAll":
      return executeBoundOperation(db, message.operation, message.source, message.params);
    default:
      throw new Error("Unsupported database operation");
  }
}

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const uniqueId = () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tabId = uniqueId();
    const isWeb = Platform.OS === "web";
    const hasBroadcastChannel = isWeb && typeof BroadcastChannel !== "undefined";
    const locks = isWeb && typeof navigator !== "undefined" ? (navigator as NavigatorWithWebLocks).locks : undefined;
    const hasWebLocks = typeof locks?.request === "function";
    type Host = {
      id: string;
      epoch: number;
      db: SQLiteDatabase | null;
      release: (() => void) | null;
      ready: boolean;
      operations: Set<Promise<void>>;
      close: Promise<void> | null;
      cleanupFailure: Error | null;
    };
    type Remote = { hostId: string; active: boolean; db: SQLiteDatabase | null };
    type Attempt = { epoch: number; resources: Host[]; promise: Promise<void> };
    let cancelled = false;
    let hidden = false;
    let epoch = 0;
    let channel: BroadcastChannel | null = null;
    let currentDb: SQLiteDatabase | null = null;
    let host: Host | null = null;
    let remote: Remote | null = null;
    let attempt: Attempt | null = null;
    let restartRequested = false;
    let closeBarrier: Promise<void> = Promise.resolve();
    let closeFailure: Error | null = null;
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelWaits = new Set<() => void>();
    const pendingRequests = new Map<string, PendingRequest>();
    const live = (generation: number) => !cancelled && !hidden && generation === epoch;
    const asError = (value: unknown) => (value instanceof Error ? value : new Error(String(value)));

    function postMessage(message: DbMessage) {
      if (!channel || cancelled) return false;
      try {
        channel.postMessage(message);
        return true;
      } catch {
        // A host result may settle after its channel has closed.
        return false;
      }
    }
    function rejectPendingRequests(reason: Error, owner?: object) {
      for (const [id, pending] of pendingRequests) {
        if (owner && pending.owner !== owner) continue;
        clearTimeout(pending.timeout);
        pendingRequests.delete(id);
        pending.reject(reason);
      }
    }
    function cancelRecovery() {
      if (recoveryTimer !== null) clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
    function scheduleRecovery() {
      cancelRecovery();
      const generation = epoch;
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        if (live(generation) && !currentDb) void runInit();
      }, POST_CLOSE_SETTLE_MS);
    }
    function retireRemote(owner: Remote, reason: Error, recover: boolean) {
      if (remote !== owner || !owner.active) return;
      owner.active = false;
      remote = null;
      if (currentDb === owner.db) currentDb = null;
      rejectPendingRequests(reason, owner);
      if (!cancelled) {
        setDb(null);
        setIsReady(false);
        setProgress(null);
      }
      if (recover && !cancelled && !hidden) scheduleRecovery();
    }
    function createRemoteDatabaseProxy(target: string) {
      const owner: Remote = { hostId: target, active: true, db: null };
      const active = () => owner.active && remote === owner && currentDb === owner.db && !cancelled && !hidden;
      const request = (operation: DbOperation, source: string, params: DbWireParam[] = []) =>
        new Promise<unknown>((resolve, reject) => {
          if (!active() || !channel) {
            reject(new Error("Database proxy is no longer active"));
            return;
          }
          const requestId = uniqueId();
          const timeout = setTimeout(() => {
            if (pendingRequests.get(requestId)?.owner !== owner) return;
            pendingRequests.delete(requestId);
            reject(new Error("Database request timed out"));
            retireRemote(owner, new Error("Database host connection lost"), true);
          }, REQUEST_TIMEOUT_MS);
          pendingRequests.set(requestId, { resolve, reject, timeout, expectedHostTabId: target, owner });
          if (
            !postMessage({
              type: "request",
              requestId,
              fromTabId: tabId,
              targetTabId: target,
              operation,
              source,
              params,
            })
          ) {
            clearTimeout(timeout);
            pendingRequests.delete(requestId);
            reject(new Error("Database channel is unavailable"));
            retireRemote(owner, new Error("Database channel is unavailable"), true);
          }
        });
      const proxy = {
        execAsync: (source: string) => request("exec", source) as Promise<void>,
        runAsync: (source: string, ...params: DbWireParam[]) =>
          request("run", source, params) as ReturnType<SQLiteDatabase["runAsync"]>,
        getFirstAsync: (source: string, ...params: DbWireParam[]) =>
          request("getFirst", source, params) as ReturnType<SQLiteDatabase["getFirstAsync"]>,
        getAllAsync: (source: string, ...params: DbWireParam[]) =>
          request("getAll", source, params) as ReturnType<SQLiteDatabase["getAllAsync"]>,
        withTransactionAsync: async (task: () => Promise<void>) => {
          await proxy.execAsync("BEGIN");
          try {
            await task();
            await proxy.execAsync("COMMIT");
          } catch (failure) {
            try {
              await proxy.execAsync("ROLLBACK");
            } catch {
              /* Preserve the original failure. */
            }
            throw failure;
          }
        },
        prepareAsync: async (source: string) => ({
          executeAsync: (...params: DbWireParam[]) => request("run", source, params),
          finalizeAsync: async () => {},
        }),
        closeAsync: async () => {},
      };
      owner.db = proxy as SQLiteDatabase;
      return owner;
    }
    const hostIsCurrent = (resource: Host) =>
      live(resource.epoch) && host === resource && resource.ready && currentDb === resource.db && resource.db !== null;
    function handleChannelMessage(event: MessageEvent<unknown>) {
      const message = decodeDbMessage(event.data);
      if (!message) return;
      if (message.type === "host-probe") {
        if (host && hostIsCurrent(host) && message.tabId !== tabId) postMessage({ type: "host-ready", tabId: host.id });
        return;
      }
      if (message.type === "host-closing") {
        if (remote?.hostId === message.tabId) retireRemote(remote, new Error("Database host closed"), true);
        return;
      }
      if (message.type === "request") {
        const resource = host;
        if (!resource || message.targetTabId !== resource.id || !hostIsCurrent(resource)) return;
        const database = resource.db!;
        const operation = (async () => {
          try {
            const result = toCloneableResult(await executeDbOperation(database, message));
            if (hostIsCurrent(resource))
              postMessage({
                type: "response",
                requestId: message.requestId,
                fromTabId: resource.id,
                targetTabId: message.fromTabId,
                ok: true,
                result,
              });
          } catch (failure) {
            if (hostIsCurrent(resource))
              postMessage({
                type: "response",
                requestId: message.requestId,
                fromTabId: resource.id,
                targetTabId: message.fromTabId,
                ok: false,
                error: formatRemoteError(failure),
              });
          }
        })();
        resource.operations.add(operation);
        void operation.finally(() => resource.operations.delete(operation));
        return;
      }
      if (message.type === "response") {
        if (message.targetTabId !== tabId) return;
        const pending = pendingRequests.get(message.requestId);
        if (!pending || pending.owner !== remote || message.fromTabId !== pending.expectedHostTabId) return;
        clearTimeout(pending.timeout);
        pendingRequests.delete(message.requestId);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(message.error ?? "Database request failed"));
      }
    }
    function waitBeforeRetry(ms: number, isActive: () => boolean) {
      if (!isActive()) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          cancelWaits.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, ms);
        cancelWaits.add(finish);
      });
    }
    function waitForHost(timeoutMs: number, isActive: () => boolean) {
      if (!channel || !isActive()) return Promise.resolve<string | null>(null);
      const targetChannel = channel;
      return new Promise<string | null>((resolve) => {
        let settled = false;
        const finish = (value: string | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          targetChannel.removeEventListener("message", onMessage);
          cancelWaits.delete(cancel);
          resolve(value);
        };
        const cancel = () => finish(null);
        const onMessage = (event: MessageEvent<unknown>) => {
          const message = decodeDbMessage(event.data);
          if (isActive() && message?.type === "host-ready" && message.tabId !== tabId) finish(message.tabId);
        };
        const timer = setTimeout(cancel, timeoutMs);
        cancelWaits.add(cancel);
        targetChannel.addEventListener("message", onMessage);
        if (!postMessage({ type: "host-probe", tabId })) finish(null);
      });
    }
    function tryAcquireHostLock(resource: Host, isActive: () => boolean) {
      if (!isActive()) return Promise.resolve(false);
      if (!hasWebLocks || !locks) return Promise.resolve(true);
      return new Promise<boolean>((resolve, reject) => {
        locks
          .request(LOCK_NAME, { mode: "exclusive", ifAvailable: true }, (lock) => {
            if (!lock || !isActive()) {
              resolve(false);
              return;
            }
            return new Promise<void>((release) => {
              resource.release = release;
              resolve(true);
            });
          })
          .catch(reject);
      });
    }
    async function releaseResourceLock(resource: Host) {
      const release = resource.release;
      resource.release = null;
      if (release) {
        release();
        await sleep(POST_CLOSE_SETTLE_MS);
      }
    }
    function closeResource(resource: Host): Promise<void> {
      resource.ready = false;
      if (!resource.close)
        resource.close = (async () => {
          await Promise.allSettled([...resource.operations]);
          if (resource.cleanupFailure) throw resource.cleanupFailure;
          if (resource.db) {
            // Do not release its lock or open another handle if close fails.
            await resource.db.closeAsync();
            resource.db = null;
          }
          await releaseResourceLock(resource);
        })();
      return resource.close;
    }
    function recordCloseFailure(failure: unknown) {
      closeFailure = asError(failure);
      if (!cancelled) {
        setError(closeFailure.message);
        setIsReady(false);
        setDb(null);
      }
    }
    async function closeResources(resources: Host[]) {
      const results = await Promise.allSettled([...new Set(resources)].map(closeResource));
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
    }
    async function openWithRetry(resource: Host, isActive: () => boolean) {
      let lastError: unknown;
      for (let index = 1; index <= OPEN_MAX_ATTEMPTS; index++) {
        if (!isActive()) return;
        try {
          if (isWeb) await importDatabaseFromAssetAsync(DATABASE_NAME, { assetId: quranDbAsset });
          if (!isActive()) return;
          resource.db = await openDatabaseAsync(DATABASE_NAME);
          return;
        } catch (failure) {
          lastError = failure;
          if (asError(failure).message.includes("SQLite worker cleanup failed: ")) {
            resource.cleanupFailure = asError(failure);
            throw failure;
          }
          if (!isActive() || !isWeb || !isOpfsLockError(failure) || index === OPEN_MAX_ATTEMPTS) break;
          await releaseResourceLock(resource);
          await waitBeforeRetry(OPEN_RETRY_DELAY_MS * index, isActive);
          if (!isActive() || !(await tryAcquireHostLock(resource, isActive))) break;
        }
      }
      throw asError(lastError);
    }
    async function connectToHost(resource: Host, isActive: () => boolean) {
      const deadline = Date.now() + HOST_WAIT_TIMEOUT_MS;
      let lastError: Error = new Error("Unable to connect to the active database tab");
      while (isActive() && Date.now() < deadline) {
        const target = await waitForHost(HOST_RETRY_WAIT_TIMEOUT_MS, isActive);
        if (!isActive()) return true;
        if (target) {
          const proxy = createRemoteDatabaseProxy(target);
          remote = proxy;
          currentDb = proxy.db;
          cancelRecovery();
          setDb(currentDb);
          setProgress(null);
          setError(null);
          setIsReady(true);
          return true;
        }
        lastError = new Error("Unable to connect to the active database tab");
        await waitBeforeRetry(HOST_CONNECT_RETRY_DELAY_MS, isActive);
        if (!isActive()) return true;
        if (await tryAcquireHostLock(resource, isActive)) return false;
      }
      if (!isActive()) return true;
      throw lastError;
    }
    async function initializeAsHost(resource: Host, isActive: () => boolean) {
      await openWithRetry(resource, isActive);
      if (!isActive() || !resource.db) return;
      const database = resource.db;
      await initializeDatabase(database, (next) => {
        if (isActive()) setProgress(next);
      });
      if (!isActive()) return;
      await backfillAchievements(database, { notify: false });
      if (!isActive()) return;
      host = resource;
      resource.ready = true;
      currentDb = database;
      cancelRecovery();
      setDb(database);
      setProgress(null);
      setError(null);
      setIsReady(true);
      postMessage({ type: "host-ready", tabId: resource.id });
    }
    function runInit(): Promise<void> {
      if (cancelled || hidden || currentDb) return Promise.resolve();
      if (closeFailure) {
        setError(closeFailure.message);
        return Promise.resolve();
      }
      if (attempt) {
        restartRequested = true;
        return attempt.promise;
      }
      const owner: Attempt = { epoch, resources: [], promise: Promise.resolve() };
      attempt = owner;
      const previousClose = closeBarrier;
      const isActive = () => live(owner.epoch);
      const makeResource = () => {
        const resource: Host = {
          id: uniqueId(),
          epoch: owner.epoch,
          db: null,
          release: null,
          ready: false,
          operations: new Set(),
          close: null,
          cleanupFailure: null,
        };
        owner.resources.push(resource);
        return resource;
      };
      owner.promise = (async () => {
        await previousClose;
        if (!isActive()) return;
        setIsReady(false);
        setError(null);
        setProgress(null);
        const resource = makeResource();
        try {
          const shouldHost = await tryAcquireHostLock(resource, isActive);
          if (!isActive()) return;
          if (!shouldHost && hasBroadcastChannel && (await connectToHost(resource, isActive))) return;
          if (isActive()) await initializeAsHost(resource, isActive);
        } catch (failure) {
          if (!isActive()) return;
          try {
            await closeResources(owner.resources);
          } catch (closeError) {
            recordCloseFailure(closeError);
            return;
          }
          if (!isActive()) return;
          if (isWeb && hasBroadcastChannel && isOpfsLockError(failure)) {
            const fallback = makeResource();
            try {
              if (await connectToHost(fallback, isActive)) return;
              if (isActive()) await initializeAsHost(fallback, isActive);
              return;
            } catch (hostError) {
              failure = hostError;
              try {
                await closeResource(fallback);
              } catch (closeError) {
                recordCloseFailure(closeError);
                return;
              }
            }
          }
          if (isActive()) {
            console.error("Database initialization failed:", failure);
            setProgress(null);
            setError(asError(failure).message);
          }
        }
      })()
        .catch((failure) => {
          if (isActive()) recordCloseFailure(failure);
        })
        .finally(() => {
          if (attempt !== owner) return;
          attempt = null;
          const restart = restartRequested;
          restartRequested = false;
          if (restart && !cancelled && !hidden && !currentDb && !closeFailure) void runInit();
        });
      return owner.promise;
    }
    function retire(reason: Error) {
      epoch += 1;
      restartRequested = false;
      cancelRecovery();
      for (const cancel of [...cancelWaits]) cancel();
      const oldHost = host;
      host = null;
      if (oldHost?.ready) postMessage({ type: "host-closing", tabId: oldHost.id });
      if (oldHost) oldHost.ready = false;
      if (remote) retireRemote(remote, reason, false);
      rejectPendingRequests(reason);
      currentDb = null;
      if (!cancelled) {
        setDb(null);
        setIsReady(false);
        setProgress(null);
      }
      const oldAttempt = attempt;
      const previousClose = closeBarrier;
      closeBarrier = (async () => {
        const prior = await Promise.allSettled([previousClose, oldAttempt?.promise ?? Promise.resolve()]);
        await closeResources([...(oldAttempt?.resources ?? []), ...(oldHost ? [oldHost] : [])]);
        const failed = prior.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      })();
      void closeBarrier.catch(recordCloseFailure);
    }
    function handlePageHide() {
      if (hidden) return;
      hidden = true;
      retire(new Error("Database page hidden"));
    }
    function handlePageShow() {
      hidden = false;
      void runInit();
    }
    if (hasBroadcastChannel) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener("message", handleChannelMessage);
    }
    const lifecycleWindow = isWeb && typeof window !== "undefined" ? window : null;
    lifecycleWindow?.addEventListener("pagehide", handlePageHide);
    lifecycleWindow?.addEventListener("pageshow", handlePageShow);
    void runInit();
    return () => {
      // Stop admission before draining captured work and closing its resources.
      lifecycleWindow?.removeEventListener("pagehide", handlePageHide);
      lifecycleWindow?.removeEventListener("pageshow", handlePageShow);
      if (host?.ready) postMessage({ type: "host-closing", tabId: host.id });
      cancelled = true;
      hidden = true;
      retire(new Error("Database provider closed"));
      channel?.close();
      channel = null;
    };
  }, []);

  return <DatabaseContext.Provider value={{ db, isReady, progress, error }}>{children}</DatabaseContext.Provider>;
}

export function useDatabase() {
  const context = useContext(DatabaseContext);
  if (!context.db) {
    throw new Error("Database not initialized");
  }
  return context.db;
}

export function useDatabaseStatus() {
  return useContext(DatabaseContext);
}
