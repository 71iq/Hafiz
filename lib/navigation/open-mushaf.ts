import { useCallback } from "react";
import { router, useNavigation } from "expo-router";
import { setPendingDeepLink, type DeepLinkTarget } from "@/lib/deep-link";
import { returnToTabs, type RootStackState } from "@/lib/navigation/return-to-tabs";

type NavigatorState = (RootStackState & { type?: string }) | undefined;

export function navigateToMushaf(state: NavigatorState) {
  if (state?.type === "tab") {
    router.navigate("/(tabs)/mushaf");
    return;
  }
  returnToTabs(state, "/(tabs)/mushaf");
}

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
