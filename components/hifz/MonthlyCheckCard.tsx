import { View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import type { UIStrings } from "@/lib/i18n/strings";

type Props = { language: "en" | "ar"; s: UIStrings; onStart: () => void; onDecline: () => void };

/** MST-05: the optional monthly check, offered once a month and easy to decline. */
export function MonthlyCheckCard({ language, s, onStart, onDecline }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  return (
    <Card elevation="low" className="mb-6 p-5 rounded-4xl">
      <Text dir={dir} style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }} className="text-charcoal dark:text-neutral-100">
        {s.hifzMonthlyTitle}
      </Text>
      <Text dir={dir} variant="caption" className="mt-1" style={{ lineHeight: 18 }}>
        {s.hifzMonthlyBody}
      </Text>
      <MirroredRow dir={dir} className="mt-3 gap-2">
        <View className="flex-1">
          <Button size="sm" label={s.hifzMonthlyStart} onPress={onStart} />
        </View>
        <View className="flex-1">
          <Button size="sm" variant="outline" label={s.hifzNotNow} onPress={onDecline} />
        </View>
      </MirroredRow>
    </Card>
  );
}
