import { useEffect } from "react";
import { useSettings } from "@/lib/settings/context";

type NavigationBarModule = typeof import("expo-navigation-bar");

let navigationBar: NavigationBarModule | null | undefined;

function loadNavigationBar(): NavigationBarModule | null {
  if (navigationBar === undefined) {
    try {
      navigationBar = require("expo-navigation-bar") as NavigationBarModule;
    } catch {
      navigationBar = null;
    }
  }
  return navigationBar;
}

export function NavigationBarTheme() {
  const { isDark } = useSettings();
  useEffect(() => {
    const module = loadNavigationBar();
    if (!module) return;
    try {
      module.setStyle(isDark ? "dark" : "light");
    } catch (error) {
      if (__DEV__) console.warn("[NavigationBar] Could not set the button style:", error);
    }
  }, [isDark]);
  return null;
}
