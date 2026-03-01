import React, { createContext, useContext, useEffect, useState } from "react";
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

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const database = await openDatabaseAsync("hafiz.db");
        if (!mounted) return;
        setDb(database);

        await initializeDatabase(database, (p) => {
          if (mounted) setProgress(p);
        });

        if (mounted) setIsReady(true);
      } catch (err) {
        console.error("[Database] Init error:", err);
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <DatabaseContext.Provider value={{ db, isReady, progress, error }}>
      {children}
    </DatabaseContext.Provider>
  );
}
