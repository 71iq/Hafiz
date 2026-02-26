import { memo } from "react";
import { View } from "react-native";
import type { LeaderboardEntry } from "../../lib/community-types";
import { Text } from "../ui/text";

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
      className={`flex-row items-center px-4 py-3 border-b border-border ${
        isCurrentUser ? "bg-primary/10" : ""
      }`}
    >
      <Text variant="muted" className="w-10 text-center font-bold text-base">
        {rank}
      </Text>
      <Text
        className={`flex-1 text-base ${
          isCurrentUser
            ? "font-bold text-primary"
            : "text-foreground"
        }`}
        numberOfLines={1}
      >
        {name}
      </Text>
      <Text className="text-base font-semibold text-foreground">
        {value}{" "}
        <Text variant="muted" className="text-sm font-normal">{unit}</Text>
      </Text>
    </View>
  );
});
