import { Text, View } from "react-native";
import { useDatabaseStatus } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";

/**
 * Playwright/web QA probe route.
 * Use this page as a deterministic gate before screenshot flows:
 * - wait for "QA_READY" text
 * - then navigate to target routes in the same tab/session.
 */
export default function QaReadyScreen() {
  const { isReady, error } = useDatabaseStatus();
  const s = useStrings();

  return (
    <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-6">
      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
      >
        QA Readiness
      </Text>
      <Text
        className="mt-3 text-warm-400 dark:text-neutral-500 text-center"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 22 }}
      >
        Wait for ready before starting screenshot capture.
      </Text>

      <View
        className="mt-8 rounded-2xl px-5 py-4"
        style={{ backgroundColor: isReady ? "rgba(13,148,136,0.12)" : "rgba(139,129,120,0.12)" }}
      >
        {error ? (
          <>
            <Text
              className="text-red-600 dark:text-red-400 text-center"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }}
            >
              QA_ERROR
            </Text>
            <Text
              className="mt-2 text-red-500 text-center"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 12 }}
            >
              {error}
            </Text>
          </>
        ) : isReady ? (
          <Text
            className="text-primary-accent dark:text-primary-bright text-center"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 16 }}
          >
            QA_READY
          </Text>
        ) : (
          <>
            <Text
              className="text-warm-500 dark:text-neutral-400 text-center"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }}
            >
              QA_WAITING
            </Text>
            <Text
              className="mt-2 text-warm-500 dark:text-neutral-400 text-center"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 12 }}
            >
              {s.preparingDatabase}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}
