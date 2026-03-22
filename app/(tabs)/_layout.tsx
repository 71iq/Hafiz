import { View, Text } from "react-native";
import { Tabs } from "expo-router";
import { BookOpen, Search, Layers, Trophy, Settings } from "lucide-react-native";
import { useDatabaseStatus } from "@/lib/database/provider";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { CustomTabBar } from "@/components/ui/CustomTabBar";

function TabsWithStrings() {
  const { isRTL } = useSettings();
  const s = useStrings();

  return (
    <View style={{ flex: 1, direction: isRTL ? "rtl" : "ltr" }}>
      <Tabs
        screenOptions={{
          headerShown: false,
        }}
        tabBar={(props) => <CustomTabBar {...props} />}
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
            title: s.tabMushaf,
            tabBarIcon: ({ focused, color, size }) => (
              <BookOpen
                size={size}
                color={color}
                fill={focused ? color : "none"}
                strokeWidth={focused ? 1.5 : 2}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: s.tabSearch,
            tabBarIcon: ({ focused, color, size }) => (
              <Search size={size} color={color} strokeWidth={focused ? 2.5 : 2} />
            ),
          }}
        />
        <Tabs.Screen
          name="flashcards"
          options={{
            title: s.tabFlashcards,
            tabBarIcon: ({ focused, color, size }) => (
              <Layers
                size={size}
                color={color}
                fill={focused ? color : "none"}
                strokeWidth={focused ? 1.5 : 2}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="leaderboard"
          options={{
            title: s.tabLeaderboard,
            tabBarIcon: ({ focused, color, size }) => (
              <Trophy
                size={size}
                color={color}
                fill={focused ? color : "none"}
                strokeWidth={focused ? 1.5 : 2}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: s.tabSettings,
            tabBarIcon: ({ focused, color, size }) => (
              <Settings size={size} color={color} strokeWidth={focused ? 2.5 : 2} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

export default function TabLayout() {
  const { isReady, progress, error } = useDatabaseStatus();
  const s = useStrings();

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-6">
        <Text
          className="text-red-600 mb-4"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 18 }}
        >
          {s.databaseError}
        </Text>
        <Text
          className="text-red-500 text-center"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
        >
          {error}
        </Text>
      </View>
    );
  }

  if (!isReady) {
    return <LoadingScreen progress={progress} />;
  }

  return (
    <SettingsProvider>
      <TabsWithStrings />
    </SettingsProvider>
  );
}
