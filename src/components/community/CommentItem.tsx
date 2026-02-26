import { memo } from "react";
import { View, Text } from "react-native";
import type { Comment } from "../../lib/community-types";
import { relativeTime } from "../../lib/relative-time";

interface CommentItemProps {
  comment: Comment;
}

export default memo(function CommentItem({ comment }: CommentItemProps) {
  return (
    <View className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <View className="flex-row items-center mb-1">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {comment.author_name}
        </Text>
        <Text className="text-xs text-gray-400 dark:text-gray-500 ml-2">
          {relativeTime(comment.created_at)}
        </Text>
      </View>
      <Text className="text-base text-gray-900 dark:text-gray-100">
        {comment.content}
      </Text>
    </View>
  );
});
