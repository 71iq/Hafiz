import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";

export default function HomeScreen() {
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
            {s.homeTitle}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 mt-1"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 14 }}
          >
            {s.homeSubtitle}
          </Text>
        </View>

        {/* Progress ring placeholder */}
        <Card elevation="low" className="p-8 mb-6 items-center">
          <View
            className="w-40 h-40 rounded-full items-center justify-center"
            style={{ borderWidth: 4, borderColor: isDark ? "#2dd4bf" : "#003638" }}
          >
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 36 }}
            >
              —
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11, letterSpacing: 1 }}
            >
              {s.homeMemorized}
            </Text>
          </View>
        </Card>

        {/* Stats row placeholder */}
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
              {s.homeTodayReviews}
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
              {s.homeStreak}
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
              {s.homeAyahs}
            </Text>
          </Card>
        </View>

        {/* Start review CTA placeholder */}
        <Card elevation="low" className="p-6 mb-6 bg-primary-soft dark:bg-primary-soft">
          <Text
            className="text-gold mb-1"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
          >
            {s.homeResumeTitle}
          </Text>
          <Text
            className="text-neutral-300"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 13 }}
          >
            {s.homeResumeDesc}
          </Text>
        </Card>

        {/* Quick access placeholder */}
        <Text
          className="text-charcoal dark:text-neutral-100 mb-4"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
        >
          {s.homeQuickAccess}
        </Text>
        <View className="flex-row gap-3 mb-8">
          <Card elevation="low" className="flex-1 p-5">
            <Text
              className="text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            >
              {s.homeNewMemorization}
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 12 }}
            >
              {s.comingSoon}
            </Text>
          </Card>
          <Card elevation="low" className="flex-1 p-5">
            <Text
              className="text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            >
              {s.homeDueReview}
            </Text>
            <Text
              className="text-warm-400 dark:text-neutral-500 mt-1"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 12 }}
            >
              {s.comingSoon}
            </Text>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
