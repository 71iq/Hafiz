import { View, Text, Pressable } from "react-native";

export interface SessionStats {
  total: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

interface SessionSummaryProps {
  stats: SessionStats;
  onReturn: () => void;
}

export default function SessionSummary({ stats, onReturn }: SessionSummaryProps) {
  return (
    <View className="flex-1 bg-white dark:bg-gray-950 items-center justify-center px-6">
      <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Session Complete
      </Text>

      <View className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 w-full border border-gray-200 dark:border-gray-700 mb-8">
        <Text className="text-center text-3xl font-bold text-blue-600 dark:text-blue-400 mb-4">
          {stats.total}
        </Text>
        <Text className="text-center text-sm text-gray-500 dark:text-gray-400 mb-6">
          Cards Reviewed
        </Text>

        <View className="flex-row justify-around">
          <StatBadge label="Again" count={stats.again} color="text-red-600 dark:text-red-400" />
          <StatBadge label="Hard" count={stats.hard} color="text-orange-500 dark:text-orange-400" />
          <StatBadge label="Good" count={stats.good} color="text-blue-600 dark:text-blue-400" />
          <StatBadge label="Easy" count={stats.easy} color="text-green-600 dark:text-green-400" />
        </View>
      </View>

      <Pressable
        onPress={onReturn}
        className="bg-blue-600 active:bg-blue-700 py-3.5 px-8 rounded-xl"
      >
        <Text className="text-white font-semibold text-base">
          Return to Deck Selector
        </Text>
      </Pressable>
    </View>
  );
}

function StatBadge({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <View className="items-center">
      <Text className={`text-xl font-bold ${color}`}>{count}</Text>
      <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</Text>
    </View>
  );
}
