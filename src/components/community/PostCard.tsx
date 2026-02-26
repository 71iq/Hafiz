import { memo, useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import type { Post } from "../../lib/community-types";
import { setPendingScroll } from "../../lib/deeplink";
import { relativeTime } from "../../lib/relative-time";

interface PostCardProps {
  post: Post;
  liked: boolean;
  onToggleLike: (postId: string) => void;
  onPress: (post: Post) => void;
}

export default memo(function PostCard({
  post,
  liked,
  onToggleLike,
  onPress,
}: PostCardProps) {
  const router = useRouter();

  const handleAyahPress = useCallback(() => {
    setPendingScroll(post.surah, post.ayah);
    router.push("/(tabs)/");
  }, [post.surah, post.ayah, router]);

  const handleLike = useCallback(() => {
    onToggleLike(post.id);
  }, [post.id, onToggleLike]);

  const handlePress = useCallback(() => {
    onPress(post);
  }, [post, onPress]);

  return (
    <Pressable
      onPress={handlePress}
      className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800"
    >
      {/* Ayah reference header */}
      <Pressable
        onPress={handleAyahPress}
        className="px-4 pt-3 pb-1"
      >
        <Text className="text-xs font-medium text-blue-600 dark:text-blue-400">
          Surah {post.surah} : Ayah {post.ayah}
        </Text>
      </Pressable>

      {/* Ayah text snippet */}
      <View className="px-4 pb-2">
        <Text
          className="text-base text-gray-600 dark:text-gray-400"
          style={{ writingDirection: "rtl", textAlign: "right" }}
          numberOfLines={2}
        >
          {post.ayah_text}
        </Text>
      </View>

      {/* Post content */}
      <View className="px-4 pb-3">
        <Text className="text-base text-gray-900 dark:text-gray-100">
          {post.content}
        </Text>
      </View>

      {/* Footer */}
      <View className="flex-row items-center px-4 pb-3 gap-4">
        <Pressable onPress={handleLike} className="flex-row items-center">
          <Text className="text-base mr-1">{liked ? "\u2764\uFE0F" : "\u2661"}</Text>
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            {post.like_count}
          </Text>
        </Pressable>

        <View className="flex-row items-center">
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            {post.comment_count} {post.comment_count === 1 ? "comment" : "comments"}
          </Text>
        </View>

        <View className="flex-1" />

        <Text className="text-xs text-gray-400 dark:text-gray-500">
          {post.author_name}
        </Text>
        <Text className="text-xs text-gray-400 dark:text-gray-500">
          {relativeTime(post.created_at)}
        </Text>
      </View>
    </Pressable>
  );
});
