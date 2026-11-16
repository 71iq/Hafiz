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
  ownsReturn?: boolean;
};

export function useAuthReturn({ ownsReturn = true }: Options = {}) {
  const navigation = useNavigation();

  useEffect(() => {
    if (!ownsReturn) return;
    adoptAuthReturn(
      deriveAuthReturnFromStack(navigation.getState() as Parameters<typeof deriveAuthReturnFromStack>[0]),
    );
    return navigation.addListener("beforeRemove", (event) => {
      const type = event.data?.action?.type;
      if (type !== "REPLACE") abandonPendingAuthReturn();
    });
  }, [navigation, ownsReturn]);

  const complete = useCallback(() => completeAuthReturn(navigation.getState() as RootStackState), [navigation]);

  const back = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else leaveAuthWithoutSession(navigation.getState() as RootStackState);
  }, [navigation]);

  const continueOffline = useCallback(() => {
    clearAuthReturn();
    returnToTabs(navigation.getState() as RootStackState, "/(tabs)/home");
  }, [navigation]);

  return { complete, back, continueOffline };
}
