import { I18nManager, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, UserRound } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ProfileNotesManager } from "@/components/profile/ProfileNotesManager";
import { useDatabaseStatus } from "@/lib/database/provider";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { strings } from "@/lib/i18n/strings";
import { useAuthStore } from "@/lib/auth/store";

const UI_LANGUAGE_CACHE_KEY = "hafiz_ui_language";

export default function ProfileScreen() {
  const { isReady, progress, error } = useDatabaseStatus();

  if (error) {
    return <RouteDatabaseError message={error} />;
  }

  if (!isReady) {
    return <LoadingScreen progress={progress} />;
  }

  return (
    <SettingsProvider>
      <ProfileScreenContent />
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

function ProfileScreenContent() {
  const router = useRouter();
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { width } = useWindowDimensions();
  const { user, profile, isLoading: authLoading } = useAuthStore();
  const maxWidth = Math.min(width, 880);
  const ArrowIcon = isRTL ? ChevronRight : ChevronLeft;
  const accountName = profile?.display_name || profile?.username || user?.email || s.authProfile;
  const accountHandle = profile?.username ? `@${profile.username}` : user?.email || s.profileLocalOnly;
  const numberLocale = uiLanguage === "ar" ? "ar" : "en";
  const stats = [
    { label: s.wirdCurrent, value: profile?.current_streak ?? 0 },
    { label: s.wirdLongest, value: profile?.longest_streak ?? 0 },
    { label: s.flashcardsSummaryReviewed, value: profile?.cards_reviewed ?? 0 },
    { label: s.leaderboardPoints, value: profile?.total_score ?? 0 },
  ];

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          alignItems: "center",
          paddingHorizontal: 24,
          paddingTop: 10,
          paddingBottom: 56,
        }}
      >
        <View style={{ width: "100%", maxWidth }}>
          <View className={`items-center justify-between ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
            <Pressable
              onPress={() => router.back()}
              className="h-10 w-10 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high"
            >
              <ArrowIcon size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
            </Pressable>
          </View>

          <View className={`mt-5 items-center gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
            <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
              <UserRound size={24} color={isDark ? "#2dd4bf" : "#0d9488"} />
            </View>
            <View className="min-w-0 flex-1">
              <Text
                className="text-charcoal dark:text-neutral-100"
                numberOfLines={1}
                style={{
                  fontFamily: "NotoSerif_700Bold",
                  fontSize: 30,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {accountName}
              </Text>
              <Text
                className="mt-0.5 text-warm-400 dark:text-neutral-500"
                numberOfLines={1}
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 13,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {accountHandle}
              </Text>
            </View>
          </View>

          {!user && (
            <Card elevation="low" className="mt-5 p-5">
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{
                  fontFamily: "Manrope_700Bold",
                  fontSize: 16,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.profileSignedOutTitle}
              </Text>
              <Text
                className="mt-1 text-warm-400 dark:text-neutral-500"
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 13,
                  lineHeight: 19,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.profileSignedOutSubtitle}
              </Text>
              <View className="mt-4 gap-2">
                <Button onPress={() => router.push("/auth/login" as any)} disabled={authLoading}>
                  <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
                    {s.authLogin}
                  </Text>
                </Button>
                <Button variant="outline" onPress={() => router.push("/auth/signup" as any)} disabled={authLoading}>
                  <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
                    {s.authSignup}
                  </Text>
                </Button>
              </View>
            </Card>
          )}

          {user && (
            <View className="mt-5 flex-row flex-wrap gap-3">
              {stats.map((stat) => (
                <Card key={stat.label} elevation="low" className="min-w-[150px] flex-1 p-5">
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    style={{ fontFamily: "NotoSerif_700Bold", fontSize: 26, textAlign: isRTL ? "right" : "left" }}
                  >
                    {stat.value.toLocaleString(numberLocale)}
                  </Text>
                  <Text
                    className="mt-1 text-warm-400 dark:text-neutral-500"
                    style={{
                      fontFamily: "Manrope_500Medium",
                      fontSize: 11,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {stat.label}
                  </Text>
                </Card>
              ))}
            </View>
          )}

          <Card elevation="surface" className="mt-5 p-5">
            <ProfileNotesManager />
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
