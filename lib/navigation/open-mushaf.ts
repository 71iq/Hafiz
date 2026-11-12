import { useCallback } from "react";
import { router, useNavigation } from "expo-router";
import { setPendingDeepLink, type DeepLinkTarget } from "@/lib/deep-link";

type NavigatorState = { type?: string; index?: number; routes?: { name: string }[] } | undefined;

/**
 * Moves to the Mushaf tab from the screen that owns `state` (that screen's navigator state).
 *
 * Inside the tabs this only switches tab. From a stack screen directly above the tabs, such as
 * the /profile sheet or a warm /open link, it dismisses back to them: pushing would stack another
 * full tab tree (RF196) and, on Android, leave that screen's sheet window over the reader. Any
 * other stack screen (cold start, or a session, auth or onboarding screen below) is replaced.
 */
export function navigateToMushaf(state: NavigatorState) {
  if (state?.type === "tab") {
    router.navigate("/(tabs)/mushaf");
    return;
  }
  const index = state?.index ?? 0;
  if (state?.routes?.[index - 1]?.name === "(tabs)") router.dismissTo("/(tabs)/mushaf");
  else router.replace("/(tabs)/mushaf");
}

/** Opens the Mushaf at `target` from any screen. See navigateToMushaf. */
export function useOpenMushaf() {
  const navigation = useNavigation();
  return useCallback(
    (target: DeepLinkTarget) => {
      setPendingDeepLink(target);
      navigateToMushaf(navigation.getState() as NavigatorState);
    },
    [navigation],
  );
}
