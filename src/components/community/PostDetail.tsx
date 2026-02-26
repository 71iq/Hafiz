import { useState, useEffect, useCallback } from "react";
import {
  View,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useAuth } from "../../context/AuthContext";
import { fetchComments, createComment } from "../../lib/community-api";
import type { Post, Comment } from "../../lib/community-types";
import PostCard from "./PostCard";
import CommentItem from "./CommentItem";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Text } from "../ui/text";

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
      <Button variant="ghost" onPress={onBack} className="self-start mx-2 my-1">
        <Text className="text-primary font-medium">Back</Text>
      </Button>

      <PostCard
        post={post}
        liked={liked}
        onToggleLike={onToggleLike}
        onPress={noop}
      />

      {/* Comments header */}
      <View className="px-4 py-3 border-b border-border">
        <Text variant="muted" className="text-sm font-medium">
          Comments ({comments.length})
        </Text>
      </View>

      {loading && (
        <View className="py-4">
          <ActivityIndicator color="hsl(var(--primary))" />
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
              <Text variant="muted">No comments yet</Text>
            </View>
          ) : null
        }
      />

      {/* Comment input bar */}
      <View className="flex-row items-center px-4 py-2 border-t border-border bg-card">
        <Input
          className="flex-1 rounded-full mr-2 bg-muted border-0"
          placeholder="Add a comment..."
          value={commentText}
          onChangeText={setCommentText}
          maxLength={1000}
          multiline
        />
        <Button
          variant="ghost"
          onPress={handleSubmitComment}
          disabled={submitting || !commentText.trim()}
        >
          <Text className="text-primary font-semibold text-base">Send</Text>
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}
