import "../global.css";
import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import { bindAuthQueryCache } from "@/lib/query/auth-cache-lifecycle";
import { bindNativeQueryLifecycle, createAppQueryClient } from "@/lib/query/native-lifecycle";
import { PasswordRecoveryProvider } from "@/lib/auth/password-recovery";
import { AuthRedirectReturn } from "@/lib/auth/redirect-return";
import { Stack, usePathname, type ErrorBoundaryProps } from "expo-router";
import Head from "expo-router/head";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { Platform } from "react-native";
import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { PortalHost } from "@rn-primitives/portal";
import { DatabaseProvider, useDatabaseStatus } from "@/lib/database/provider";
import { UI_FONTS, loadUiFontsWeb } from "@/lib/fonts/ui-fonts";
import { useAuthStore } from "@/lib/auth/store";
import { AyahAudioProvider } from "@/lib/audio/ayah-audio";
import { SettingsProvider } from "@/lib/settings/context";
import { loadUiBootstrap } from "@/lib/settings/ui-bootstrap";
import { useReminderResponses, useReminderScheduling } from "@/lib/notifications/use-reminder-scheduling";
import { useWidgetPublishing } from "@/lib/widget/use-widget-publishing";
import { useWidgetTaps } from "@/lib/widget/tap";
import { useBoardBandRefresh } from "@/lib/board/refresh";
import { useMinorPhotoCleanup } from "@/lib/profile/use-minor-photo-cleanup";
import { ErrorBoundary as ScopedErrorBoundary, RouteErrorFallback } from "@/components/ui/ErrorBoundary";
import { useStrings } from "@/lib/i18n/useStrings";
import { strings } from "@/lib/i18n/strings";
import { documentTitleFor } from "@/lib/navigation/document-title";
import { getStartupLanguage } from "@/lib/i18n/startup-language";
import { NavigationBarTheme } from "@/components/settings/NavigationBarTheme";
import { AppUpdateHost } from "@/components/app-update/AppUpdateHost";

const queryClient = createAppQueryClient();
const NATIVE_UI_FONT_WAIT_MS = 3000;

/**
 * The Hafiz fallback for a crash above the route providers (instead of the Expo Router default). It
 * reads the startup language because the settings provider may be the part that failed.
 */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  let language: "en" | "ar" = "en";
  try {
    language = getStartupLanguage();
  } catch {}
  return <RouteErrorFallback strings={strings[language]} onRetry={() => void retry()} />;
}

/**
 * Web preloads the three UI faces used on first paint. The URLs are the hashed files the export
 * already emits for these modules, so nothing is downloaded or replaced.
 */
const PRELOADED_UI_FONT_URLS = [
  UI_FONTS.Manrope_400Regular,
  UI_FONTS.Manrope_700Bold,
  UI_FONTS.NotoSerif_700Bold,
].filter((source): source is string => typeof source === "string");

function WebUiFontPreload() {
  if (Platform.OS !== "web" || PRELOADED_UI_FONT_URLS.length === 0) return null;
  return (
    <Head>
      {PRELOADED_UI_FONT_URLS.map((href) => (
        <link key={href} rel="preload" href={href} as="font" type="font/ttf" crossOrigin="anonymous" />
      ))}
    </Head>
  );
}

SplashScreen.preventAutoHideAsync();

// Native: read the small language/theme startup mirror while UI fonts load, so the first frames use
// the saved choice. A failed read resolves to null and never blocks data preparation.
const uiBootstrapReady = Platform.OS === "web" ? Promise.resolve(null) : loadUiBootstrap();

function StableDocumentTitle() {
  const pathname = usePathname();
  const s = useStrings();

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    const title = documentTitleFor(pathname, s);
    const setTitle = () => {
      document.title = title;
    };

    setTitle();
    requestAnimationFrame(setTitle);
    const timer = setTimeout(setTitle, 0);
    return () => clearTimeout(timer);
  }, [pathname, s]);

  return null;
}

/** Local reminders: replans on start, foreground, zone change, sync and reviews, and routes taps. */
function ReminderLifecycle() {
  useReminderScheduling();
  useReminderResponses();
  return null;
}

/** Android home-screen widget: publishes the timeline and routes widget taps. Web and iOS do nothing. */
function WidgetLifecycle() {
  useWidgetPublishing();
  useWidgetTaps();
  return null;
}

/** The board bands stay current for the weekly placement pass, which uses the last ones reported. */
function BoardBandRefresh() {
  const { isReady } = useDatabaseStatus();
  return isReady ? <BoardBandRefreshRunner /> : null;
}

function BoardBandRefreshRunner() {
  useBoardBandRefresh();
  return null;
}

/** ETH-07: a minor account's leftover photo files are removed once per app session. */
function MinorPhotoCleanup() {
  useMinorPhotoCleanup();
  return null;
}

function DatabaseNoticeBoundary({ children }: { children: React.ReactNode }) {
  const { db, isReady } = useDatabaseStatus();
  return <OperationNoticeProvider ready={Boolean(db && isReady)}>{children}</OperationNoticeProvider>;
}

function AudioProviderBoundary({ children }: { children: React.ReactNode }) {
  const { db } = useDatabaseStatus();
  if (!db) return <>{children}</>;
  return <AyahAudioProvider>{children}</AyahAudioProvider>;
}

export default function RootLayout() {
  // On web we never block render on fonts — FontFace with display:swap
  // lets text paint instantly in a fallback and swap when ready. Native
  // still waits for expo-font since the splash covers the interval.
  const [fontsLoaded, setFontsLoaded] = useState(Platform.OS === "web");
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => bindAuthQueryCache(queryClient), []);
  useEffect(() => bindNativeQueryLifecycle(), []);

  useEffect(() => {
    if (Platform.OS === "web") {
      loadUiFontsWeb().catch(console.error);
      SplashScreen.hideAsync().catch(() => {});
      return;
    }
    // A failed UI font load must not leave a blank screen: render with system fonts instead. Stop
    // waiting after three seconds and let the UI fonts swap in when they arrive.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      setFontsLoaded(true);
      SplashScreen.hideAsync().catch(() => {});
    };
    const fontsReady = Font.loadAsync(UI_FONTS).catch(console.error);
    const cap = setTimeout(release, NATIVE_UI_FONT_WAIT_MS);
    Promise.all([fontsReady, uiBootstrapReady]).finally(release);
    return () => clearTimeout(cap);
  }, []);

  // Initialize auth (restore session) on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <WebUiFontPreload />
      <PasswordRecoveryProvider>
        <DatabaseProvider>
          {/* The only settings provider: routes share it so opening one never resets language or theme. */}
          <SettingsProvider>
            <DatabaseNoticeBoundary>
              <AudioProviderBoundary>
                {Platform.OS === "web" ? <StableDocumentTitle /> : null}
                {/* Android system button contrast follows the resolved theme; web and iOS render nothing. */}
                <NavigationBarTheme />
                <ReminderLifecycle />
                <WidgetLifecycle />
                <BoardBandRefresh />
                <MinorPhotoCleanup />
                <AuthRedirectReturn />
                <AppUpdateHost />
                <Stack
                  screenOptions={{ headerShown: false }}
                  // Routes outside the tabs get the Hafiz fallback inside the providers; the tabs
                  // have their own per-tab boundaries.
                  screenLayout={({ children, route }) => (
                    <ScopedErrorBoundary section={`route:${route.name}`}>{children}</ScopedErrorBoundary>
                  )}
                >
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="about" />
                  <Stack.Screen name="credits" />
                  <Stack.Screen name="privacy" />
                  <Stack.Screen name="terms" />
                  <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
                  <Stack.Screen name="open" />
                  <Stack.Screen name="flashcards/session" options={{ animation: "slide_from_bottom" }} />
                  <Stack.Screen name="hifz/review" options={{ animation: "slide_from_bottom" }} />
                  <Stack.Screen name="hifz/sabaq" options={{ animation: "slide_from_bottom" }} />
                  <Stack.Screen name="hifz/setup" options={{ animation: "slide_from_bottom" }} />
                  <Stack.Screen name="auth/login" options={{ animation: "slide_from_bottom" }} />
                  <Stack.Screen name="auth/signup" options={{ animation: "slide_from_bottom" }} />
                  <Stack.Screen name="auth/forgot-password" options={{ animation: "slide_from_bottom" }} />
                  <Stack.Screen name="auth/reset-password" options={{ animation: "slide_from_bottom" }} />
                  <Stack.Screen
                    name="profile/index"
                    options={{ animation: "fade", presentation: "transparentModal" }}
                  />
                  <Stack.Screen
                    name="profile/[userId]"
                    options={{ animation: "fade", presentation: "transparentModal" }}
                  />
                </Stack>
                <PortalHost />
              </AudioProviderBoundary>
            </DatabaseNoticeBoundary>
          </SettingsProvider>
        </DatabaseProvider>
      </PasswordRecoveryProvider>
    </QueryClientProvider>
  );
}
