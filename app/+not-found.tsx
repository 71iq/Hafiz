import { router, Stack } from "expo-router";
import { View } from "react-native";
import { FileQuestion } from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";

// Uses the app's empty state so the screen follows the theme and language; the bare text and nested
// Link drew in fixed colours and clipped the home link to "Go to" on Android.
export default function NotFoundScreen() {
  const s = useStrings();
  const { isDark } = useSettings();

  return (
    <>
      <Stack.Screen options={{ title: s.notFoundTitle }} />
      <View className="flex-1 items-center justify-center bg-surface p-5 dark:bg-surface-dark">
        <EmptyState
          icon={FileQuestion}
          title={s.notFoundTitle}
          subtitle={s.notFoundMessage}
          actionLabel={s.notFoundHome}
          onAction={() => router.replace("/(tabs)/home")}
          isDark={isDark}
        />
      </View>
    </>
  );
}
