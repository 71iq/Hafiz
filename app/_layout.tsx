import "../global.css";
import { Slot } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { View, Text, ActivityIndicator } from "react-native";
import { Suspense } from "react";

function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <ActivityIndicator size="large" color="#1e40af" />
      <Text className="mt-4 text-gray-500">Loading database...</Text>
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
        <Slot />
      </SQLiteProvider>
    </Suspense>
  );
}
