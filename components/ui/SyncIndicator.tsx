import { createContext, useContext } from "react";
import { BusyIndicator } from "@/components/ui/BusyIndicator";
import { View } from "react-native";
import { Cloud, CloudOff, Check, AlertCircle } from "lucide-react-native";
import type { SyncStatus } from "@/lib/database/sync";
import type { SyncFailure } from "@/lib/sync/useSync";
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
 * What the one sync runner reports. `failure` names why the last run did not finish cleanly;
 * `lastSyncedAt` is the last complete sync for this account; `syncNow` is the guarded manual run.
 */
export type SyncStatusDetails = Readonly<{
  status: SyncStatus;
  pendingCount: number;
  failure: SyncFailure | null;
  lastSyncedAt: string | null;
  syncNow: () => Promise<void>;
}>;

const IDLE_DETAILS: SyncStatusDetails = {
  status: "idle",
  pendingCount: 0,
  failure: null,
  lastSyncedAt: null,
  syncNow: async () => {},
};

/**
 * The tab layout owns the one sync runner (useSync). Navigation surfaces and Settings read its status
 * here instead of mounting another runner, which would change which view owns sync.
 */
const SyncStatusContext = createContext<SyncStatusDetails>(IDLE_DETAILS);
export const SyncStatusProvider = SyncStatusContext.Provider;
export function useSyncStatusView(): SyncStatus {
  return useContext(SyncStatusContext).status;
}
export function useSyncStatusDetails(): SyncStatusDetails {
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
