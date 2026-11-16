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
import { useGroupEncouragementChecks } from "@/lib/halaqa/encouragement-notifications";
import { useBoardBandRefresh } from "@/lib/board/refresh";
import { useMinorPhotoCleanup } from "@/lib/profile/use-minor-photo-cleanup";
import { ErrorBoundary as ScopedErrorBoundary, RouteErrorFallback } from "@/components/ui/ErrorBoundary";
import { useStrings } from "@/lib/i18n/useStrings";
import { strings } from "@/lib/i18n/strings";
import { documentTitleFor } from "@/lib/navigation/document-title";
import { getStartupLanguage } from "@/lib/i18n/startup-language";
import { NavigationBarTheme } from "@/components/settings/NavigationBarTheme";

const queryClient = createAppQueryClient();
const NATIVE_UI_FONT_WAIT_MS = 3000;

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  let language: "en" | "ar" = "en";
  try {
    language = getStartupLanguage();
  } catch {}
  return <RouteErrorFallback strings={strings[language]} onRetry={() => void retry()} />;
}

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

function ReminderLifecycle() {
  useReminderScheduling();
  useReminderResponses();
  return null;
}

function EncouragementChecks() {
  const { isReady } = useDatabaseStatus();
  return isReady ? <EncouragementCheckRunner /> : null;
}

function EncouragementCheckRunner() {
  useGroupEncouragementChecks();
  useBoardBandRefresh();
  return null;
}

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

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <WebUiFontPreload />
      <PasswordRecoveryProvider>
        <DatabaseProvider>
          <SettingsProvider>
            <DatabaseNoticeBoundary>
              <AudioProviderBoundary>
                {Platform.OS === "web" ? <StableDocumentTitle /> : null}
                <NavigationBarTheme />
                <ReminderLifecycle />
                <EncouragementChecks />
                <MinorPhotoCleanup />
                <AuthRedirectReturn />
                <Stack
                  screenOptions={{ headerShown: false }}
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
