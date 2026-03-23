import "../global.css";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { useEffect, useState } from "react";
import { DatabaseProvider } from "@/lib/database/provider";
import { UI_FONTS } from "@/lib/fonts/ui-fonts";
import { useAuthStore } from "@/lib/auth/store";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
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
    <DatabaseProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="open" />
        <Stack.Screen name="flashcards/session" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="auth/login" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="auth/signup" options={{ animation: "slide_from_bottom" }} />
      </Stack>
    </DatabaseProvider>
  );
}
