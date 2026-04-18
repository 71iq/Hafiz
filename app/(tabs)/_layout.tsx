import { View, Text, useWindowDimensions } from "react-native";
import { Tabs } from "expo-router";
import { Sparkles, BookOpen, BarChart3, Settings, Trophy } from "lucide-react-native";
import { useDatabaseStatus } from "@/lib/database/provider";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { AppNavigation, SIDEBAR_WIDTH, SIDEBAR_BREAKPOINT } from "@/components/ui/AppNavigation";
import { useSync } from "@/lib/sync/useSync";
import { SyncIndicator } from "@/components/ui/SyncIndicator";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChromeProvider } from "@/lib/ui/chrome";

function SyncOverlay() {
  const { status } = useSync();
  const { isDark, isRTL } = useSettings();
  const insets = useSafeAreaInsets();

  if (status === "idle") return null;

  return (
    <View
      style={{
        position: "absolute",
        top: insets.top + 8,
        ...(isRTL ? { left: 16 } : { right: 16 }),
        zIndex: 100,
      }}
      pointerEvents="none"
    >
      <SyncIndicator status={status} isDark={isDark} />
    </View>
  );
}

function TabsWithStrings() {
  const { isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  const { width } = useWindowDimensions();
  const hasSidebar = width >= SIDEBAR_BREAKPOINT;

  return (
    <View style={{ flex: 1, direction: isRTL ? "rtl" : "ltr" }}>
      <SyncOverlay />
      <OfflineBanner uiLanguage={uiLanguage} />
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: hasSidebar
            ? isRTL
              ? { marginRight: SIDEBAR_WIDTH }
              : { marginLeft: SIDEBAR_WIDTH }
            : undefined,
        }}
        tabBar={(props) => <AppNavigation {...props} isRTL={isRTL} />}
      >
        <Tabs.Screen
          name="index"
          options={{ href: null }}
        />
        {/* Hidden routes */}
        <Tabs.Screen
          name="flashcards"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="search"
          options={{ href: null }}
        />
        {/* Visible tabs: Home, Mushaf, Leaderboard, Progress, Settings */}
        <Tabs.Screen
          name="home"
          options={{
            title: s.tabHome,
            tabBarIcon: ({ focused, color, size }) => (
              <Sparkles
                size={size}
                color={color}
                fill={focused ? color : "none"}
                strokeWidth={focused ? 1.5 : 2}
              />
            ),
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
          name="progress"
          options={{
            title: s.tabProgress,
            tabBarIcon: ({ focused, color, size }) => (
              <BarChart3
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
      <ChromeProvider>
        <ErrorBoundary section="TabLayout">
          <TabsWithStrings />
        </ErrorBoundary>
      </ChromeProvider>
    </SettingsProvider>
  );
}
