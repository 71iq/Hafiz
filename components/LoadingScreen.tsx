import { useEffect, useMemo, useState } from "react";
import { Platform, View, Text, Image } from "react-native";
import type { ImportProgress } from "@/lib/database/init";
import { Progress } from "@/components/ui/Progress";
import { strings, type UIStringKey } from "@/lib/i18n/strings";
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

export const DATABASE_SLOW_HINT_MS = 10_000;

export function importStageLabelKey(progress: ImportProgress | null): UIStringKey {
  if (!progress) return "databaseStageSchema";
  if (progress.step === "Complete" || progress.current >= progress.total) return "databaseStageFinish";
  const finished = progress.current;
  if (finished <= 2) return "databaseStageText";
  if (finished === 3 || (finished >= 9 && finished <= 10) || (finished >= 13 && finished <= 14))
    return "databaseStageWords";
  if (finished <= 5) return "databaseStageTafsir";
  if (finished <= 7) return "databaseStageTranslations";
  if (finished === 8 || finished === 12) return "databaseStagePages";
  if (finished === 11 || finished === 15 || finished === 16) return "databaseStageTajweed";
  return "databaseStageExtras";
}

type Props = {
  progress: ImportProgress | null;
  showProgress?: boolean;
};

const SUBTITLE_LINE_HEIGHT = 22;
const STAGE_LINE_HEIGHT = 18;

export function LoadingScreen({ progress, showProgress = true }: Props) {
  const bootstrap = useUiBootstrap();
  const [webLanguage, setWebLanguage] = useState<"en" | "ar" | null>(() =>
    Platform.OS === "web" && typeof window !== "undefined" ? safeStartupLanguage() : null,
  );
  const uiLanguage = Platform.OS === "web" ? webLanguage : bootstrap.resolved ? safeStartupLanguage() : null;
  const s = uiLanguage ? strings[uiLanguage] : null;
  const isRTL = uiLanguage === "ar";
  const rawPct = progress ? (progress.current / progress.total) * 100 : 0;
  const percentage = Math.max(0, Math.min(100, Math.round(rawPct)));
  const [slow, setSlow] = useState(false);
  const fonts = useMemo(
    () => ({
      title: Platform.OS === "web" ? "Georgia, 'Times New Roman', serif" : "NotoSerif_700Bold",
      body:
        Platform.OS === "web"
          ? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
          : "Manrope_400Regular",
    }),
    [],
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    setWebLanguage(safeStartupLanguage());
    const onStorage = () => setWebLanguage(safeStartupLanguage());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!showProgress) return;
    const timer = setTimeout(() => setSlow(true), DATABASE_SLOW_HINT_MS);
    return () => clearTimeout(timer);
  }, [showProgress]);

  const stage = s ? s[importStageLabelKey(progress)] : null;

  return (
    <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-8">
      <View className="items-center mb-8">
        <View
          className="items-center justify-center rounded-full bg-surface-bright dark:bg-surface-dark-high"
          style={{ width: 96, height: 96, borderRadius: 48, overflow: "hidden", marginBottom: 20 }}
        >
          <Image
            source={logoSource}
            style={{ width: 84, height: 84, borderRadius: 42 }}
            resizeMode="contain"
            accessibilityLabel={s?.appName ?? strings.en.appName}
          />
        </View>
        <Text
          className="text-charcoal dark:text-neutral-100 mb-2"
          style={{
            fontFamily: isRTL ? undefined : fonts.title,
            fontSize: 40,
            fontWeight: Platform.OS === "web" || isRTL ? "700" : undefined,
          }}
        >
          {s?.appName ?? strings.en.appName}
        </Text>
        <Text
          className="text-warm-400 dark:text-neutral-500 text-center"
          style={{
            fontFamily: fonts.body,
            fontSize: 16,
            lineHeight: SUBTITLE_LINE_HEIGHT,
            minHeight: SUBTITLE_LINE_HEIGHT,
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {s ? s.appSubtitle : ""}
        </Text>
      </View>

      {showProgress ? (
        <View className="w-full max-w-xs">
          <Progress value={percentage} />
          <Text
            accessibilityLiveRegion="polite"
            className="mt-3 text-warm-700 dark:text-neutral-400 text-center"
            style={{
              fontFamily: fonts.body,
              fontSize: 12,
              lineHeight: STAGE_LINE_HEIGHT,
              minHeight: STAGE_LINE_HEIGHT,
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {stage ?? ""}
          </Text>
          {slow && s ? (
            <Text
              accessibilityLiveRegion="polite"
              className="mt-2 text-warm-700 dark:text-neutral-400 text-center"
              style={{
                fontFamily: fonts.body,
                fontSize: 13,
                lineHeight: 20,
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.databaseSlowHint}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
