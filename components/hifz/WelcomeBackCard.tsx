import { Pressable, View } from "react-native";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import type { SupportLevel } from "@/lib/hifz/grading";
import type { UIStrings } from "@/lib/i18n/strings";

type Props = { language: "en" | "ar"; s: UIStrings; onChoose: (level: SupportLevel) => void };

/**
 * 6.4 welcome back, without blame: the user says how their memorization feels, which sets the
 * starting support level, and the review opens with their strongest pages.
 */
export function WelcomeBackCard({ language, s, onChoose }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const options: { label: string; level: SupportLevel }[] = [
    { label: s.hifzWelcomeBackSolid, level: 4 },
    { label: s.hifzWelcomeBackShaky, level: 3 },
    { label: s.hifzWelcomeBackRusty, level: 2 },
  ];
  return (
    <Card elevation="low" className="mb-6 p-5 rounded-4xl">
      <Text dir={dir} style={{ fontFamily: "Manrope_700Bold", fontSize: 15, lineHeight: 21 }} className="text-charcoal dark:text-neutral-100">
        {s.hifzWelcomeBackTitle}
      </Text>
      <Text dir={dir} variant="caption" className="mt-1">
        {s.hifzWelcomeBackQuestion}
      </Text>
      <View className="mt-3" style={{ gap: 8 }}>
        {options.map((option) => (
          <Pressable
            key={option.level}
            accessibilityRole="button"
            onPress={() => onChoose(option.level)}
            className="min-h-[44px] justify-center rounded-2xl bg-surface-high dark:bg-surface-dark-high px-4"
          >
            <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="text-charcoal dark:text-neutral-200">
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}
