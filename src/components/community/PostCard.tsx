import { memo, useCallback } from "react";
import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import type { Post } from "../../lib/community-types";
import { setPendingScroll } from "../../lib/deeplink";
import { relativeTime } from "../../lib/relative-time";
import { Text } from "../ui/text";

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
      className="bg-card border-b border-border"
    >
      {/* Ayah reference header */}
      <Pressable onPress={handleAyahPress} className="px-4 pt-3 pb-1">
        <Text className="text-xs font-medium text-primary">
          Surah {post.surah} : Ayah {post.ayah}
        </Text>
      </Pressable>

      {/* Ayah text snippet */}
      <View className="px-4 pb-2">
        <Text
          variant="muted"
          className="text-base"
          style={{ writingDirection: "rtl", textAlign: "right" }}
          numberOfLines={2}
        >
          {post.ayah_text}
        </Text>
      </View>

      {/* Post content */}
      <View className="px-4 pb-3">
        <Text className="text-base text-foreground">{post.content}</Text>
      </View>

      {/* Footer */}
      <View className="flex-row items-center px-4 pb-3 gap-4">
        <Pressable onPress={handleLike} className="flex-row items-center">
          <Text className="text-base mr-1">{liked ? "\u2764\uFE0F" : "\u2661"}</Text>
          <Text variant="muted" className="text-sm">{post.like_count}</Text>
        </Pressable>

        <View className="flex-row items-center">
          <Text variant="muted" className="text-sm">
            {post.comment_count} {post.comment_count === 1 ? "comment" : "comments"}
          </Text>
        </View>

        <View className="flex-1" />

        <Text variant="muted" className="text-xs">{post.author_name}</Text>
        <Text variant="muted" className="text-xs">{relativeTime(post.created_at)}</Text>
      </View>
    </Pressable>
  );
});
