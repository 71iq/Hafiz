import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useAuth } from "../../context/AuthContext";
import { fetchPosts, toggleLike, checkUserLikes } from "../../lib/community-api";
import type { Post } from "../../lib/community-types";
import PostCard from "./PostCard";
import { Text } from "../ui/text";

interface PostFeedProps {
  onSelectPost: (post: Post) => void;
  refreshTrigger: number;
}

export default function PostFeed({ onSelectPost, refreshTrigger }: PostFeedProps) {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const hasMore = useRef(true);

  const loadPosts = useCallback(
    async (reset: boolean) => {
      if (!reset && !hasMore.current) return;

      try {
        const { posts: newPosts, nextCursor } = await fetchPosts(
          reset ? undefined : cursor ?? undefined
        );

        const allPosts = reset ? newPosts : [...posts, ...newPosts];
        setPosts(allPosts);
        setCursor(nextCursor);
        hasMore.current = nextCursor !== null;

        if (user && newPosts.length > 0) {
          const ids = newPosts.map((p) => p.id);
          const liked = await checkUserLikes(ids, user.id);
          setLikedIds((prev) => {
            const next = reset ? liked : new Set([...prev, ...liked]);
            return next;
          });
        }
      } catch (_e) {
        // Silently fail
      }
    },
    [cursor, posts, user]
  );

  useEffect(() => {
    setLoading(true);
    loadPosts(true).finally(() => setLoading(false));
  }, [refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPosts(true);
    setRefreshing(false);
  }, [loadPosts]);

  const handleEndReached = useCallback(async () => {
    if (loadingMore || !hasMore.current) return;
    setLoadingMore(true);
    await loadPosts(false);
    setLoadingMore(false);
  }, [loadPosts, loadingMore]);

  const handleToggleLike = useCallback(
    async (postId: string) => {
      if (!user) return;

      const wasLiked = likedIds.has(postId);
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.delete(postId);
        else next.add(postId);
        return next;
      });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, like_count: p.like_count + (wasLiked ? -1 : 1) }
            : p
        )
      );

      try {
        await toggleLike(postId, user.id);
      } catch (_e) {
        setLikedIds((prev) => {
          const next = new Set(prev);
          if (wasLiked) next.add(postId);
          else next.delete(postId);
          return next;
        });
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? { ...p, like_count: p.like_count + (wasLiked ? 1 : -1) }
              : p
          )
        );
      }
    },
    [user, likedIds]
  );

  const renderItem = useCallback(
    ({ item }: { item: Post }) => (
      <PostCard
        post={item}
        liked={likedIds.has(item.id)}
        onToggleLike={handleToggleLike}
        onPress={onSelectPost}
      />
    ),
    [likedIds, handleToggleLike, onSelectPost]
  );

  const keyExtractor = useCallback((item: Post) => item.id, []);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="hsl(var(--primary))" />
      </View>
    );
  }

  if (posts.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text variant="muted" className="text-center text-base">
          No posts yet. Be the first to ask the community!
        </Text>
        <Text variant="muted" className="text-center text-sm mt-2">
          Long-press any ayah in the Mushaf to get started.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={posts}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
      ListFooterComponent={
        loadingMore ? (
          <View className="py-4">
            <ActivityIndicator color="hsl(var(--primary))" />
          </View>
        ) : null
      }
      contentContainerClassName="pb-4"
    />
  );
}
