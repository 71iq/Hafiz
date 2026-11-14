import { EqualApproximately } from "lucide-react-native";
import { Platform, Pressable, View } from "react-native";
import { formatAyahRef } from "@/lib/arabic";
import { interpolate } from "@/lib/i18n/useStrings";
import { strings } from "@/lib/i18n/strings";
import { useSettings } from "@/lib/settings/context";

/** The smallest touch target for a marker, in both dimensions. */
export const SIMILAR_MARKER_TARGET = 44;

// On native a tap on the reader shows or hides its controls; a marker tap opens a sheet instead.
// Web needs nothing here: the reader already ignores taps inside Quran tokens and reader controls,
// and stopping pointer events there would stop a touch swipe that starts on the marker.
function stopReaderChromeToggle(event: { stopPropagation?: () => void }) {
  event?.stopPropagation?.();
}
const nativeTouchProps =
  Platform.OS === "web"
    ? {}
    : { onTouchStart: stopReaderChromeToggle, onTouchMove: stopReaderChromeToggle, onTouchEnd: stopReaderChromeToggle };

/** "Similar verses for ayah 2:5", in the interface language and digits. */
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

/**
 * MUT-02: the page-view mark on an ayah end marker whose ayah has a memorized similar verse. It is
 * drawn inside the marker's own box and positioned absolutely, so the page-font line keeps its
 * layout. The dot sits on the top of the ayah number, where the page fonts leave no ink (their
 * ayah-number glyphs reach about 0.42 em above the middle of the line box). Its touch target is
 * 44 px wide and at least 44 px tall, centred on the marker, so on a marked ayah the number itself
 * opens the comparison; a long press still selects the ayah.
 */
export function SimilarVersePageMarker({ surah, ayah, fontSize, lineHeight, onPress, onLongPress }: PageMarkerProps) {
  // Read here rather than in the page, so a page does not re-render for the interface language.
  const { uiLanguage } = useSettings();
  const dot = Math.round(Math.min(11, Math.max(7, fontSize * 0.32)));
  const ring = dot >= 9 ? 2 : 1.5;
  const outer = dot + ring * 2;
  const height = Math.max(SIMILAR_MARKER_TARGET, lineHeight);
  // Both measured from the marker's box: the target's top, and the dot's centre just above the ink.
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

/**
 * MUT-02: the verse-view mark, an icon in the ayah's header row. It draws at the size of the row's
 * other 32 px icons, and negative margins widen its touch target to 44 px without changing the
 * row's height, so the ayah text below does not move.
 */
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
