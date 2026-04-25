import "../global.css";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { Platform } from "react-native";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DatabaseProvider } from "@/lib/database/provider";
import { UI_FONTS, loadUiFontsWeb } from "@/lib/fonts/ui-fonts";
import { useAuthStore } from "@/lib/auth/store";
import { Analytics } from "@vercel/analytics/react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // On web we never block render on fonts — FontFace with display:swap
  // lets text paint instantly in a fallback and swap when ready. Native
  // still waits for expo-font since the splash covers the interval.
  const [fontsLoaded, setFontsLoaded] = useState(Platform.OS === "web");
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    if (Platform.OS === "web") {
      loadUiFontsWeb().catch(console.error);
      SplashScreen.hideAsync().catch(() => {});
      return;
    }
    Font.loadAsync(UI_FONTS)
      .then(() => setFontsLoaded(true))
      .catch(console.error)
      .finally(() => SplashScreen.hideAsync());
  }, []);

  // Initialize auth (restore session) on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <DatabaseProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
          <Stack.Screen name="open" />
          <Stack.Screen name="flashcards/session" options={{ animation: "slide_from_bottom" }} />
          <Stack.Screen name="auth/login" options={{ animation: "slide_from_bottom" }} />
          <Stack.Screen name="auth/signup" options={{ animation: "slide_from_bottom" }} />
        </Stack>
        <Analytics />
      </DatabaseProvider>
    </QueryClientProvider>
  );
}
