import { View } from "react-native";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import type { HifzProgress } from "@/lib/hifz/progress";
import { formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";

type Props = { progress: HifzProgress; language: "en" | "ar"; isDark: boolean; s: UIStrings };

/** MST-02, MST-03: memorized pages by strength in calm colors, and completed juz. No broken visuals. */
export function HifzProgressCard({ progress, language, isDark, s }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const total = Math.max(1, progress.bands.steady + progress.bands.fair + progress.bands.needsReview);
  const segments = [
    { value: progress.bands.steady, color: isDark ? "#2dd4bf" : "#0d9488", label: interpolate(s.hifzStrengthSteady, { n: formatNumber(progress.bands.steady, language) }) },
    { value: progress.bands.fair, color: isDark ? "#FDDC91" : "#c9a227", label: interpolate(s.hifzStrengthFair, { n: formatNumber(progress.bands.fair, language) }) },
    { value: progress.bands.needsReview, color: isDark ? "#a3a3a3" : "#a8a29e", label: interpolate(s.hifzStrengthNeedsReview, { n: formatNumber(progress.bands.needsReview, language) }) },
  ];
  return (
    <Card elevation="low" className="p-5 mb-6" accessibilityRole="summary">
      <MirroredRow dir={dir} className="items-center justify-between">
        <Text dir={dir} style={{ fontFamily: "Manrope_700Bold", fontSize: 16 }} className="text-charcoal dark:text-neutral-200">
          {s.hifzStrengthTitle}
        </Text>
        <Text dir={dir} variant="caption">
          {interpolate(s.hifzMemorizedPages, { n: formatNumber(progress.memorizedPages, language) })}
        </Text>
      </MirroredRow>
      <View
        className="mt-4 h-2 rounded-full overflow-hidden bg-surface-high dark:bg-surface-dark-high"
        style={{ flexDirection: dir === "rtl" ? "row-reverse" : "row", direction: "ltr" }}
      >
        {segments.map((segment) =>
          segment.value > 0 ? <View key={segment.label} style={{ width: `${(segment.value / total) * 100}%`, backgroundColor: segment.color }} /> : null,
        )}
      </View>
      <MirroredRow dir={dir} className="mt-3 flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <MirroredRow key={segment.label} dir={dir} className="items-center gap-1.5">
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: segment.color }} />
            <Text dir={dir} variant="caption">
              {segment.label}
            </Text>
          </MirroredRow>
        ))}
      </MirroredRow>
      {progress.juzComplete.length > 0 ? (
        <Text dir={dir} className="mt-3" variant="caption">
          {interpolate(s.hifzJuzComplete, { n: formatNumber(progress.juzComplete.length, language) })}
        </Text>
      ) : null}
    </Card>
  );
}
