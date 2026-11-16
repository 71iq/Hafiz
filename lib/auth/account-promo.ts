import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { isSupabaseConfigured } from "@/lib/supabase";

export type AccountPromoSurface = "home" | "progress";

export type AccountPromoState = {
  syncConfigured: boolean;
  authInitialized: boolean;
  authLoading: boolean;
  signedIn: boolean;
  dismissed: boolean;
  completedReviews: number;
};

export function isAccountPromoVisible(surface: AccountPromoSurface, state: AccountPromoState): boolean {
  if (!state.syncConfigured || !state.authInitialized || state.authLoading || state.signedIn || state.dismissed) {
    return false;
  }
  return surface === "home" || state.completedReviews > 0;
}

export function useAccountPromo(surface: AccountPromoSurface, completedReviews = 0) {
  const signedIn = useAuthStore((state) => !!state.user);
  const authLoading = useAuthStore((state) => state.isLoading);
  const authInitialized = useAuthStore((state) => state.isInitialized);
  const { accountPromoDismissed, dismissAccountPromo } = useSettings();
  const visible = isAccountPromoVisible(surface, {
    syncConfigured: isSupabaseConfigured(),
    authInitialized,
    authLoading,
    signedIn,
    dismissed: accountPromoDismissed,
    completedReviews,
  });
  return { visible, dismiss: dismissAccountPromo };
}
