import { useCallback, useEffect } from "react";
import { useNavigation } from "expo-router";
import {
  abandonPendingAuthReturn,
  adoptAuthReturn,
  clearAuthReturn,
  completeAuthReturn,
  deriveAuthReturnFromStack,
  leaveAuthWithoutSession,
} from "@/lib/auth/return-origin";
import { returnToTabs, type RootStackState } from "@/lib/navigation/return-to-tabs";

type Options = {
  /** Login and Sign up own the return; Forgot password and reset only leave through Back. */
  ownsReturn?: boolean;
};

/**
 * Shared return behavior for auth screens. On mount, an explicit capture wins; otherwise the screen
 * below this one becomes the return context. Leaving Login or Sign up through Back abandons it.
 * `complete` runs after a verified session; `back` goes back, or to the context/Home on a direct link.
 */
export function useAuthReturn({ ownsReturn = true }: Options = {}) {
  const navigation = useNavigation();

  useEffect(() => {
    if (!ownsReturn) return;
    adoptAuthReturn(
      deriveAuthReturnFromStack(navigation.getState() as Parameters<typeof deriveAuthReturnFromStack>[0]),
    );
    return navigation.addListener("beforeRemove", (event) => {
      const type = event.data?.action?.type;
      // Switching between Login and Sign up replaces the screen and keeps the target. Any other way
      // out (in-app Back, or the web browser's Back, which resets the root) abandons it, so a stale
      // target cannot steer a later sign-in. A completed sign-in has already consumed it.
      if (type !== "REPLACE") abandonPendingAuthReturn();
    });
  }, [navigation, ownsReturn]);

  const complete = useCallback(() => completeAuthReturn(navigation.getState() as RootStackState), [navigation]);

  const back = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else leaveAuthWithoutSession(navigation.getState() as RootStackState);
  }, [navigation]);

  /** Continue offline: leave auth for Home without signing in. */
  const continueOffline = useCallback(() => {
    clearAuthReturn();
    returnToTabs(navigation.getState() as RootStackState, "/(tabs)/home");
  }, [navigation]);

  return { complete, back, continueOffline };
}
