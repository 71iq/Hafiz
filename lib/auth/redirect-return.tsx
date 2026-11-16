import { useEffect } from "react";
import { Platform } from "react-native";
import { usePathname } from "expo-router";
import { useAuthStore } from "@/lib/auth/store";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import { abandonRedirectReturn, completeRedirectReturn, isAwaitingRedirectReturn } from "@/lib/auth/return-origin";

const REDIRECT_SESSION_WAIT_MS = 10_000;

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
