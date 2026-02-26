import "../global.css";
import { Slot } from "expo-router";
import {
  SQLiteProvider,
  useSQLiteContext,
  openDatabaseAsync,
} from "expo-sqlite";
import { View, Text, ActivityIndicator, Platform } from "react-native";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useFonts } from "expo-font";
import { SettingsProvider } from "../src/context/SettingsContext";
import { AuthProvider } from "../src/context/AuthContext";
import { ensureStudyLogTable } from "../src/db/database";

function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator size="large" color="hsl(var(--primary))" />
      <Text className="mt-4 text-muted-foreground">
        Loading database...
      </Text>
    </View>
  );
}

function DatabaseInit({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  useEffect(() => {
    (async () => {
      await ensureStudyLogTable(db);
    })();
  }, [db]);
  return <>{children}</>;
}

const TABLE_SCHEMAS = {
  surahs: `CREATE TABLE IF NOT EXISTS surahs (
    number INTEGER PRIMARY KEY,
    name_arabic TEXT NOT NULL,
    name_english TEXT NOT NULL,
    ayah_count INTEGER NOT NULL,
    revelation_type TEXT NOT NULL
  )`,
  quran_text: `CREATE TABLE IF NOT EXISTS quran_text (
    surah INTEGER NOT NULL,
    ayah INTEGER NOT NULL,
    text_uthmani TEXT NOT NULL,
    text_clean TEXT NOT NULL,
    PRIMARY KEY (surah, ayah)
  )`,
  juz_map: `CREATE TABLE IF NOT EXISTS juz_map (
    juz INTEGER NOT NULL,
    surah INTEGER NOT NULL,
    ayah_start INTEGER NOT NULL,
    ayah_end INTEGER NOT NULL,
    PRIMARY KEY (juz, surah, ayah_start)
  )`,
  word_roots: `CREATE TABLE IF NOT EXISTS word_roots (
    surah INTEGER NOT NULL,
    ayah INTEGER NOT NULL,
    word_pos INTEGER NOT NULL,
    word_text TEXT NOT NULL,
    root TEXT NOT NULL,
    lemma TEXT NOT NULL,
    PRIMARY KEY (surah, ayah, word_pos)
  )`,
  hizb_map: `CREATE TABLE IF NOT EXISTS hizb_map (
    hizb INTEGER PRIMARY KEY,
    surah_start INTEGER NOT NULL,
    ayah_start INTEGER NOT NULL,
    surah_end INTEGER NOT NULL,
    ayah_end INTEGER NOT NULL
  )`,
} as const;

async function importJsonOnWeb(
  db: Awaited<ReturnType<typeof openDatabaseAsync>>
) {
  // Check if data already imported (verify rows exist, not just table)
  let dataExists = false;
  try {
    const check = await db.getFirstAsync<{ count: number }>(
      "SELECT count(*) as count FROM surahs"
    );
    if (check && check.count > 0) {
      dataExists = true;
    }
  } catch {
    // Table doesn't exist yet, proceed with import
  }

  // Always ensure all table schemas exist (handles migrations for new tables)
  for (const [, sql] of Object.entries(TABLE_SCHEMAS)) {
    await db.execAsync(sql);
  }
  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_word_roots_root ON word_roots(root)"
  );

  if (dataExists) {
    // Check if new tables need data (e.g. hizb_map added after initial import)
    const hizbCheck = await db.getFirstAsync<{ count: number }>(
      "SELECT count(*) as count FROM hizb_map"
    );
    if (hizbCheck && hizbCheck.count > 0) {
      console.log("[WebDB] Data already imported, skipping");
      return;
    }
    // Need to import only the missing tables
    console.log("[WebDB] Fetching JSON data for migration...");
    const response = await fetch("/quran-data.json");
    const data = await response.json();

    for (const [tableName, rows] of Object.entries(data.tables) as [string, Record<string, unknown>[]][]) {
      if (!rows || rows.length === 0) continue;
      // Check if table already has data
      const existing = await db.getFirstAsync<{ count: number }>(
        `SELECT count(*) as count FROM "${tableName}"`
      );
      if (existing && existing.count > 0) continue;

      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => "?").join(",");
      const colList = columns.map((c) => `"${c}"`).join(",");
      const insertSql = `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders})`;

      const BATCH_SIZE = 500;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        await db.execAsync("BEGIN TRANSACTION");
        try {
          for (const row of batch) {
            await db.runAsync(insertSql, columns.map((c) => row[c] as any));
          }
          await db.execAsync("COMMIT");
        } catch (e) {
          await db.execAsync("ROLLBACK");
          throw e;
        }
      }
      console.log(`[WebDB] Migrated ${rows.length} rows into ${tableName}`);
    }

    console.log("[WebDB] Migration complete!");
    return;
  }

  console.log("[WebDB] Fetching JSON data...");
  const response = await fetch("/quran-data.json");
  const data = await response.json();
  console.log("[WebDB] JSON loaded, importing tables...");

  // Tables and indexes already created above

  // Import data table by table using batch SQL
  for (const [tableName, rows] of Object.entries(data.tables) as [
    string,
    Record<string, unknown>[],
  ][]) {
    if (!rows || rows.length === 0) continue;
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => "?").join(",");
    const colList = columns.map((c) => `"${c}"`).join(",");
    const insertSql = `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders})`;

    // Batch inserts in chunks for performance
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await db.execAsync("BEGIN TRANSACTION");
      try {
        for (const row of batch) {
          await db.runAsync(
            insertSql,
            columns.map((c) => row[c] as any)
          );
        }
        await db.execAsync("COMMIT");
      } catch (e) {
        await db.execAsync("ROLLBACK");
        throw e;
      }
    }
    console.log(`[WebDB] Imported ${rows.length} rows into ${tableName}`);
  }

  console.log("[WebDB] Import complete!");
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    AmiriQuran: require("../assets/fonts/AmiriQuran-Regular.ttf"),
  });

  // On web, don't block on font loading — the font is applied via CSS @font-face
  // and will swap in when ready. On native, we must wait.
  if (!fontsLoaded && Platform.OS !== "web") return <Loading />;

  if (Platform.OS === "web") {
    return <WebLayout />;
  }

  return (
    <Suspense fallback={<Loading />}>
      <SQLiteProvider
        databaseName="quran.db"
        assetSource={{ assetId: require("../assets/quran.db") }}
        useSuspense
      >
        <DatabaseInit>
          <AuthProvider>
            <SettingsProvider>
              <View className="flex-1 bg-background">
                <Slot />
              </View>
            </SettingsProvider>
          </AuthProvider>
        </DatabaseInit>
      </SQLiteProvider>
    </Suspense>
  );
}

// Use globalThis to ensure singleton across Metro's multiple bundle scopes
const WEB_DB_KEY = "__hafiz_webDbInitPromise";

function getWebDbInitPromise(): Promise<void> | null {
  return (globalThis as any)[WEB_DB_KEY] ?? null;
}

function setWebDbInitPromise(p: Promise<void>) {
  (globalThis as any)[WEB_DB_KEY] = p;
}

function clearWebDbInitPromise() {
  (globalThis as any)[WEB_DB_KEY] = null;
}

function WebLayout() {
  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getWebDbInitPromise()) {
      const promise = (async () => {
        console.log("[WebDB] Opening database...");
        const db = await openDatabaseAsync("quran.db");
        console.log("[WebDB] Database opened");
        await importJsonOnWeb(db);
        console.log("[WebDB] Creating study_log table...");
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS study_log (
            surah            INTEGER NOT NULL,
            ayah             INTEGER NOT NULL,
            interval         REAL NOT NULL DEFAULT 0,
            repetitions      INTEGER NOT NULL DEFAULT 0,
            ease_factor      REAL NOT NULL DEFAULT 2.5,
            next_review_date TEXT NOT NULL DEFAULT '',
            last_review_date TEXT NOT NULL DEFAULT '',
            updated_at       TEXT NOT NULL DEFAULT '',
            synced           INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (surah, ayah)
          )
        `);
        console.log("[WebDB] Closing db...");
        await db.closeAsync();
        console.log("[WebDB] Ready!");
      })();
      setWebDbInitPromise(promise);
    }
    getWebDbInitPromise()!
      .then(() => setDbReady(true))
      .catch((e: any) => {
        // Clear the singleton so a refresh/remount can retry
        clearWebDbInitPromise();
        const msg =
          e?.message ||
          (typeof e === "object"
            ? JSON.stringify(e, null, 2)
            : String(e));
        console.error("Web database init error:", msg, e);
        setError(msg);
      });
  }, []);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-destructive px-4 text-center">
          Database error: {error}
        </Text>
      </View>
    );
  }
  if (!dbReady) return <Loading />;

  return (
    <Suspense fallback={<Loading />}>
      <SQLiteProvider databaseName="quran.db" useSuspense>
        <AuthProvider>
          <SettingsProvider>
            <View className="flex-1 bg-background">
              <Slot />
            </View>
          </SettingsProvider>
        </AuthProvider>
      </SQLiteProvider>
    </Suspense>
  );
}
