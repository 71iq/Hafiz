import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useAuth } from "../../context/AuthContext";
import { fetchLeaderboard } from "../../lib/community-api";
import type { LeaderboardEntry } from "../../lib/community-types";
import LeaderboardRow from "./LeaderboardRow";

type SortMode = "score" | "current_streak";

export default function LeaderboardView() {
  const { user } = useAuth();
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLeaderboard(sortMode);
      setEntries(data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }, [sortMode]);

  useEffect(() => {
    load();
  }, [load]);

  const renderItem = useCallback(
    ({ item, index }: { item: LeaderboardEntry; index: number }) => (
      <LeaderboardRow
        entry={item}
        rank={index + 1}
        isCurrentUser={item.id === user?.id}
        valueKey={sortMode}
      />
    ),
    [user?.id, sortMode]
  );

  const keyExtractor = useCallback((item: LeaderboardEntry) => item.id, []);

  return (
    <View className="flex-1">
      {/* Sort toggle */}
      <View className="flex-row mx-4 mt-3 mb-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
        <Pressable
          onPress={() => setSortMode("score")}
          className={`flex-1 py-2 rounded-md items-center ${
            sortMode === "score" ? "bg-white dark:bg-gray-700" : ""
          }`}
        >
          <Text
            className={`text-sm font-medium ${
              sortMode === "score"
                ? "text-blue-600 dark:text-blue-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            Cards Reviewed
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSortMode("current_streak")}
          className={`flex-1 py-2 rounded-md items-center ${
            sortMode === "current_streak" ? "bg-white dark:bg-gray-700" : ""
          }`}
        >
          <Text
            className={`text-sm font-medium ${
              sortMode === "current_streak"
                ? "text-blue-600 dark:text-blue-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            Streaks
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#1e40af" />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-red-500 text-center mb-4">{error}</Text>
          <Pressable onPress={load}>
            <Text className="text-blue-600 dark:text-blue-400 font-medium">
              Retry
            </Text>
          </Pressable>
        </View>
      ) : entries.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-gray-400 dark:text-gray-500 text-center">
            No users on the leaderboard yet. Start studying to appear here!
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerClassName="pb-4"
        />
      )}
    </View>
  );
}
