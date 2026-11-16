import { useEffect, useMemo, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { Tabs } from "expo-router";
import { House, BookOpen, BarChart3, Settings, Trophy, MessageSquare, BookMarked, Users } from "lucide-react-native";
import { useDatabaseStatus } from "@/lib/database/provider";
import { DatabaseErrorState } from "@/components/ui/DatabaseErrorState";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { AppNavigation } from "@/components/ui/AppNavigation";
import { useSync } from "@/lib/sync/useSync";
import { SyncStatusProvider } from "@/components/ui/SyncIndicator";
import { RestoreConsentDialog, SyncPausedStatus } from "@/components/sync/RestoreConsent";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ChromeProvider, useChrome } from "@/lib/ui/chrome";
import { StatusBar } from "expo-status-bar";
import { isSearchShortcut, openSearch } from "@/lib/navigation/search-launcher";

function SyncOwner({ children }: { children: ReactNode }) {
  const { immersive } = useChrome();
  const { status, pendingCount, failure, lastSyncedAt, syncNow } = useSync();
  const details = useMemo(
    () => ({ status, pendingCount, failure, lastSyncedAt, syncNow }),
    [status, pendingCount, failure, lastSyncedAt, syncNow],
  );
  const { isRTL } = useSettings();
  const insets = useSafeAreaInsets();

  return (
    <SyncStatusProvider value={details}>
      {children}
      {!immersive ? (
        <View
          style={{
            position: "absolute",
            top: insets.top + 8,
            ...(isRTL ? { left: 16 } : { right: 16 }),
            zIndex: 100,
          }}
          pointerEvents="box-none"
        >
          <SyncPausedStatus />
        </View>
      ) : null}
      <RestoreConsentDialog />
    </SyncStatusProvider>
  );
}

function useSearchShortcut() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      openSearch();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

export const unstable_settings = {
  initialRouteName: "home",
};

function TabsWithStrings() {
  const { isDark, isRTL, uiLanguage, themeSurface } = useSettings();
  const { immersive } = useChrome();
  const s = useStrings();
  useSearchShortcut();

  return (
    <View style={{ flex: 1, direction: isRTL ? "rtl" : "ltr" }}>
      <StatusBar style={isDark ? "light" : "dark"} backgroundColor={themeSurface} />
      {!immersive && <OfflineBanner uiLanguage={uiLanguage} />}
      <Tabs
        backBehavior="initialRoute"
        screenOptions={{
          headerShown: false,
        }}
        tabBar={(props) => <AppNavigation {...props} isRTL={isRTL} />}
        screenLayout={({ children, route }) => (
          <ErrorBoundary section={`tab:${route.name}`}>{children}</ErrorBoundary>
        )}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: s.tabHome,
            tabBarIcon: ({ color, size }) => (
              <House
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
          name="halaqa"
          options={{
            title: s.tabHalaqa,
            tabBarIcon: ({ color, size }) => (
              <Users
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
            title: s.tabBoard,
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
        <SyncOwner>
          <TabsWithStrings />
        </SyncOwner>
      </ErrorBoundary>
    </ChromeProvider>
  );
}
