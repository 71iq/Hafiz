import { Tabs } from "expo-router";
import { Text, View } from "react-native";
import { BookOpen, Search, Layers, Trophy, Settings } from "lucide-react-native";
import { useDatabaseStatus } from "@/lib/database/provider";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SettingsProvider } from "@/lib/settings/context";
import { useColorScheme } from "nativewind";

export default function TabLayout() {
  const { isReady, progress, error } = useDatabaseStatus();
  const { colorScheme } = useColorScheme();

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-warm-50 dark:bg-neutral-950 px-6">
        <Text className="text-xl font-bold text-red-600 mb-4">
          Database Error
        </Text>
        <Text className="text-base text-red-500 text-center">{error}</Text>
      </View>
    );
  }

  if (!isReady) {
    return <LoadingScreen progress={progress} />;
  }

  const isDark = colorScheme === "dark";

  return (
    <SettingsProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: isDark ? "#2dd4bf" : "#0d9488",
          tabBarInactiveTintColor: isDark ? "#737373" : "#b9a085",
          tabBarStyle: {
            backgroundColor: isDark ? "#171717" : "#faf8f5",
            borderTopColor: isDark ? "#262626" : "#e0d5c7",
            borderTopWidth: 1,
            height: 60,
            paddingBottom: 8,
            paddingTop: 4,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "600",
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="mushaf"
          options={{
            title: "Mushaf",
            tabBarIcon: ({ color, size }) => (
              <BookOpen size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: "Search",
            tabBarIcon: ({ color, size }) => (
              <Search size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="flashcards"
          options={{
            title: "Flashcards",
            tabBarIcon: ({ color, size }) => (
              <Layers size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="leaderboard"
          options={{
            title: "Leaderboard",
            tabBarIcon: ({ color, size }) => (
              <Trophy size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
            tabBarIcon: ({ color, size }) => (
              <Settings size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </SettingsProvider>
  );
}
