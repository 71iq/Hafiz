import { I18nManager, Platform, Text, View } from "react-native";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ProfileModalContent } from "@/components/profile/ProfileModalContent";
import { useDatabaseStatus } from "@/lib/database/provider";
import { strings } from "@/lib/i18n/strings";
import { SettingsProvider } from "@/lib/settings/context";

const UI_LANGUAGE_CACHE_KEY = "hafiz_ui_language";

export default function ProfileScreen() {
  const { isReady, progress, error } = useDatabaseStatus();

  if (error) return <RouteDatabaseError message={error} />;
  if (!isReady) return <LoadingScreen progress={progress} />;

  return (
    <SettingsProvider>
      <ProfileModalContent />
    </SettingsProvider>
  );
}

function RouteDatabaseError({ message }: { message: string }) {
  const uiLanguage = getStartupLanguage();
  const s = strings[uiLanguage];

  return (
    <View className="flex-1 items-center justify-center bg-surface px-6 dark:bg-surface-dark">
      <Text className="mb-2 text-red-600" style={{ fontFamily: "Manrope_700Bold", fontSize: 18 }}>
        {s.databaseError}
      </Text>
      <Text className="text-center text-red-500" style={{ fontFamily: "Manrope_400Regular", fontSize: 14 }}>
        {message}
      </Text>
    </View>
  );
}

function getStartupLanguage(): "en" | "ar" {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const cached = window.localStorage.getItem(UI_LANGUAGE_CACHE_KEY);
    if (cached === "en" || cached === "ar") return cached;
  }
  return I18nManager.isRTL ? "ar" : "en";
}
