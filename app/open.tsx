import { useEffect } from "react";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { setPendingDeepLink } from "@/lib/deep-link";
import { navigateToMushaf } from "@/lib/navigation/open-mushaf";

/**
 * Deep link handler route.
 *
 * Handles:
 *   hafiz://open?surah=2&ayah=255
 *   https://hafizquran.app/open?surah=2&ayah=255
 *
 * Parses surah/ayah, stores the target, and redirects to the Mushaf tab.
 */
export default function OpenDeepLink() {
  const params = useLocalSearchParams<{ surah?: string; ayah?: string }>();
  const navigation = useNavigation();

  useEffect(() => {
    const surah = parseInt(params.surah ?? "", 10);
    const ayah = parseInt(params.ayah ?? "", 10);

    if (surah >= 1 && surah <= 114 && ayah >= 1) {
      setPendingDeepLink({ surah, ayah });
    }

    // A warm link pushes this screen on top of the open app. When the tabs are directly below,
    // return to them; replacing would stack another full tab tree under every link, growing memory
    // and the Back history (RF196). Otherwise (cold start, or a session, auth or onboarding screen
    // below) replace this screen as before so that flow stays underneath.
    navigateToMushaf(navigation.getState());
  }, [navigation, params.surah, params.ayah]);

  // Brief loading state while redirecting
  return (
    <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark">
      <ActivityIndicator size="large" color="#0d9488" />
    </View>
  );
}
