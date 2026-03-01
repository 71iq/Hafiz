import { View, Text } from "react-native";
import type { ImportProgress } from "@/lib/database/init";

type Props = {
  progress: ImportProgress | null;
};

export function LoadingScreen({ progress }: Props) {
  const percentage = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <View className="flex-1 items-center justify-center bg-warm-50 px-8">
      <Text className="text-4xl font-bold text-warm-800 mb-2">
        Hafiz
      </Text>
      <Text className="text-lg text-warm-500 mb-12">
        Quran Retention App
      </Text>

      {progress ? (
        <View className="w-full max-w-xs">
          {/* Progress bar */}
          <View className="h-2 bg-warm-200 rounded-full overflow-hidden mb-4">
            <View
              className="h-full bg-warm-600 rounded-full"
              style={{ width: `${percentage}%` }}
            />
          </View>

          <Text className="text-base font-medium text-warm-700 text-center mb-1">
            {progress.step}
          </Text>
          {progress.detail && (
            <Text className="text-sm text-warm-400 text-center">
              {progress.detail}
            </Text>
          )}
          <Text className="text-sm text-warm-400 text-center mt-2">
            {percentage}%
          </Text>
        </View>
      ) : (
        <Text className="text-base text-warm-400">Preparing database...</Text>
      )}
    </View>
  );
}
