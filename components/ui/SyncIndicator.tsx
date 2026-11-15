import { createContext, useContext } from "react";
import { BusyIndicator } from "@/components/ui/BusyIndicator";
import { View } from "react-native";
import { Cloud, CloudOff, Check, AlertCircle } from "lucide-react-native";
import type { SyncStatus } from "@/lib/database/sync";
import { useStrings } from "@/lib/i18n/useStrings";
import type { UIStringKey } from "@/lib/i18n/strings";

type Props = {
  status: SyncStatus;
  isDark?: boolean;
  /** Hides the success state; a finished sync is reported as "Last synced" in account settings. */
  hideSuccess?: boolean;
  /** Icon colors on the dark persistent sidebar. */
  onPrimary?: boolean;
};

export const SYNC_STATUS_LABEL_KEYS: Record<Exclude<SyncStatus, "idle">, UIStringKey> = {
  syncing: "syncStateSyncing",
  synced: "syncStateSynced",
  offline: "syncStateOffline",
  error: "syncStateError",
};

/**
 * The tab layout owns the one sync runner (useSync). Navigation surfaces read its status here
 * instead of mounting another runner, which would change which view owns sync.
 */
const SyncStatusContext = createContext<SyncStatus>("idle");
export const SyncStatusProvider = SyncStatusContext.Provider;
export function useSyncStatusView(): SyncStatus {
  return useContext(SyncStatusContext);
}

/**
 * Small cloud icon showing sync status, labelled for screen readers. It sits on the profile card and
 * account row instead of floating over screens.
 */
export function SyncIndicator({ status, isDark, hideSuccess = false, onPrimary = false }: Props) {
  const s = useStrings();
  if (status === "idle" || (hideSuccess && status === "synced")) return null;

  const iconColor = onPrimary ? "#FDDC91" : isDark ? "#a3a3a3" : "#6e5a47";
  const successColor = onPrimary || isDark ? "#2dd4bf" : "#0d9488";
  const errorColor = onPrimary || isDark ? "#f87171" : "#dc2626";
  const size = 16;
  const badgeBackground = onPrimary ? "bg-primary" : "bg-surface dark:bg-surface-dark";

  return (
    <View
      className="items-center justify-center w-8 h-8"
      accessible
      accessibilityRole="image"
      accessibilityLabel={s[SYNC_STATUS_LABEL_KEYS[status]]}
    >
      {status === "syncing" && (
        <View className="relative">
          <Cloud size={size} color={iconColor} />
          <View className="absolute -bottom-0.5 -right-0.5">
            <BusyIndicator size={8} color={successColor} />
          </View>
        </View>
      )}
      {status === "synced" && (
        <View className="relative">
          <Cloud size={size} color={successColor} />
          <View className={`absolute -bottom-0.5 -right-0.5 rounded-full ${badgeBackground}`}>
            <Check size={8} color={successColor} strokeWidth={3} />
          </View>
        </View>
      )}
      {status === "offline" && <CloudOff size={size} color={iconColor} />}
      {status === "error" && (
        <View className="relative">
          <Cloud size={size} color={errorColor} />
          <View className={`absolute -bottom-0.5 -right-0.5 rounded-full ${badgeBackground}`}>
            <AlertCircle size={8} color={errorColor} strokeWidth={3} />
          </View>
        </View>
      )}
    </View>
  );
}
