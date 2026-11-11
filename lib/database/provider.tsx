import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { openDatabaseAsync } from "expo-sqlite";
import { importBundledDatabase } from "./bundled-database";
import { createConnectionOwner, type ConnectionOwner } from "@/lib/database/connection-owner";
import { createDatabaseBridgeClient, createDatabaseBridgeHost } from "@/lib/database/bridge-connection";
import type { AppDatabase } from "@/lib/database/types";
import { initializeDatabase, type ImportProgress } from "./init";
import { backfillAchievements } from "@/lib/achievements/queries";
import { DB_BRIDGE_VERSION, decodeDbMessage, type DbMessage } from "@/lib/database/bridge-messages";

type DatabaseContextType = {
  db: AppDatabase | null;
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
const POST_CLOSE_SETTLE_MS = 200;

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

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<AppDatabase | null>(null);
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
      db: AppDatabase | null;
      owner: ConnectionOwner | null;
      bridge: ReturnType<typeof createDatabaseBridgeHost> | null;
      release: (() => void) | null;
      ready: boolean;
      operations: Set<Promise<void>>;
      close: Promise<void> | null;
      cleanupFailure: Error | null;
    };
    type Remote = {
      hostId: string;
      active: boolean;
      db: AppDatabase | null;
      client: ReturnType<typeof createDatabaseBridgeClient> | null;
    };
    type Attempt = { epoch: number; resources: Host[]; promise: Promise<void> };
    let cancelled = false;
    let hidden = false;
    let epoch = 0;
    let channel: BroadcastChannel | null = null;
    let currentDb: AppDatabase | null = null;
    let host: Host | null = null;
    let remote: Remote | null = null;
    let attempt: Attempt | null = null;
    let restartRequested = false;
    let closeBarrier: Promise<void> = Promise.resolve();
    let closeFailure: Error | null = null;
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelWaits = new Set<() => void>();
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
    function retireRemote(owner: Remote, reason: Error, recover: boolean, publish = true) {
      if (remote !== owner || !owner.active) return;
      owner.active = false;
      owner.client?.retire(reason);
      remote = null;
      if (currentDb === owner.db) currentDb = null;
      if (!cancelled && publish) {
        setDb(null);
        setIsReady(false);
        setProgress(null);
      }
      if (recover && !cancelled && !hidden) scheduleRecovery();
    }
    function createRemoteDatabaseProxy(target: string) {
      const owner: Remote = { hostId: target, active: true, db: null, client: null };
      owner.client = createDatabaseBridgeClient({
        tabId,
        hostId: target,
        uniqueId,
        postMessage,
        isActive: () => owner.active && remote === owner && currentDb === owner.db && !cancelled && !hidden,
        onDisconnect: (reason) => retireRemote(owner, reason, true),
      });
      owner.db = owner.client.database;
      return owner;
    }
    const hostIsCurrent = (resource: Host) =>
      live(resource.epoch) && host === resource && resource.ready && currentDb === resource.db && resource.db !== null;
    function handleChannelMessage(event: MessageEvent<unknown>) {
      const message = decodeDbMessage(event.data);
      if (!message) return;
      if (message.type === "host-probe") {
        if (host && hostIsCurrent(host) && message.tabId !== tabId)
          postMessage({ type: "host-ready", version: DB_BRIDGE_VERSION, tabId: host.id });
        return;
      }
      if (message.type === "host-closing") {
        if (remote?.hostId === message.tabId) retireRemote(remote, new Error("Database host closed"), true);
        return;
      }
      if (message.type === "request") {
        const resource = host;
        if (!resource?.bridge || message.targetTabId !== resource.id || !hostIsCurrent(resource)) return;
        const operation = resource.bridge.handleRequest(message);
        resource.operations.add(operation);
        void operation.then(
          () => resource.operations.delete(operation),
          () => resource.operations.delete(operation),
        );
        return;
      }
      if (message.type === "response") remote?.client?.handleResponse(message);
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
        if (!postMessage({ type: "host-probe", version: DB_BRIDGE_VERSION, tabId })) finish(null);
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
    function retireResource(resource: Host, reason: Error) {
      resource.ready = false;
      resource.owner?.retire(reason);
      resource.bridge?.retire(reason);
    }
    function closeResource(resource: Host): Promise<void> {
      retireResource(resource, new Error("Database connection closing"));
      if (!resource.close)
        resource.close = (async () => {
          await Promise.allSettled([...resource.operations]);
          if (resource.cleanupFailure) throw resource.cleanupFailure;
          if (resource.owner) {
            // Keep the host lock if private handle close is uncertain.
            await resource.owner.close();
            resource.owner = null;
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
          await importBundledDatabase(DATABASE_NAME, quranDbAsset);
          if (!isActive()) return;
          const raw = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
          const owner = createConnectionOwner(raw, (failure) => {
            const belongs = host === resource || attempt?.resources.includes(resource);
            if (!live(resource.epoch) || !belongs) return;
            retire(failure);
            if (!cancelled) setError(failure.message);
            if (!cancelled && !hidden) scheduleRecovery();
          });
          resource.owner = owner;
          resource.db = owner.database;
          if (!isActive()) owner.retire(new Error("Database initialization retired"));
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
      resource.bridge = createDatabaseBridgeHost(resource.owner!, {
        hostId: resource.id,
        uniqueId,
        postMessage,
        isActive: () => hostIsCurrent(resource),
      });
      host = resource;
      resource.ready = true;
      currentDb = database;
      cancelRecovery();
      setDb(database);
      setProgress(null);
      setError(null);
      setIsReady(true);
      postMessage({ type: "host-ready", version: DB_BRIDGE_VERSION, tabId: resource.id });
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
          owner: null,
          bridge: null,
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
    function retire(reason: Error, publish = true) {
      epoch += 1;
      restartRequested = false;
      cancelRecovery();
      for (const cancel of [...cancelWaits]) cancel();
      const oldHost = host;
      const oldAttempt = attempt;
      host = null;
      if (oldHost?.ready) postMessage({ type: "host-closing", version: DB_BRIDGE_VERSION, tabId: oldHost.id });
      // Release held protocol callbacks before waiting for initialization or RPCs.
      for (const resource of new Set([...(oldAttempt?.resources ?? []), ...(oldHost ? [oldHost] : [])]))
        retireResource(resource, reason);
      if (remote) retireRemote(remote, reason, false, publish);
      currentDb = null;
      if (!cancelled && publish) {
        setDb(null);
        setIsReady(false);
        setProgress(null);
      }
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
      lifecycleWindow?.removeEventListener("pagehide", handlePageHide);
      lifecycleWindow?.removeEventListener("pageshow", handlePageShow);
      hidden = true;
      // Send remote reservation cancellation while the channel is still usable.
      retire(new Error("Database provider closed"), false);
      cancelled = true;
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
