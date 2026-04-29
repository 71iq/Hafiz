import { useEffect, useState } from "react";
import { Platform, View, Text, Image, I18nManager } from "react-native";
import type { ImportProgress } from "@/lib/database/init";
import { Progress } from "@/components/ui/Progress";
import { strings } from "@/lib/i18n/strings";

const logoSource = require("@/assets/images/logo.png");
const UI_LANGUAGE_CACHE_KEY = "hafiz_ui_language";

function getStartupLanguage(): "en" | "ar" {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const cached = window.localStorage.getItem(UI_LANGUAGE_CACHE_KEY);
    if (cached === "en" || cached === "ar") return cached;
    if (window.navigator.language.toLowerCase().startsWith("ar")) return "ar";
  }
  return I18nManager.isRTL ? "ar" : "en";
}

type Props = {
  progress: ImportProgress | null;
};

export function LoadingScreen({ progress }: Props) {
  const [uiLanguage, setUiLanguage] = useState<"en" | "ar">(getStartupLanguage);
  const s = strings[uiLanguage];
  const rawPct = progress ? (progress.current / progress.total) * 100 : 0;
  const percentage = Math.max(0, Math.min(100, Math.round(rawPct)));
  const stepLabel = progress
    ? `${progress.step} (${Math.min(progress.current, progress.total)}/${progress.total})`
    : null;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onStorage = () => setUiLanguage(getStartupLanguage());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
              {stepLabel}
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
