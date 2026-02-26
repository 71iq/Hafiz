import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useSettings } from "../../src/context/SettingsContext";

export default function TabLayout() {
  const { colorScheme } = useSettings();
  const isDark = colorScheme === "dark";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: isDark ? "#030712" : "#ffffff",
          borderTopColor: isDark ? "#1f2937" : "#e5e7eb",
        },
        tabBarActiveTintColor: isDark ? "#60a5fa" : "#1e40af",
        tabBarInactiveTintColor: isDark ? "#6b7280" : "#9ca3af",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Mushaf",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 20 }}>{"📖"}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="flashcards"
        options={{
          title: "Flashcards",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 20 }}>{"🃏"}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 20 }}>{"🔍"}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: "Community",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 20 }}>{"\uD83D\uDCAC"}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 20 }}>{"👤"}</Text>
          ),
        }}
      />
    </Tabs>
  );
}
