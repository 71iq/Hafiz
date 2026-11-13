import "../global.css";
import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import { bindAuthQueryCache } from "@/lib/query/auth-cache-lifecycle";
import { bindNativeQueryLifecycle, createAppQueryClient } from "@/lib/query/native-lifecycle";
import { PasswordRecoveryProvider } from "@/lib/auth/password-recovery";
import { Stack, usePathname } from "expo-router";
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
import { useReminderResponses, useReminderScheduling } from "@/lib/notifications/use-reminder-scheduling";

const queryClient = createAppQueryClient();

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

function StableDocumentTitle() {
  const pathname = usePathname();

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    const titles: Record<string, string> = {
      "/about": "About Hafiz | Hafiz",
      "/credits": "Credits & Sources | Hafiz",
      "/privacy": "Privacy Policy | Hafiz",
      "/profile": "Profile | Hafiz",
      "/terms": "Terms of Service | Hafiz",
      "/zayt-preview": "Zayt Preview | Hafiz",
    };

    const setTitle = () => {
      document.title = titles[pathname] ?? "Hafiz";
    };

    setTitle();
    requestAnimationFrame(setTitle);
    const timer = setTimeout(setTitle, 0);
    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}

/** Local reminders: replans on start, foreground, zone change, sync and reviews, and routes taps. */
function ReminderLifecycle() {
  useReminderScheduling();
  useReminderResponses();
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
    // A failed UI font load must not leave a blank screen: render with system fonts instead.
    Font.loadAsync(UI_FONTS)
      .catch(console.error)
      .finally(() => {
        setFontsLoaded(true);
        SplashScreen.hideAsync().catch(() => {});
      });
  }, []);

  // Initialize auth (restore session) on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <PasswordRecoveryProvider>
        <DatabaseProvider>
          {/* The only settings provider: routes share it so opening one never resets language or theme. */}
          <SettingsProvider>
            <DatabaseNoticeBoundary>
              <AudioProviderBoundary>
                <StableDocumentTitle />
                <ReminderLifecycle />
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="about" />
                  <Stack.Screen name="credits" />
                  <Stack.Screen name="privacy" />
                  <Stack.Screen name="terms" />
                  <Stack.Screen name="zayt-preview" />
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
