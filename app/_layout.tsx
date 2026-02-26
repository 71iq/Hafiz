import "../global.css";
import { Slot } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { View, Text, ActivityIndicator } from "react-native";
import { Suspense } from "react";
import { SettingsProvider } from "../src/context/SettingsContext";

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

export default function RootLayout() {
  return (
    <Suspense fallback={<Loading />}>
      <SQLiteProvider
        databaseName="quran.db"
        assetSource={{ assetId: require("../assets/quran.db") }}
        useSuspense
      >
        <SettingsProvider>
          <View className="flex-1 bg-white dark:bg-gray-950">
            <Slot />
          </View>
        </SettingsProvider>
      </SQLiteProvider>
    </Suspense>
  );
}
