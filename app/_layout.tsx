import "../global.css";
import { Slot } from "expo-router";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { View, Text, ActivityIndicator } from "react-native";
import { Suspense, useEffect, type ReactNode } from "react";
import { SettingsProvider } from "../src/context/SettingsContext";
import { AuthProvider } from "../src/context/AuthContext";
import { ensureStudyLogTable } from "../src/db/database";

function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-gray-950">
      <ActivityIndicator size="large" color="#1e40af" />
      <Text className="mt-4 text-gray-500 dark:text-gray-400">
        Loading database...
      </Text>
    </View>
  );
}

function DatabaseInit({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  useEffect(() => {
    ensureStudyLogTable(db);
  }, [db]);
  return <>{children}</>;
}

export default function RootLayout() {
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
              <View className="flex-1 bg-white dark:bg-gray-950">
                <Slot />
              </View>
            </SettingsProvider>
          </AuthProvider>
        </DatabaseInit>
      </SQLiteProvider>
    </Suspense>
  );
}
