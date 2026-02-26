import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useRouter } from "expo-router";
import { useAuth } from "../../context/AuthContext";
import type { Post } from "../../lib/community-types";
import PostFeed from "./PostFeed";
import PostDetail from "./PostDetail";
import LeaderboardView from "./LeaderboardView";

type Tab = "feed" | "leaderboard";

export default function CommunityScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("feed");
  const [isOffline, setIsOffline] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [likedInDetail, setLikedInDetail] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!state.isConnected);
    });
    return () => unsubscribe();
  }, []);

  const handleSelectPost = useCallback((post: Post) => {
    setSelectedPost(post);
  }, []);

  const handleBackFromDetail = useCallback(() => {
    setSelectedPost(null);
    // Refresh feed to get updated counts
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  const handleToggleLikeInDetail = useCallback((postId: string) => {
    setLikedInDetail((prev) => !prev);
  }, []);

  // Auth gate
  if (!user) {
    return (
      <View className="flex-1 items-center justify-center px-6 bg-white dark:bg-gray-950">
        <Text className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Community
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-center mb-6">
          Sign in to access the community feed, ask questions about ayahs, and
          see the leaderboard.
        </Text>
        <Pressable
          onPress={() => router.push("/(tabs)/profile")}
          className="bg-blue-600 rounded-lg px-6 py-3"
        >
          <Text className="text-white font-semibold text-base">
            Go to Profile to Sign In
          </Text>
        </Pressable>
      </View>
    );
  }

  // Detail view
  if (selectedPost) {
    return (
      <View className="flex-1 bg-white dark:bg-gray-950">
        <PostDetail
          post={selectedPost}
          liked={likedInDetail}
          onToggleLike={handleToggleLikeInDetail}
          onBack={handleBackFromDetail}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-gray-950">
      {/* Offline banner */}
      {isOffline && (
        <View className="bg-amber-100 dark:bg-amber-900 px-4 py-2">
          <Text className="text-amber-800 dark:text-amber-200 text-center text-sm">
            You're offline — community features require internet
          </Text>
        </View>
      )}

      {/* Segment control */}
      <View className="flex-row mx-4 mt-3 mb-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
        <Pressable
          onPress={() => setTab("feed")}
          className={`flex-1 py-2 rounded-md items-center ${
            tab === "feed" ? "bg-white dark:bg-gray-700" : ""
          }`}
        >
          <Text
            className={`text-sm font-medium ${
              tab === "feed"
                ? "text-blue-600 dark:text-blue-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            Feed
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("leaderboard")}
          className={`flex-1 py-2 rounded-md items-center ${
            tab === "leaderboard" ? "bg-white dark:bg-gray-700" : ""
          }`}
        >
          <Text
            className={`text-sm font-medium ${
              tab === "leaderboard"
                ? "text-blue-600 dark:text-blue-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            Leaderboard
          </Text>
        </Pressable>
      </View>

      {/* Content */}
      {tab === "feed" ? (
        <PostFeed
          onSelectPost={handleSelectPost}
          refreshTrigger={refreshTrigger}
        />
      ) : (
        <LeaderboardView />
      )}
    </View>
  );
}
