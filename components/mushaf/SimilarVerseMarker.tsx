import { EqualApproximately } from "lucide-react-native";
import { Platform, Pressable, View } from "react-native";
import { formatAyahRef } from "@/lib/arabic";
import { interpolate } from "@/lib/i18n/useStrings";
import { strings } from "@/lib/i18n/strings";
import { useSettings } from "@/lib/settings/context";

export const SIMILAR_MARKER_TARGET = 44;

function stopReaderChromeToggle(event: { stopPropagation?: () => void }) {
  event?.stopPropagation?.();
}
const nativeTouchProps =
  Platform.OS === "web"
    ? {}
    : { onTouchStart: stopReaderChromeToggle, onTouchMove: stopReaderChromeToggle, onTouchEnd: stopReaderChromeToggle };

export function similarMarkerLabel(language: "en" | "ar", surah: number, ayah: number): string {
  return interpolate(strings[language].hifzSimilarMarker, { ref: formatAyahRef(language === "ar", surah, ayah) });
}

type PageMarkerProps = {
  surah: number;
  ayah: number;
  fontSize: number;
  lineHeight: number;
  onPress: () => void;
  onLongPress: () => void;
};

export function SimilarVersePageMarker({ surah, ayah, fontSize, lineHeight, onPress, onLongPress }: PageMarkerProps) {
  const { uiLanguage } = useSettings();
  const dot = Math.round(Math.min(11, Math.max(7, fontSize * 0.32)));
  const ring = dot >= 9 ? 2 : 1.5;
  const outer = dot + ring * 2;
  const height = Math.max(SIMILAR_MARKER_TARGET, lineHeight);
  const top = (lineHeight - height) / 2;
  const dotCentre = lineHeight / 2 - fontSize * 0.42 - outer * 0.15;
  const dotTop = Math.max(0, dotCentre - outer / 2 - top);
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top, left: 0, right: 0, height, alignItems: "center" }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={similarMarkerLabel(uiLanguage, surah, ayah)}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={300}
        testID="similar-verse-marker"
        {...nativeTouchProps}
        style={{
          width: SIMILAR_MARKER_TARGET,
          height,
          alignItems: "center",
          ...(Platform.OS === "web" ? ({ cursor: "pointer", userSelect: "none" } as object) : null),
        }}
      >
        <View
          pointerEvents="none"
          className="rounded-full bg-primary-accent dark:bg-primary-bright border-surface dark:border-surface-dark"
          style={{ marginTop: dotTop, width: outer, height: outer, borderWidth: ring }}
        />
      </Pressable>
    </View>
  );
}

type ButtonProps = {
  label: string;
  isDark: boolean;
  onPress: () => void;
};

export function SimilarVerseButton({ label, isDark, onPress }: ButtonProps) {
  const inset = (SIMILAR_MARKER_TARGET - 32) / 2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID="similar-verse-marker"
      {...nativeTouchProps}
      {...(Platform.OS === "web" ? ({ dataSet: { hafizReaderInteraction: "true" } } as object) : null)}
      style={{
        width: SIMILAR_MARKER_TARGET,
        height: SIMILAR_MARKER_TARGET,
        margin: -inset,
        alignItems: "center",
        justifyContent: "center",
        ...(Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null),
      }}
    >
      <View className="h-8 w-8 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
        <EqualApproximately size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />
      </View>
    </Pressable>
  );
}
