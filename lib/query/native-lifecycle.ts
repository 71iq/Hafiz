import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";

type NetworkState = { isConnected: boolean | null; isInternetReachable: boolean | null };

function isOnline(state: NetworkState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

export function bindNativeQueryLifecycle(): () => void {
  if (Platform.OS === "web") return () => {};
  onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(isOnline(state))));
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener("change", (state) => setFocused(state === "active"));
    return () => subscription.remove();
  });
  return () => {
    onlineManager.setEventListener(() => undefined);
    focusManager.setEventListener(() => undefined);
  };
}

export function createAppQueryClient(): QueryClient {
  const networkMode = Platform.OS === "web" ? "online" : "always";
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,
        retry: 1,
        networkMode,
      },
      mutations: {
        networkMode,
      },
    },
  });
}
