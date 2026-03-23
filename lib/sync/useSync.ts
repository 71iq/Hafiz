import { useEffect, useRef, useCallback, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useDatabase } from "@/lib/database/provider";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { fullSync, type SyncStatus } from "@/lib/database/sync";
import { getPendingSyncCount } from "@/lib/database/sync-queue";

/**
 * Hook that manages automatic background sync.
 * - Syncs when app comes to foreground
 * - Syncs when network connectivity is restored
 * - Never blocks the UI — all reads come from local SQLite
 */
export function useSync() {
  const db = useDatabase();
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  const isSyncing = useRef(false);

  const doSync = useCallback(async () => {
    if (!isSupabaseConfigured() || !user || isSyncing.current) return;

    // Check connectivity
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      setStatus("offline");
      return;
    }

    isSyncing.current = true;
    setStatus("syncing");

    try {
      const result = await fullSync(db);
      setStatus("synced");

      // Update pending count
      const remaining = await getPendingSyncCount(db);
      setPendingCount(remaining);

      // Reset to idle after a brief display of "synced"
      setTimeout(() => {
        if (!isSyncing.current) setStatus("idle");
      }, 3000);
    } catch (err: any) {
      console.warn("[Sync] Error:", err.message);
      setStatus("error");
    } finally {
      isSyncing.current = false;
    }
  }, [db, user]);

  // Sync when app comes to foreground
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        doSync();
      }
    };

    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, [doSync]);

  // Sync when network connectivity is restored
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && user) {
        doSync();
      } else if (!state.isConnected) {
        setStatus("offline");
      }
    });
    return () => unsubscribe();
  }, [doSync, user]);

  // Initial sync on mount (if user is logged in)
  useEffect(() => {
    if (user) doSync();
  }, [user, doSync]);

  // Update pending count periodically
  useEffect(() => {
    if (!user) {
      setPendingCount(0);
      return;
    }
    getPendingSyncCount(db).then(setPendingCount).catch(console.warn);
  }, [db, user, status]);

  return { status, pendingCount, triggerSync: doSync };
}
