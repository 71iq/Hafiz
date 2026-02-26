import { useState, useEffect, useCallback } from "react";
import { View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useRouter } from "expo-router";
import { useAuth } from "../../context/AuthContext";
import type { Post } from "../../lib/community-types";
import PostFeed from "./PostFeed";
import PostDetail from "./PostDetail";
import LeaderboardView from "./LeaderboardView";
import { Button } from "../ui/button";
import { Text } from "../ui/text";
import { TabsList, TabsTrigger } from "../ui/tabs";

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
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  const handleToggleLikeInDetail = useCallback((postId: string) => {
    setLikedInDetail((prev) => !prev);
  }, []);

  // Auth gate
  if (!user) {
    return (
      <View className="flex-1 items-center justify-center px-6 bg-background">
        <Text className="text-xl font-bold text-foreground mb-2">Community</Text>
        <Text variant="muted" className="text-center mb-6">
          Sign in to access the community feed, ask questions about ayahs, and
          see the leaderboard.
        </Text>
        <Button onPress={() => router.push("/(tabs)/profile")}>
          Go to Profile to Sign In
        </Button>
      </View>
    );
  }

  // Detail view
  if (selectedPost) {
    return (
      <View className="flex-1 bg-background">
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
    <View className="flex-1 bg-background">
      {/* Offline banner */}
      {isOffline && (
        <View className="bg-warning/10 px-4 py-2">
          <Text className="text-warning text-center text-sm">
            You're offline — community features require internet
          </Text>
        </View>
      )}

      {/* Segment control */}
      <View className="mx-4 mt-3 mb-2">
        <TabsList>
          <TabsTrigger active={tab === "feed"} onPress={() => setTab("feed")}>
            Feed
          </TabsTrigger>
          <TabsTrigger active={tab === "leaderboard"} onPress={() => setTab("leaderboard")}>
            Leaderboard
          </TabsTrigger>
        </TabsList>
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
