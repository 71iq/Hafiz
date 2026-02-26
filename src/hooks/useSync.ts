import { useState, useCallback, useEffect, useRef } from "react";
import { useSQLiteContext } from "expo-sqlite";
import NetInfo from "@react-native-community/netinfo";
import { useAuth } from "../context/AuthContext";
import { syncStudyLog } from "../lib/sync";

export function useSync() {
  const db = useSQLiteContext();
  const { user } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasSyncedOnLogin = useRef(false);

  const sync = useCallback(async () => {
    if (!user) return;

    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      setError("No internet connection");
      return;
    }

    setSyncing(true);
    setError(null);
    try {
      await syncStudyLog(db, user.id);
      setLastSync(new Date());
    } catch (e: any) {
      setError(e.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [db, user]);

  // Auto-sync once on login
  useEffect(() => {
    if (user && !hasSyncedOnLogin.current) {
      hasSyncedOnLogin.current = true;
      sync();
    }
    if (!user) {
      hasSyncedOnLogin.current = false;
      setLastSync(null);
      setError(null);
    }
  }, [user, sync]);

  return { sync, syncing, lastSync, error };
}
