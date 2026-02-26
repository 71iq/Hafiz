import { memo } from "react";
import { View, Text } from "react-native";
import type { LeaderboardEntry } from "../../lib/community-types";

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  rank: number;
  isCurrentUser: boolean;
  valueKey: "score" | "current_streak";
}

export default memo(function LeaderboardRow({
  entry,
  rank,
  isCurrentUser,
  valueKey,
}: LeaderboardRowProps) {
  const name = entry.display_name ?? entry.username ?? "Anonymous";
  const value = valueKey === "score" ? entry.score : entry.current_streak;
  const unit = valueKey === "score" ? "cards" : "days";

  return (
    <View
      className={`flex-row items-center px-4 py-3 border-b border-gray-100 dark:border-gray-800 ${
        isCurrentUser ? "bg-blue-50 dark:bg-blue-950" : ""
      }`}
    >
      <Text className="w-10 text-center font-bold text-gray-500 dark:text-gray-400 text-base">
        {rank}
      </Text>
      <Text
        className={`flex-1 text-base ${
          isCurrentUser
            ? "font-bold text-blue-700 dark:text-blue-300"
            : "text-gray-900 dark:text-gray-100"
        }`}
        numberOfLines={1}
      >
        {name}
      </Text>
      <Text className="text-base font-semibold text-gray-700 dark:text-gray-300">
        {value}{" "}
        <Text className="text-sm font-normal text-gray-400 dark:text-gray-500">
          {unit}
        </Text>
      </Text>
    </View>
  );
});
