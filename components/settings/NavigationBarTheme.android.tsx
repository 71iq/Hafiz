import { useEffect } from "react";
import { useSettings } from "@/lib/settings/context";

type NavigationBarModule = typeof import("expo-navigation-bar");

let navigationBar: NavigationBarModule | null | undefined;

/** Loaded on first use so a build without the native module renders settings normally. */
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

/**
 * Dark system navigation buttons on White and Beige, light ones on Dark and AMOLED. isDark follows the
 * resolved theme, so a System theme follows live OS changes and each change reapplies only the latest.
 * The bar background, edge-to-edge and gesture navigation are left to the OS; with gesture navigation
 * there are no buttons and the call has no visible effect. A failure never blocks settings.
 */
export function NavigationBarTheme() {
  const { isDark } = useSettings();
  useEffect(() => {
    const module = loadNavigationBar();
    if (!module) return;
    try {
      // The style names the bar: a "light" bar draws dark buttons.
      module.setStyle(isDark ? "dark" : "light");
    } catch (error) {
      if (__DEV__) console.warn("[NavigationBar] Could not set the button style:", error);
    }
  }, [isDark]);
  return null;
}
