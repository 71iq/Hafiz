import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";
import { strings } from "@/lib/i18n/strings";
import { getStartupLanguage } from "@/lib/i18n/startup-language";

export default function NotFoundScreen() {
  const s = strings[getStartupLanguage()];

  return (
    <>
      <Stack.Screen options={{ title: s.notFoundTitle }} />
      <View className="flex-1 items-center justify-center p-5 bg-warm-50">
        <Text className="text-xl font-bold text-warm-800">
          {s.notFoundMessage}
        </Text>
        <Link href="/" className="mt-4 py-4">
          <Text className="text-sm text-blue-600">{s.notFoundHome}</Text>
        </Link>
      </View>
    </>
  );
}
