import { useState, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useAuth } from "../../context/AuthContext";
import { createPost } from "../../lib/community-api";

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
        <View className="bg-white dark:bg-gray-900 rounded-t-2xl border-t border-gray-200 dark:border-gray-700 max-h-[80%]">
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
            <Pressable onPress={handleClose}>
              <Text className="text-gray-500 dark:text-gray-400 text-base">
                Cancel
              </Text>
            </Pressable>
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Ask Community
            </Text>
            <Pressable
              onPress={handlePost}
              disabled={submitting || !content.trim()}
              style={{ opacity: submitting || !content.trim() ? 0.4 : 1 }}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#2563eb" />
              ) : (
                <Text className="text-blue-600 dark:text-blue-400 font-semibold text-base">
                  Post
                </Text>
              )}
            </Pressable>
          </View>

          <ScrollView className="px-4 pt-3" keyboardShouldPersistTaps="handled">
            {/* Ayah preview */}
            <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 mb-3">
              <Text className="text-xs text-blue-600 dark:text-blue-400 mb-1">
                Surah {surahName} : Ayah {ayah}
              </Text>
              <Text
                className="text-base text-gray-700 dark:text-gray-300"
                style={{ writingDirection: "rtl", textAlign: "right" }}
                numberOfLines={3}
              >
                {ayahText}
              </Text>
            </View>

            {/* Content input */}
            <TextInput
              className="text-base text-gray-900 dark:text-gray-100 min-h-[120px] mb-4"
              placeholder="What would you like to ask about this ayah?"
              placeholderTextColor="#9ca3af"
              multiline
              textAlignVertical="top"
              maxLength={2000}
              value={content}
              onChangeText={setContent}
              autoFocus
            />

            {/* Character count */}
            <Text className="text-xs text-gray-400 dark:text-gray-500 text-right mb-2">
              {content.length}/2000
            </Text>

            {error && (
              <Text className="text-red-500 text-center mb-4">{error}</Text>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
