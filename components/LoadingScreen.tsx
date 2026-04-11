import { View, Text, Image } from "react-native";
import type { ImportProgress } from "@/lib/database/init";
import { Progress } from "@/components/ui/Progress";
import { strings } from "@/lib/i18n/strings";

const s = strings.en;
const logoSource = require("@/assets/images/logo.png");

type Props = {
  progress: ImportProgress | null;
};

export function LoadingScreen({ progress }: Props) {
  const percentage = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-8">
      {/* Gallery feel: generous top spacing via justify-center + offset */}
      <View className="items-center mb-16">
        <Image
          source={logoSource}
          style={{ width: 96, height: 96, marginBottom: 20 }}
          resizeMode="contain"
          accessibilityLabel="Hafiz"
        />
        <Text
          className="text-charcoal dark:text-neutral-100 mb-2"
          style={{ fontFamily: "NotoSerif_700Bold", fontSize: 40 }}
        >
          Hafiz
        </Text>
        <Text
          className="text-warm-400 dark:text-neutral-500"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 16 }}
        >
          {s.appSubtitle}
        </Text>
      </View>

      {progress ? (
        <View className="w-full max-w-xs gap-5">
          <Progress value={percentage} />

          <View className="items-center gap-1">
            <Text
              className="text-charcoal dark:text-neutral-200 text-center"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 15 }}
            >
              {progress.step}
            </Text>
            {progress.detail && (
              <Text
                className="text-warm-400 dark:text-neutral-500 text-center"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 13 }}
              >
                {progress.detail}
              </Text>
            )}
            <Text
              className="text-primary-accent dark:text-primary-bright text-center mt-1"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
            >
              {percentage}%
            </Text>
          </View>
        </View>
      ) : (
        <Text
          className="text-warm-400 dark:text-neutral-500"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
        >
          {s.preparingDatabase}
        </Text>
      )}
    </View>
  );
}
