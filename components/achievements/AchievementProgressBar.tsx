import { View } from "react-native";
import { useSettings } from "@/lib/settings/context";

type Props = {
  current: number;
  target: number;
};

export function AchievementProgressBar({ current, target }: Props) {
  const { isRTL, themeColors } = useSettings();
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <View
      className="mt-3 h-1.5 overflow-hidden rounded-full"
      style={{
        alignItems: isRTL ? "flex-end" : "flex-start",
        backgroundColor: themeColors.surfaceHigh,
      }}
    >
      <View
        className="h-full rounded-full bg-primary-accent dark:bg-primary-bright"
        style={{ width: `${pct}%` }}
      />
    </View>
  );
}
