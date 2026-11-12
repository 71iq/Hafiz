import { View } from "react-native";
import { Tabs } from "expo-router";
import { Sparkles, BookOpen, BarChart3, Settings, Trophy, MessageSquare, BookMarked } from "lucide-react-native";
import { useDatabaseStatus } from "@/lib/database/provider";
import { DatabaseErrorState } from "@/components/ui/DatabaseErrorState";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { AppNavigation } from "@/components/ui/AppNavigation";
import { useSync } from "@/lib/sync/useSync";
import { SyncIndicator } from "@/components/ui/SyncIndicator";
import { Toast } from "@/components/ui/Toast";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChromeProvider, useChrome } from "@/lib/ui/chrome";
import { StatusBar } from "expo-status-bar";

function SyncOverlay() {
  const { status, accountRestoreNotice, dismissAccountRestoreNotice } = useSync();
  const { isDark, isRTL } = useSettings();
  const insets = useSafeAreaInsets();
  const s = useStrings();

  if (status === "idle" && !accountRestoreNotice) return null;

  return (
    <>
      {status !== "idle" ? (
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
      ) : null}
      <Toast
        message={accountRestoreNotice ? s.syncAccountRestoredNotice : null}
        onDismiss={dismissAccountRestoreNotice}
        duration={5000}
      />
    </>
  );
}

// Home is the tab navigator's initial route so Back never lands on the hidden index redirect.
export const unstable_settings = {
  initialRouteName: "home",
};

function TabsWithStrings() {
  const { isDark, isRTL, uiLanguage, themeSurface } = useSettings();
  const { immersive } = useChrome();
  const s = useStrings();

  return (
    <View style={{ flex: 1, direction: isRTL ? "rtl" : "ltr" }}>
      <StatusBar style={isDark ? "light" : "dark"} backgroundColor={themeSurface} />
      {!immersive && <SyncOverlay />}
      {!immersive && <OfflineBanner uiLanguage={uiLanguage} />}
      <Tabs
        // Android Back from a tab returns to Home, then leaves the app. The hidden index route only
        // decides between onboarding and Home, so it must never be a Back destination.
        backBehavior="initialRoute"
        screenOptions={{
          headerShown: false,
        }}
        tabBar={(props) => <AppNavigation {...props} isRTL={isRTL} />}
      >
        {/* Home is declared first: the router takes the first screen as the initial route that
            backBehavior returns to, so the hidden index redirect must not come first (Back from Home
            showed its blank screen). */}
        <Tabs.Screen
          name="home"
          options={{
            title: s.tabHome,
            tabBarIcon: ({ color, size }) => (
              <Sparkles
                size={size}
                color={color}
                fill="none"
                strokeWidth={2}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="index"
          options={{ href: null }}
        />
        {/* Hidden routes.
            `search` stays hidden in Phase 2 because /search is currently a
            redirect placeholder. It will become a visible mobile tab once the
            real full-screen search UI ships. */}
        <Tabs.Screen
          name="flashcards"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="search"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="reflection-journey"
          options={{
            href: null,
            title: s.reflectionJourneyTitle,
            tabBarIcon: ({ color, size }) => (
              <BookMarked size={size} color={color} fill="none" strokeWidth={2} />
            ),
          }}
        />
        <Tabs.Screen
          name="reflection-feed"
          options={{
            href: null,
            title: s.reflectionFeedTitle,
            tabBarIcon: ({ color, size }) => (
              <MessageSquare size={size} color={color} fill="none" strokeWidth={2} />
            ),
          }}
        />
        {/* Visible tabs after Home: Mushaf, Leaderboard, Progress, Settings */}
        <Tabs.Screen
          name="mushaf"
          options={{
            title: s.tabMushaf,
            tabBarIcon: ({ color, size }) => (
              <BookOpen
                size={size}
                color={color}
                fill="none"
                strokeWidth={2}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="leaderboard"
          options={{
            title: s.tabLeaderboard,
            tabBarIcon: ({ color, size }) => (
              <Trophy
                size={size}
                color={color}
                fill="none"
                strokeWidth={2}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="progress"
          options={{
            title: s.tabProgress,
            tabBarIcon: ({ color, size }) => (
              <BarChart3
                size={size}
                color={color}
                fill="none"
                strokeWidth={2}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: s.tabSettings,
            tabBarIcon: ({ color, size }) => (
              <Settings size={size} color={color} strokeWidth={2} />
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
    return <DatabaseErrorState title={s.databaseError} message={error} />;
  }

  if (!isReady) {
    return <LoadingScreen progress={progress} />;
  }

  return (
    <ChromeProvider>
      <ErrorBoundary section="TabLayout">
        <TabsWithStrings />
      </ErrorBoundary>
    </ChromeProvider>
  );
}
