import { useEffect } from "react";
import { useLocalSearchParams, router } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { setPendingDeepLink } from "@/lib/deep-link";

/**
 * Deep link handler route.
 *
 * Handles:
 *   hafiz://open?surah=2&ayah=255
 *   https://hafiz.app/open?surah=2&ayah=255
 *
 * Parses surah/ayah, stores the target, and redirects to the Mushaf tab.
 */
export default function OpenDeepLink() {
  const params = useLocalSearchParams<{ surah?: string; ayah?: string }>();

  useEffect(() => {
    const surah = parseInt(params.surah ?? "", 10);
    const ayah = parseInt(params.ayah ?? "", 10);

    if (surah >= 1 && surah <= 114 && ayah >= 1) {
      setPendingDeepLink({ surah, ayah });
    }

    // Replace so user can't navigate "back" to this blank screen
    router.replace("/(tabs)/mushaf");
  }, [params.surah, params.ayah]);

  // Brief loading state while redirecting
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF8F1" }}>
      <ActivityIndicator size="large" color="#0d9488" />
    </View>
  );
}
