import { useAuthStore } from "@/lib/auth/store";
import { useSettings } from "@/lib/settings/context";
import { isSupabaseConfigured } from "@/lib/supabase";

export type AccountPromoSurface = "home" | "progress";

export type AccountPromoState = {
  syncConfigured: boolean;
  authInitialized: boolean;
  authLoading: boolean;
  signedIn: boolean;
  /** The shared 14-day device dismissal (useSettings().accountPromoDismissed). */
  dismissed: boolean;
  /** Completed reviews on this device; Progress waits for the first one. */
  completedReviews: number;
};

/**
 * Whether to offer optional account sync. Only for a guest once auth has settled and sync is
 * configured; one dismissal hides Home and Progress alike. Local progress and the explicit Log in
 * entry in Settings never depend on this.
 */
export function isAccountPromoVisible(surface: AccountPromoSurface, state: AccountPromoState): boolean {
  if (!state.syncConfigured || !state.authInitialized || state.authLoading || state.signedIn || state.dismissed) {
    return false;
  }
  return surface === "home" || state.completedReviews > 0;
}

/** The promotion's visibility and its shared dismiss action for one surface. */
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
