import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Layers } from "lucide-react-native";

export default function FlashcardsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-warm-50 dark:bg-neutral-950">
      <View className="flex-1 items-center justify-center px-6">
        <Layers size={48} className="text-warm-300 dark:text-neutral-600 mb-4" />
        <Text className="text-xl font-bold text-warm-700 dark:text-neutral-300 mb-2">
          Flashcards
        </Text>
        <Text className="text-warm-400 dark:text-neutral-500 text-center">
          Spaced repetition flashcards for Quran memorization. Coming soon.
        </Text>
      </View>
    </SafeAreaView>
  );
}
