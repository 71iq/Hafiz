import { useState, useCallback } from "react";
import {
  Modal,
  View,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useAuth } from "../../context/AuthContext";
import { createPost } from "../../lib/community-api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Text } from "../ui/text";

interface CreatePostModalProps {
  visible: boolean;
  surah: number;
  ayah: number;
  ayahText: string;
  surahName: string;
  onClose: () => void;
  onPostCreated: () => void;
}

export default function CreatePostModal({
  visible,
  surah,
  ayah,
  ayahText,
  surahName,
  onClose,
  onPostCreated,
}: CreatePostModalProps) {
  const { user } = useAuth();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePost = useCallback(async () => {
    if (!user || !content.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await createPost(user.id, surah, ayah, ayahText, content.trim());
      setContent("");
      onPostCreated();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Failed to create post");
    } finally {
      setSubmitting(false);
    }
  }, [user, content, surah, ayah, ayahText, onPostCreated, onClose]);

  const handleClose = useCallback(() => {
    setContent("");
    setError(null);
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        className="flex-1 justify-end"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable className="flex-1" onPress={handleClose} />
        <View className="bg-card rounded-t-2xl border-t border-border max-h-[80%]">
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
            <Button variant="ghost" onPress={handleClose}>
              <Text variant="muted" className="text-base">Cancel</Text>
            </Button>
            <Text className="text-base font-semibold text-foreground">
              Ask Community
            </Text>
            <Pressable
              onPress={handlePost}
              disabled={submitting || !content.trim()}
              style={{ opacity: submitting || !content.trim() ? 0.4 : 1 }}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="hsl(var(--primary))" />
              ) : (
                <Text className="text-primary font-semibold text-base">Post</Text>
              )}
            </Pressable>
          </View>

          <ScrollView className="px-4 pt-3" keyboardShouldPersistTaps="handled">
            {/* Ayah preview */}
            <View className="bg-muted rounded-xl p-3 mb-3">
              <Text className="text-xs text-primary mb-1">
                Surah {surahName} : Ayah {ayah}
              </Text>
              <Text
                className="text-base text-foreground"
                style={{ writingDirection: "rtl", textAlign: "right" }}
                numberOfLines={3}
              >
                {ayahText}
              </Text>
            </View>

            {/* Content input */}
            <Input
              className="text-base min-h-[120px] mb-4 border-0 bg-transparent px-0"
              placeholder="What would you like to ask about this ayah?"
              multiline
              textAlignVertical="top"
              maxLength={2000}
              value={content}
              onChangeText={setContent}
              autoFocus
            />

            {/* Character count */}
            <Text variant="muted" className="text-xs text-right mb-2">
              {content.length}/2000
            </Text>

            {error && (
              <Text variant="destructive" className="text-center mb-4">{error}</Text>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
