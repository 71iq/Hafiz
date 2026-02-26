import { memo } from "react";
import { View } from "react-native";
import type { Comment } from "../../lib/community-types";
import { relativeTime } from "../../lib/relative-time";
import { Text } from "../ui/text";

interface CommentItemProps {
  comment: Comment;
}

export default memo(function CommentItem({ comment }: CommentItemProps) {
  return (
    <View className="px-4 py-3 border-b border-border">
      <View className="flex-row items-center mb-1">
        <Text className="text-sm font-medium text-foreground">
          {comment.author_name}
        </Text>
        <Text variant="muted" className="text-xs ml-2">
          {relativeTime(comment.created_at)}
        </Text>
      </View>
      <Text className="text-base text-foreground">{comment.content}</Text>
    </View>
  );
});
