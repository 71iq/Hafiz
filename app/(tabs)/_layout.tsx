import { useEffect, type ReactNode } from "react";
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

/**
 * The one sync runner for the tabs. Its status reaches the profile card and account row through
 * context; there is no floating indicator over screens. A paused restore (W07) keeps one persistent
 * Resume sync affordance, and the restore consent confirmation lives beside the results it answers.
 */
function SyncOwner({ children }: { children: ReactNode }) {
  const { immersive } = useChrome();
  const { status } = useSync();
  const { isRTL } = useSettings();
  const insets = useSafeAreaInsets();

  return (
    <SyncStatusProvider value={status}>
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

/** Ctrl/Cmd+K and `/` open the existing Search outside text editing and open overlays (web). */
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

// Home is the tab navigator's initial route so Back never lands on the hidden index redirect.
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
        // Android Back from a tab returns to Home, then leaves the app. The hidden index route only
        // decides between onboarding and Home, so it must never be a Back destination.
        backBehavior="initialRoute"
        screenOptions={{
          headerShown: false,
        }}
        tabBar={(props) => <AppNavigation {...props} isRTL={isRTL} />}
        // Each tab has its own boundary, so a crash keeps the tab bar and sidebar usable.
        screenLayout={({ children, route }) => (
          <ErrorBoundary section={`tab:${route.name}`}>{children}</ErrorBoundary>
        )}
      >
        {/* Home is declared first: the router takes the first screen as the initial route that
            backBehavior returns to, so the hidden index redirect must not come first (Back from Home
            showed its blank screen). */}
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
        {/* Phones show Home, Mushaf, Progress and Settings (AppNavigation PHONE_TAB_ROUTES); Halaqa and
            Board are reached from labeled rows on Home and Progress. From 768px the panel and sidebar
            list all six destinations. The Board keeps the leaderboard route. */}
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
