import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";

export default function ProgressScreen() {
  const s = useStrings();
  const { isDark } = useSettings();

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header */}
        <View className="pt-8 pb-6">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
          >
            {s.progressTitle}
          </Text>
        </View>

        {/* Daily reminder card placeholder */}
        <Card elevation="low" className="p-6 mb-6 bg-primary-soft dark:bg-primary-soft">
          <Text
            className="text-gold mb-2"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, letterSpacing: 0.5 }}
          >
            {s.progressDailyReminder}
          </Text>
          <Text
            className="text-neutral-200"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 14,
              lineHeight: 22,
              writingDirection: "rtl",
              textAlign: "center",
            }}
          >
            {s.progressHadith}
          </Text>
        </Card>

        {/* Stats grid placeholder */}
        <View className="flex-row gap-3 mb-3">
          <Card elevation="low" className="flex-1 p-5 items-center">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 24 }}
            >
              —
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.progressTotalMemorized}
            </Text>
          </Card>
          <Card elevation="low" className="flex-1 p-5 items-center">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 24 }}
            >
              —
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.progressRetention}
            </Text>
          </Card>
        </View>
        <View className="flex-row gap-3 mb-6">
          <Card elevation="low" className="flex-1 p-5 items-center">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 24 }}
            >
              —
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.progressAvgDaily}
            </Text>
          </Card>
          <Card elevation="low" className="flex-1 p-5 items-center">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 24 }}
            >
              —
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
            >
              {s.progressLongestStreak}
            </Text>
          </Card>
        </View>

        {/* Activity heatmap placeholder */}
        <Card elevation="low" className="p-6 mb-6">
          <Text
            className="text-charcoal dark:text-neutral-200 mb-4"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
          >
            {s.progressActivity}
          </Text>
          <View className="h-32 rounded-2xl bg-surface-low dark:bg-surface-dark-low items-center justify-center">
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
            >
              {s.comingSoon}
            </Text>
          </View>
        </Card>

        {/* Surah progress placeholder */}
        <Text
          className="text-charcoal dark:text-neutral-200 mb-4"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
        >
          {s.progressSurahProgress}
        </Text>
        <Card elevation="low" className="p-5 mb-3">
          <View className="h-16 items-center justify-center">
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
            >
              {s.comingSoon}
            </Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
