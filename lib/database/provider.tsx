import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { Platform } from "react-native";
import {
  importDatabaseFromAssetAsync,
  openDatabaseAsync,
  type SQLiteDatabase,
} from "expo-sqlite";
import { initializeDatabase, type ImportProgress } from "./init";
import { backfillAchievements } from "@/lib/achievements/queries";

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
const REQUEST_TIMEOUT_MS = 60000;
const POST_CLOSE_SETTLE_MS = 200;

type DbOperation = "exec" | "run" | "getFirst" | "getAll";

type HostProbeMessage = { type: "host-probe"; tabId: string };
type HostReadyMessage = { type: "host-ready"; tabId: string };
type HostClosingMessage = { type: "host-closing"; tabId: string };
type DbRequestMessage = {
  type: "request";
  requestId: string;
  fromTabId: string;
  targetTabId: string;
  operation: DbOperation;
  source: string;
  params: unknown[];
};
type DbResponseMessage = {
  type: "response";
  requestId: string;
  fromTabId: string;
  targetTabId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type DbMessage =
  | HostProbeMessage
  | HostReadyMessage
  | HostClosingMessage
  | DbRequestMessage
  | DbResponseMessage;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

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

async function executeDbOperation(db: SQLiteDatabase, message: DbRequestMessage) {
  switch (message.operation) {
    case "exec":
      return db.execAsync(message.source);
    case "run":
      return db.runAsync(message.source, ...(message.params as any[]));
    case "getFirst":
      return db.getFirstAsync(message.source, ...(message.params as any[]));
    case "getAll":
      return db.getAllAsync(message.source, ...(message.params as any[]));
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
    const tabId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    let cancelled = false;
    let currentDb: SQLiteDatabase | null = null;
    let channel: BroadcastChannel | null = null;
    let releaseLock: (() => void) | null = null;
    let hostTabId: string | null = null;
    let isHostReady = false;
    const pendingRequests = new Map<string, PendingRequest>();
    const isWeb = Platform.OS === "web";
    const hasBroadcastChannel =
      isWeb && typeof BroadcastChannel !== "undefined";
    const hasWebLocks =
      isWeb &&
      typeof navigator !== "undefined" &&
      typeof (navigator as any).locks?.request === "function";

    function postMessage(message: DbMessage) {
      channel?.postMessage(message);
    }

    function rejectPendingRequests(error: Error) {
      for (const [requestId, pending] of pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(error);
        pendingRequests.delete(requestId);
      }
    }

    function createRemoteDatabaseProxy(targetTabId: string) {
      const request = (
        operation: DbOperation,
        source: string,
        params: unknown[] = [],
      ) =>
        new Promise<unknown>((resolve, reject) => {
          if (!channel) {
            reject(new Error("Database channel is unavailable"));
            return;
          }

          const requestId =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`;
          const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject(new Error("Database request timed out"));
          }, REQUEST_TIMEOUT_MS);

          pendingRequests.set(requestId, { resolve, reject, timeout });
          postMessage({
            type: "request",
            requestId,
            fromTabId: tabId,
            targetTabId,
            operation,
            source,
            params,
          });
        });

      const proxy: any = {
        execAsync: (source: string) =>
          request("exec", source) as Promise<void>,
        runAsync: (source: string, ...params: unknown[]) =>
          request("run", source, params) as ReturnType<
            SQLiteDatabase["runAsync"]
          >,
        getFirstAsync: (source: string, ...params: unknown[]) =>
          request("getFirst", source, params) as ReturnType<
            SQLiteDatabase["getFirstAsync"]
          >,
        getAllAsync: (source: string, ...params: unknown[]) =>
          request("getAll", source, params) as ReturnType<
            SQLiteDatabase["getAllAsync"]
          >,
        withTransactionAsync: async (task: () => Promise<void>) => {
          await proxy.execAsync?.("BEGIN");
          try {
            await task();
            await proxy.execAsync?.("COMMIT");
          } catch (transactionError) {
            try {
              await proxy.execAsync?.("ROLLBACK");
            } catch {
              // Ignore rollback failures and surface the original transaction error.
            }
            throw transactionError;
          }
        },
        prepareAsync: async (source: string) => ({
          executeAsync: (...params: unknown[]) => request("run", source, params),
          finalizeAsync: async () => {},
        }),
        closeAsync: async () => {},
      };

      return proxy as SQLiteDatabase;
    }

    function handleChannelMessage(event: MessageEvent<DbMessage>) {
      const message = event.data;
      if (!message || !("type" in message)) return;

      if (message.type === "host-probe") {
        if (message.tabId !== tabId && isHostReady) {
          postMessage({ type: "host-ready", tabId });
        }
        return;
      }

      if (message.type === "host-closing") {
        if (message.tabId === hostTabId && !releaseLock && !cancelled) {
          hostTabId = null;
          currentDb = null;
          setDb(null);
          setIsReady(false);
          rejectPendingRequests(new Error("Database host closed"));
          setTimeout(() => {
            if (!cancelled) void runInit();
          }, POST_CLOSE_SETTLE_MS);
        }
        return;
      }

      if (message.type === "request") {
        if (message.targetTabId !== tabId || !isHostReady || !currentDb) return;

        void (async () => {
          try {
            const result = toCloneableResult(
              await executeDbOperation(currentDb!, message),
            );
            postMessage({
              type: "response",
              requestId: message.requestId,
              fromTabId: tabId,
              targetTabId: message.fromTabId,
              ok: true,
              result,
            });
          } catch (requestError) {
            postMessage({
              type: "response",
              requestId: message.requestId,
              fromTabId: tabId,
              targetTabId: message.fromTabId,
              ok: false,
              error: formatRemoteError(requestError),
            });
          }
        })();
        return;
      }

      if (message.type === "response") {
        if (message.targetTabId !== tabId) return;
        const pending = pendingRequests.get(message.requestId);
        if (!pending) return;

        clearTimeout(pending.timeout);
        pendingRequests.delete(message.requestId);
        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(message.error ?? "Database request failed"));
        }
      }
    }

    async function waitForHost() {
      if (!channel) return null;
      const activeChannel = channel;

      return new Promise<string | null>((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          activeChannel.removeEventListener("message", onMessage);
          resolve(null);
        }, HOST_WAIT_TIMEOUT_MS);

        const onMessage = (event: MessageEvent<DbMessage>) => {
          const message = event.data;
          if (message?.type !== "host-ready" || message.tabId === tabId) return;
          if (settled) return;

          settled = true;
          clearTimeout(timeout);
          activeChannel.removeEventListener("message", onMessage);
          resolve(message.tabId);
        };

        activeChannel.addEventListener("message", onMessage);
        activeChannel.postMessage({ type: "host-probe", tabId });
      });
    }

    async function tryAcquireHostLock() {
      if (!hasWebLocks) return true;

      return new Promise<boolean>((resolve, reject) => {
        const locks = (navigator as Navigator & {
          locks: {
            request: (
              name: string,
              options: { mode: "exclusive"; ifAvailable: true },
              callback: (lock: unknown) => Promise<void> | void,
            ) => Promise<void>;
          };
        }).locks;

        locks
          .request(
            LOCK_NAME,
            { mode: "exclusive", ifAvailable: true },
            (lock) => {
              if (!lock) {
                resolve(false);
                return;
              }

              return new Promise<void>((release) => {
                releaseLock = release;
                resolve(true);
              });
            },
          )
          .catch(reject);
      });
    }

    async function releaseLockHandle() {
      const release = releaseLock;
      releaseLock = null;
      isHostReady = false;
      if (release) {
        release();
        await sleep(POST_CLOSE_SETTLE_MS);
      }
    }

    async function closeDbHandle() {
      const handle = currentDb;
      currentDb = null;
      if (handle) {
        try {
          await handle.closeAsync();
        } catch {
          // Ignore close failures during provider teardown.
        }
      }
    }

    async function openWithRetry(): Promise<SQLiteDatabase> {
      let lastError: unknown;

      for (let attempt = 1; attempt <= OPEN_MAX_ATTEMPTS; attempt += 1) {
        try {
          if (isWeb) {
            await importDatabaseFromAssetAsync(DATABASE_NAME, {
              assetId: quranDbAsset,
            });
          }
          return await openDatabaseAsync(DATABASE_NAME);
        } catch (err) {
          lastError = err;
          await closeDbHandle();

          if (!isWeb || !isOpfsLockError(err) || attempt === OPEN_MAX_ATTEMPTS) {
            break;
          }

          await releaseLockHandle();
          await sleep(OPEN_RETRY_DELAY_MS * attempt);
          if (!(await tryAcquireHostLock())) break;
        }
      }

      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    async function connectToHost() {
      const targetTabId = await waitForHost();
      if (!targetTabId) {
        throw new Error("Unable to connect to the active database tab");
      }

      hostTabId = targetTabId;
      currentDb = createRemoteDatabaseProxy(targetTabId);
      if (!cancelled) {
        setDb(currentDb);
        setProgress(null);
        setError(null);
        setIsReady(true);
      }
    }

    async function runInit() {
      if (cancelled) return;
      setIsReady(false);
      setError(null);
      setProgress(null);

      try {
        const shouldHost = await tryAcquireHostLock();
        if (cancelled) return;

        if (!shouldHost && hasBroadcastChannel) {
          await connectToHost();
          return;
        }

        const database = await openWithRetry();
        currentDb = database;
        setDb(database);

        await initializeDatabase(database, setProgress);
        await backfillAchievements(database, { notify: false });

        if (!cancelled) {
          isHostReady = true;
          postMessage({ type: "host-ready", tabId });
          setProgress(null);
          setError(null);
          setIsReady(true);
        }
      } catch (err) {
        if (cancelled) return;

        await closeDbHandle();
        await releaseLockHandle();

        if (isWeb && hasBroadcastChannel && isOpfsLockError(err)) {
          try {
            await connectToHost();
            return;
          } catch (hostError) {
            err = hostError;
          }
        }

        console.error("Database initialization failed:", err);
        setProgress(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    if (hasBroadcastChannel) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener("message", handleChannelMessage);
    }

    void runInit();

    return () => {
      cancelled = true;
      rejectPendingRequests(new Error("Database provider closed"));
      if (isHostReady) postMessage({ type: "host-closing", tabId });
      void closeDbHandle();
      void releaseLockHandle();
      channel?.close();
    };
  }, []);

  return (
    <DatabaseContext.Provider value={{ db, isReady, progress, error }}>
      {children}
    </DatabaseContext.Provider>
  );
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
