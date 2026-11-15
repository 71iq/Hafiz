import { useEffect, useMemo, useState } from "react";
import { Platform, View, Text, Image } from "react-native";
import type { ImportProgress } from "@/lib/database/init";
import { Progress } from "@/components/ui/Progress";
import { strings } from "@/lib/i18n/strings";
import { getStartupLanguage } from "@/lib/i18n/startup-language";
import { useUiBootstrap } from "@/lib/settings/ui-bootstrap";

const logoSource = require("@/assets/images/logo.png");
function safeStartupLanguage(): "en" | "ar" {
  try {
    return getStartupLanguage();
  } catch {
    return "en";
  }
}

type Props = {
  progress: ImportProgress | null;
};

export function LoadingScreen({ progress }: Props) {
  // Web reads its cached language on the first client frame. Native waits for the startup mirror and
  // shows the logo and progress without language text until it resolves.
  const bootstrap = useUiBootstrap();
  const [webLanguage, setWebLanguage] = useState<"en" | "ar" | null>(() =>
    Platform.OS === "web" && typeof window !== "undefined" ? safeStartupLanguage() : null
  );
  const uiLanguage = Platform.OS === "web" ? webLanguage : bootstrap.resolved ? safeStartupLanguage() : null;
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
    setWebLanguage(safeStartupLanguage());
    const onStorage = () => setWebLanguage(safeStartupLanguage());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-8">
      {/* Gallery feel: generous top spacing via justify-center + offset */}
      <View className="items-center mb-16">
        <View
          className="items-center justify-center rounded-full bg-surface-bright dark:bg-surface-dark-high"
          style={{ width: 96, height: 96, borderRadius: 48, overflow: "hidden", marginBottom: 20 }}
        >
          <Image
            source={logoSource}
            style={{ width: 84, height: 84, borderRadius: 42 }}
            resizeMode="contain"
            accessibilityLabel="Hafiz"
          />
        </View>
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
