import { useState, useEffect, useCallback } from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { fetchLeaderboard } from "../../lib/community-api";
import type { LeaderboardEntry } from "../../lib/community-types";
import LeaderboardRow from "./LeaderboardRow";
import { Button } from "../ui/button";
import { Text } from "../ui/text";
import { TabsList, TabsTrigger } from "../ui/tabs";

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
      <View className="mx-4 mt-3 mb-2">
        <TabsList>
          <TabsTrigger
            active={sortMode === "score"}
            onPress={() => setSortMode("score")}
          >
            Cards Reviewed
          </TabsTrigger>
          <TabsTrigger
            active={sortMode === "current_streak"}
            onPress={() => setSortMode("current_streak")}
          >
            Streaks
          </TabsTrigger>
        </TabsList>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="hsl(var(--primary))" />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="destructive" className="text-center mb-4">{error}</Text>
          <Button variant="link" onPress={load}>Retry</Button>
        </View>
      ) : entries.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="muted" className="text-center">
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
