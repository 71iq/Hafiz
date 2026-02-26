import { Tabs } from "expo-router";
import { useSettings } from "../../src/context/SettingsContext";
import { BookOpen, Layers, Search, MessageCircle, User } from "lucide-react-native";

export default function TabLayout() {
  const { colorScheme } = useSettings();
  const isDark = colorScheme === "dark";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: isDark ? "hsl(224, 71%, 3%)" : "hsl(0, 0%, 100%)",
          borderTopColor: isDark ? "hsl(220, 20%, 18%)" : "hsl(220, 13%, 91%)",
        },
        tabBarActiveTintColor: isDark ? "hsl(217, 91%, 60%)" : "hsl(221, 83%, 53%)",
        tabBarInactiveTintColor: isDark ? "hsl(220, 9%, 55%)" : "hsl(220, 9%, 46%)",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Mushaf",
          tabBarIcon: ({ color, size }) => (
            <BookOpen color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="flashcards"
        options={{
          title: "Flashcards",
          tabBarIcon: ({ color, size }) => (
            <Layers color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, size }) => (
            <Search color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: "Community",
          tabBarIcon: ({ color, size }) => (
            <MessageCircle color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <User color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
