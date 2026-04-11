import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { initializeDatabase, type ImportProgress } from "./init";

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

const CHANNEL_NAME = "hafiz-db-lock";
const LOCK_NAME = "hafiz-db-exclusive";
const OPEN_MAX_ATTEMPTS = 5;
const OPEN_RETRY_DELAY_MS = 400;
const POST_CLOSE_SETTLE_MS = 200;

type ClaimMessage = { type: "claim"; tabId: string };

export function useDatabase(): SQLiteDatabase {
  const ctx = useContext(DatabaseContext);
  if (!ctx.db) {
    throw new Error("Database not initialized yet");
  }
  return ctx.db;
}

export function useDatabaseStatus() {
  return useContext(DatabaseContext);
}

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ejected, setEjected] = useState(false);

  const reconnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // ─── Per-effect state ────────────────────────────────────────────
    const tabId =
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    const ejectedFlag = { current: false };

    let cancelled = false;
    let currentDb: SQLiteDatabase | null = null;
    let channel: BroadcastChannel | null = null;
    let releaseLock: (() => void) | null = null;

    const isWeb = Platform.OS === "web";
    const hasBroadcastChannel =
      isWeb && typeof BroadcastChannel !== "undefined";
    const hasWebLocks =
      isWeb &&
      typeof navigator !== "undefined" &&
      "locks" in navigator &&
      typeof (navigator as any).locks?.request === "function";

    // ─── Helpers ────────────────────────────────────────────────────
    function isOpfsLockError(err: unknown): boolean {
      const msg = err instanceof Error ? err.message : String(err);
      return (
        msg.includes("Access Handles") ||
        msg.includes("NoModificationAllowedError") ||
        msg.includes("access handle") ||
        msg.includes("already open")
      );
    }

    async function closeDbHandle() {
      const toClose = currentDb;
      currentDb = null;
      if (toClose) {
        try {
          await toClose.closeAsync();
        } catch {
          // Handle may already be broken; ignore.
        }
        // OPFS Access Handles don't release synchronously on closeAsync;
        // give the worker a moment before another tab tries to open.
        await new Promise((r) => setTimeout(r, POST_CLOSE_SETTLE_MS));
      }
    }

    function releaseLockHandle() {
      const release = releaseLock;
      releaseLock = null;
      release?.();
    }

    async function acquireLock(): Promise<void> {
      if (!hasWebLocks) return;
      await new Promise<void>((acquired) => {
        (navigator as any).locks.request(
          LOCK_NAME,
          { mode: "exclusive" },
          () =>
            new Promise<void>((resolveInside) => {
              releaseLock = resolveInside;
              acquired();
            })
        );
      });
    }

    async function openWithRetry(): Promise<SQLiteDatabase> {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < OPEN_MAX_ATTEMPTS; attempt++) {
        if (cancelled || ejectedFlag.current) throw new Error("aborted");
        try {
          return await openDatabaseAsync("hafiz.db");
        } catch (err) {
          lastErr = err;
          if (!isOpfsLockError(err) || attempt === OPEN_MAX_ATTEMPTS - 1) {
            throw err;
          }
          // Re-broadcast in case a newly-started tab missed the initial claim.
          if (channel) {
            channel.postMessage({
              type: "claim",
              tabId,
            } satisfies ClaimMessage);
          }
          await new Promise((r) =>
            setTimeout(r, OPEN_RETRY_DELAY_MS * (attempt + 1))
          );
        }
      }
      throw lastErr ?? new Error("openWithRetry: unreachable");
    }

    async function ejectOnClaim() {
      if (ejectedFlag.current) return;
      ejectedFlag.current = true;

      // UI switches immediately so child consumers unmount.
      setDb(null);
      setIsReady(false);
      setProgress(null);
      setEjected(true);

      await closeDbHandle();
      releaseLockHandle();
    }

    async function runInit() {
      if (cancelled) return;

      // Reset state for a fresh attempt (also matters for reconnect).
      ejectedFlag.current = false;
      setError(null);
      setEjected(false);
      setIsReady(false);
      setProgress(null);

      try {
        // 1. Signal any existing tab to release voluntarily.
        if (channel) {
          channel.postMessage({
            type: "claim",
            tabId,
          } satisfies ClaimMessage);
        }

        // 2. Acquire exclusive ownership via Web Locks. Queues if another
        // tab holds it, and auto-releases if that tab crashes.
        await acquireLock();
        if (cancelled || ejectedFlag.current) return;

        // 3. Open the database (with retry for OPFS stragglers).
        const database = await openWithRetry();
        if (cancelled || ejectedFlag.current) {
          try {
            await database.closeAsync();
          } catch {}
          return;
        }
        currentDb = database;
        setDb(database);

        // 4. Run schema + data imports.
        await initializeDatabase(database, (p) => {
          if (!cancelled && !ejectedFlag.current && currentDb === database) {
            setProgress(p);
          }
        });

        if (!cancelled && !ejectedFlag.current && currentDb === database) {
          setIsReady(true);
        }
      } catch (err) {
        if (cancelled || ejectedFlag.current) return;
        console.error("[Database] Init error:", err);
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    // ─── Wire up broadcast listener ─────────────────────────────────
    if (hasBroadcastChannel) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener("message", (e: MessageEvent) => {
        const data = e.data as ClaimMessage | undefined;
        if (!data || data.type !== "claim" || data.tabId === tabId) return;
        void ejectOnClaim();
      });
    }

    reconnectRef.current = () => {
      void runInit();
    };

    void runInit();

    return () => {
      cancelled = true;
      reconnectRef.current = null;
      void closeDbHandle();
      releaseLockHandle();
      if (channel) channel.close();
    };
  }, []);

  const reconnect = useCallback(() => {
    reconnectRef.current?.();
  }, []);

  return (
    <DatabaseContext.Provider value={{ db, isReady, progress, error }}>
      {ejected ? <TabTakeoverScreen onReconnect={reconnect} /> : children}
    </DatabaseContext.Provider>
  );
}

function TabTakeoverScreen({ onReconnect }: { onReconnect: () => void }) {
  return (
    <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-8">
      <View className="items-center max-w-sm">
        <Text
          className="text-charcoal dark:text-neutral-100 mb-3 text-center"
          style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
        >
          Hafiz is open in another tab
        </Text>
        <Text
          className="text-warm-400 dark:text-neutral-500 text-center mb-8"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 15,
            lineHeight: 22,
          }}
        >
          Only one tab can use the database at a time. Close the other tab, or
          reconnect here to take over.
        </Text>
        <Pressable
          onPress={onReconnect}
          className="bg-primary dark:bg-primary-bright rounded-full px-8 py-3 active:opacity-80"
        >
          <Text
            className="text-white dark:text-charcoal"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
          >
            Reconnect
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
