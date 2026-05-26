import { useEffect, useMemo, useState } from "react";
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
  const [uiLanguage, setUiLanguage] = useState<"en" | "ar" | null>(() =>
    Platform.OS === "web" ? null : getStartupLanguage()
  );
  const s = uiLanguage ? strings[uiLanguage] : null;
  const rawPct = progress ? (progress.current / progress.total) * 100 : 0;
  const percentage = Math.max(0, Math.min(100, Math.round(rawPct)));
  const fonts = useMemo(
    () => ({
      title:
        Platform.OS === "web"
          ? "Georgia, 'Times New Roman', serif"
          : "NotoSerif_700Bold",
      body:
        Platform.OS === "web"
          ? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
          : "Manrope_400Regular",
    }),
    []
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    setUiLanguage(getStartupLanguage());
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
          style={{
            fontFamily: fonts.title,
            fontSize: 40,
            fontWeight: Platform.OS === "web" ? "700" : undefined,
          }}
        >
          Hafiz
        </Text>
        {s && (
          <Text
            className="text-warm-400 dark:text-neutral-500"
            style={{
              fontFamily: fonts.body,
              fontSize: 16,
              writingDirection: uiLanguage === "ar" ? "rtl" : "ltr",
            }}
          >
            {s.appSubtitle}
          </Text>
        )}
      </View>

      <View className="w-full max-w-xs">
        <Progress value={percentage} />
      </View>
    </View>
  );
}
