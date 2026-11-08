import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";

type NetworkState = { isConnected: boolean | null; isInternetReachable: boolean | null };

/** Unknown reachability (null at startup) counts as online, so nothing waits on a first probe. */
function isOnline(state: NetworkState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

/**
 * React Native has no browser online or visibility events, so Query never learned that the device
 * went offline or came back to the foreground. On native, follow NetInfo and AppState. The web keeps
 * TanStack Query's own browser listeners. Returns a cleanup that removes both native listeners.
 */
export function bindNativeQueryLifecycle(): () => void {
  if (Platform.OS === "web") return () => {};
  onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(isOnline(state))));
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener("change", (state) => setFocused(state === "active"));
    return () => subscription.remove();
  });
  return () => {
    // Replacing a listener runs the previous cleanup, which unsubscribes NetInfo and AppState.
    onlineManager.setEventListener(() => undefined);
    focusManager.setEventListener(() => undefined);
  };
}

/**
 * The app's single Query client. Now that native knows when it is offline, the default network mode
 * would pause work there: queries that read only local SQLite would stop loading offline, remote
 * queries would sit paused without an error, and writes would replay on reconnect. Native keeps the
 * previous behavior, running everything and failing offline as before, while still refetching on
 * reconnect and foreground. The web keeps the default mode it already had.
 */
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
