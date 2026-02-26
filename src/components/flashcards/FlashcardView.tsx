import { ScrollView } from "react-native";
import { useSettings } from "../../context/SettingsContext";
import type { FlashCard } from "../../lib/uniqueness";
import { Text } from "../ui/text";
import { Card, CardContent } from "../ui/card";

interface FlashcardViewProps {
  card: FlashCard;
  revealed: boolean;
}

export default function FlashcardView({ card, revealed }: FlashcardViewProps) {
  const { fontSize } = useSettings();

  if (card.isSurahOpening) {
    return (
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24 }}>
        <Card className="mt-4">
          <CardContent>
            <Text className="text-center text-xs text-amber-700 dark:text-amber-400 mb-2 font-semibold">
              Surah Opening
            </Text>

            <Text
              style={{ fontFamily: "AmiriQuran", fontSize: fontSize + 4, lineHeight: (fontSize + 4) * 2 }}
              className="text-center text-foreground mb-4"
            >
              {card.surahLabel}
            </Text>

            <Text variant="muted" className="text-center text-base">
              What is the first ayah?
            </Text>
          </CardContent>
        </Card>

        {revealed && (
          <Card className="mt-4 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
            <CardContent>
              <Text className="text-xs text-success mb-2 text-center">
                First Ayah ({card.ayah.surah}:1)
              </Text>
              <Text
                style={{ fontFamily: "AmiriQuran", fontSize, lineHeight: fontSize * 2 }}
                className="text-right text-green-900 dark:text-green-100"
              >
                {card.ayah.text_uthmani}
              </Text>
            </CardContent>
          </Card>
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24 }}>
      <Card className="mt-4">
        <CardContent>
          {/* Surah label for disambiguation */}
          {card.surahLabel && (
            <Text className="text-center text-sm text-amber-700 dark:text-amber-400 mb-2 font-semibold">
              {card.surahLabel}
            </Text>
          )}

          {/* Reference */}
          <Text variant="muted" className="text-center text-xs mb-4">
            {card.ayah.surah}:{card.ayah.ayah}
          </Text>

          {/* Context ayahs (lighter) */}
          {card.contextAyahs.map((ctx) => (
            <Text
              key={`${ctx.surah}-${ctx.ayah}`}
              style={{ fontFamily: "AmiriQuran", fontSize: fontSize - 2, lineHeight: fontSize * 1.8 }}
              variant="muted"
              className="text-right mb-1"
            >
              {ctx.text_uthmani}
            </Text>
          ))}

          {/* Target ayah (prompt) */}
          <Text
            style={{ fontFamily: "AmiriQuran", fontSize, lineHeight: fontSize * 2 }}
            className="text-right text-foreground"
          >
            {card.ayah.text_uthmani}
          </Text>
        </CardContent>
      </Card>

      {/* Answer section */}
      {revealed && (
        <Card className="mt-4 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
          <CardContent>
            <Text className="text-xs text-success mb-2 text-center">
              Next Ayah ({card.answer.surah}:{card.answer.ayah})
            </Text>
            <Text
              style={{ fontFamily: "AmiriQuran", fontSize, lineHeight: fontSize * 2 }}
              className="text-right text-green-900 dark:text-green-100"
            >
              {card.answer.text_uthmani}
            </Text>
          </CardContent>
        </Card>
      )}
    </ScrollView>
  );
}
