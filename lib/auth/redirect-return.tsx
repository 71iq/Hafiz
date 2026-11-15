import { useEffect } from "react";
import { Platform } from "react-native";
import { usePathname } from "expo-router";
import { useAuthStore } from "@/lib/auth/store";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import { abandonRedirectReturn, completeRedirectReturn, isAwaitingRedirectReturn } from "@/lib/auth/return-origin";

/** How long a provider return may wait for its session before landing stays on Home. */
const REDIRECT_SESSION_WAIT_MS = 10_000;

/**
 * Web provider sign-in reloads the app at its root. Once a verified session exists, this sends the
 * user to the validated return target saved before leaving. It waits for the startup redirect to
 * leave the root route, leaves /auth/callback to its own screen, and drops the target when no
 * session arrives. Restore consent and sync stay with the sync owner.
 */
export function AuthRedirectReturn() {
  const pathname = usePathname();
  const initialized = useAuthStore((state) => state.isInitialized);
  const identified = useAuthStore((state) => getAuthSessionIdentity(state.session).kind === "identified");

  useEffect(() => {
    if (Platform.OS !== "web" || !isAwaitingRedirectReturn()) return;
    if (pathname === "/onboarding") {
      abandonRedirectReturn();
      return;
    }
    if (!initialized || pathname === "/" || pathname.startsWith("/auth/")) return;
    if (identified) {
      completeRedirectReturn();
      return;
    }
    const timer = setTimeout(abandonRedirectReturn, REDIRECT_SESSION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pathname, initialized, identified]);

  return null;
}
