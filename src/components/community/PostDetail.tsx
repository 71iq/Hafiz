import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useAuth } from "../../context/AuthContext";
import { fetchComments, createComment } from "../../lib/community-api";
import type { Post, Comment } from "../../lib/community-types";
import PostCard from "./PostCard";
import CommentItem from "./CommentItem";

interface PostDetailProps {
  post: Post;
  liked: boolean;
  onToggleLike: (postId: string) => void;
  onBack: () => void;
}

export default function PostDetail({
  post,
  liked,
  onToggleLike,
  onBack,
}: PostDetailProps) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadComments = useCallback(async () => {
    try {
      const data = await fetchComments(post.id);
      setComments(data);
    } catch (_e) {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [post.id]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleSubmitComment = useCallback(async () => {
    if (!user || !commentText.trim()) return;

    setSubmitting(true);
    try {
      await createComment(post.id, user.id, commentText.trim());
      setCommentText("");
      await loadComments();
    } catch (_e) {
      // Silently fail
    } finally {
      setSubmitting(false);
    }
  }, [user, commentText, post.id, loadComments]);

  const renderItem = useCallback(
    ({ item }: { item: Comment }) => <CommentItem comment={item} />,
    []
  );

  const keyExtractor = useCallback((item: Comment) => item.id, []);

  const noop = useCallback((_post: Post) => {}, []);

  const header = (
    <>
      {/* Back button */}
      <Pressable onPress={onBack} className="px-4 py-3">
        <Text className="text-blue-600 dark:text-blue-400 font-medium">
          Back
        </Text>
      </Pressable>

      <PostCard
        post={post}
        liked={liked}
        onToggleLike={onToggleLike}
        onPress={noop}
      />

      {/* Comments header */}
      <View className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <Text className="text-sm font-medium text-gray-500 dark:text-gray-400">
          Comments ({comments.length})
        </Text>
      </View>

      {loading && (
        <View className="py-4">
          <ActivityIndicator color="#1e40af" />
        </View>
      )}
    </>
  );

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={comments}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header}
        contentContainerClassName="pb-4"
        ListEmptyComponent={
          !loading ? (
            <View className="py-8 items-center">
              <Text className="text-gray-400 dark:text-gray-500">
                No comments yet
              </Text>
            </View>
          ) : null
        }
      />

      {/* Comment input bar */}
      <View className="flex-row items-center px-4 py-2 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <TextInput
          className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full px-4 py-2 text-base text-gray-900 dark:text-gray-100 mr-2"
          placeholder="Add a comment..."
          placeholderTextColor="#9ca3af"
          value={commentText}
          onChangeText={setCommentText}
          maxLength={1000}
          multiline
        />
        <Pressable
          onPress={handleSubmitComment}
          disabled={submitting || !commentText.trim()}
          style={{ opacity: submitting || !commentText.trim() ? 0.4 : 1 }}
        >
          <Text className="text-blue-600 dark:text-blue-400 font-semibold text-base">
            Send
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
