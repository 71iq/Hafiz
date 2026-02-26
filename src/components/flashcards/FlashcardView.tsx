import { View, Text, ScrollView } from "react-native";
import { useSettings } from "../../context/SettingsContext";
import type { FlashCard } from "../../lib/uniqueness";

interface FlashcardViewProps {
  card: FlashCard;
  revealed: boolean;
}

export default function FlashcardView({ card, revealed }: FlashcardViewProps) {
  const { fontSize } = useSettings();

  return (
    <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24 }}>
      <View className="bg-white dark:bg-gray-900 rounded-2xl p-5 mt-4 border border-gray-200 dark:border-gray-700">
        {/* Surah label for disambiguation */}
        {card.surahLabel && (
          <Text className="text-center text-sm text-amber-700 dark:text-amber-400 mb-2 font-semibold">
            {card.surahLabel}
          </Text>
        )}

        {/* Reference */}
        <Text className="text-center text-xs text-gray-400 dark:text-gray-500 mb-4">
          {card.ayah.surah}:{card.ayah.ayah}
        </Text>

        {/* Context ayahs (lighter) */}
        {card.contextAyahs.map((ctx) => (
          <Text
            key={`${ctx.surah}-${ctx.ayah}`}
            style={{ fontSize: fontSize - 2, lineHeight: fontSize * 1.8 }}
            className="text-right text-gray-400 dark:text-gray-500 mb-1"
          >
            {ctx.text_uthmani}
          </Text>
        ))}

        {/* Target ayah (prompt) */}
        <Text
          style={{ fontSize, lineHeight: fontSize * 2 }}
          className="text-right text-gray-900 dark:text-gray-100"
        >
          {card.ayah.text_uthmani}
        </Text>
      </View>

      {/* Answer section */}
      {revealed && (
        <View className="bg-green-50 dark:bg-green-950 rounded-2xl p-5 mt-4 border border-green-200 dark:border-green-800">
          <Text className="text-xs text-green-600 dark:text-green-400 mb-2 text-center">
            Next Ayah ({card.answer.surah}:{card.answer.ayah})
          </Text>
          <Text
            style={{ fontSize, lineHeight: fontSize * 2 }}
            className="text-right text-green-900 dark:text-green-100"
          >
            {card.answer.text_uthmani}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
