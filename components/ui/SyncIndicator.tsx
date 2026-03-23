import { View, ActivityIndicator } from "react-native";
import { Cloud, CloudOff, Check, AlertCircle } from "lucide-react-native";
import type { SyncStatus } from "@/lib/database/sync";

type Props = {
  status: SyncStatus;
  isDark?: boolean;
};

/**
 * Subtle cloud icon showing sync status.
 * Placed in the header area — small and unobtrusive.
 */
export function SyncIndicator({ status, isDark }: Props) {
  if (status === "idle") return null;

  const iconColor = isDark ? "#a3a3a3" : "#b9a085";
  const successColor = isDark ? "#2dd4bf" : "#0d9488";
  const errorColor = isDark ? "#f87171" : "#ef4444";
  const size = 16;

  return (
    <View className="items-center justify-center w-8 h-8">
      {status === "syncing" && (
        <View className="relative">
          <Cloud size={size} color={iconColor} />
          <View className="absolute -bottom-0.5 -right-0.5">
            <ActivityIndicator size={8} color={successColor} />
          </View>
        </View>
      )}
      {status === "synced" && (
        <View className="relative">
          <Cloud size={size} color={successColor} />
          <View className="absolute -bottom-0.5 -right-0.5 bg-surface dark:bg-surface-dark rounded-full">
            <Check size={8} color={successColor} strokeWidth={3} />
          </View>
        </View>
      )}
      {status === "offline" && (
        <CloudOff size={size} color={iconColor} />
      )}
      {status === "error" && (
        <View className="relative">
          <Cloud size={size} color={errorColor} />
          <View className="absolute -bottom-0.5 -right-0.5 bg-surface dark:bg-surface-dark rounded-full">
            <AlertCircle size={8} color={errorColor} strokeWidth={3} />
          </View>
        </View>
      )}
    </View>
  );
}
