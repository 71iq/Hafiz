import { View } from "react-native";

type Props = {
  current: number;
  target: number;
  isDark?: boolean;
};

export function AchievementProgressBar({ current, target, isDark }: Props) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <View
      className="mt-3 h-1.5 overflow-hidden rounded-full"
      style={{ backgroundColor: isDark ? "#262626" : "#E8DED4" }}
    >
      <View
        className="h-full rounded-full bg-primary-accent dark:bg-primary-bright"
        style={{ width: `${pct}%` }}
      />
    </View>
  );
}
