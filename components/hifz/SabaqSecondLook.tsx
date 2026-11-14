import { useCallback, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import { GradingButtons } from "@/components/flashcards/GradingButtons";
import { HIDDEN, RecitationPage } from "@/components/hifz/RecitationPage";
import { formatAyahRef } from "@/lib/arabic";
import type { Grade } from "@/lib/fsrs/scheduler";
import type { PageToken } from "@/lib/hifz/page-data";
import type { SecondLook } from "@/lib/hifz/sabaq";
import { formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { mutedIconColor } from "@/lib/ui/theme-icons";

/** The shared outline Button has no border; here an outline action needs one to read as a button. */
const OUTLINE_BORDER = "border border-warm-300 dark:border-neutral-700";

type Props = {
  look: SecondLook;
  /** The look's place among today's due looks, from 0. */
  index: number;
  total: number;
  /** A grade is saving: the grade and skip actions wait for it. */
  busy: boolean;
  error: string | null;
  /** Close was pressed during a save and waits for it. */
  closePending: boolean;
  surahNames: ReadonlyMap<number, string>;
  isDark: boolean;
  isRTL: boolean;
  language: "en" | "ar";
  s: UIStrings;
  onClose: () => void;
  onGrade: (rating: Grade) => void;
  /** Go on to new lines. Nothing is saved, so the look stays due for the rest of the day. */
  onSkip: () => void;
  /** A new lesson follows when the look is skipped, so the skip says where it goes. */
  continuesToNewLines: boolean;
};

/**
 * SBQ-03, the second look: recite lines memorized earlier today from memory, check them against the
 * page and grade the recall, before any new lines. Laid out like the sabaq lesson it precedes. Give
 * it a key per look, so the check starts hidden for each one.
 */
export function SabaqSecondLook({
  look,
  index,
  total,
  busy,
  error,
  closePending,
  surahNames,
  isDark,
  isRTL,
  language,
  s,
  onClose,
  onGrade,
  onSkip,
  continuesToNewLines,
}: Props) {
  const { width } = useWindowDimensions();
  const pageWidth = Math.min(width, 640);
  const dir = isRTL ? "rtl" : "ltr";
  const [shown, setShown] = useState(false);
  // Teal text under 14 px uses the darker token in light mode.
  const accent = isDark ? "#2dd4bf" : "#0f766e";
  const { effectiveTheme } = useSettings();
  const muted = mutedIconColor(effectiveTheme);
  const ayahLabel = useCallback((token: PageToken) => formatAyahRef(isRTL, token.surah, token.ayah), [isRTL]);
  const portion = `${interpolate(s.hifzPageN, { n: formatNumber(look.page, language) })} · ${interpolate(
    s.hifzSabaqLines,
    {
      from: formatNumber(look.fromLine, language),
      to: formatNumber(look.toLine, language),
    },
  )}`;

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="items-center">
        <View style={{ width: "100%", maxWidth: pageWidth }}>
          <MirroredRow dir={dir} className="items-center justify-between px-5 pt-3 pb-2">
            <Pressable
              onPress={onClose}
              disabled={closePending}
              accessibilityRole="button"
              accessibilityLabel={s.genericClose}
              accessibilityState={{ disabled: closePending }}
              className={`w-11 h-11 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center ${closePending ? "opacity-50" : ""}`}
            >
              <X size={18} color={muted} />
            </Pressable>
            <Text
              dir={dir}
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
              className="text-warm-600 dark:text-neutral-400"
            >
              {portion}
            </Text>
            <View style={{ width: 44 }} />
          </MirroredRow>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, alignItems: "center" }}>
        <View style={{ width: "100%", maxWidth: pageWidth, gap: 6 }}>
          <Text
            dir={dir}
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 21, lineHeight: 30 }}
            className="text-charcoal dark:text-neutral-100"
          >
            {s.hifzSecondLookTitle}
          </Text>
          {/* Readable at 4.5:1 in both themes; the shared muted tone is lighter. */}
          <Text dir={dir} variant="muted" className="text-warm-600 dark:text-neutral-400" style={{ lineHeight: 20 }}>
            {s.hifzSecondLookHint}
          </Text>
          {total > 1 ? (
            <Text dir={dir} variant="caption" style={{ color: accent }}>
              {interpolate(s.hifzSecondLookCount, {
                n: formatNumber(index + 1, language),
                total: formatNumber(total, language),
              })}
            </Text>
          ) : null}
        </View>

        <Card elevation="low" className="py-4 rounded-3xl" style={{ width: pageWidth - 16 }}>
          <RecitationPage
            page={look.pageData}
            level={4}
            reveal={shown ? { ...HIDDEN, all: true } : HIDDEN}
            lineNumbers={look.lineNumbers}
            surahNames={surahNames}
            isDark={isDark}
            width={pageWidth - 16}
            wordLabel={ayahLabel}
          />
        </Card>

      </ScrollView>

      <View className="px-4 pt-3 pb-4 border-t border-surface-high dark:border-surface-dark-high items-center">
        <View style={{ width: "100%", maxWidth: pageWidth, gap: 10 }}>
          {/* A failed save shows here, by the grade the person just pressed. */}
          {error ? (
            <Text
              dir={dir}
              className="text-red-600 dark:text-red-400"
              accessibilityRole="alert"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 20 }}
            >
              {error}
            </Text>
          ) : null}
          {shown ? (
            <GradingButtons onGrade={onGrade} previews={{}} isDark={isDark} s={s} disabled={busy} />
          ) : (
            <Button label={s.hifzDrillShow} onPress={() => setShown(true)} />
          )}
          <Button variant="outline" className={OUTLINE_BORDER} label={continuesToNewLines ? s.hifzSecondLookSkipToNew : s.hifzSecondLookSkipForNow} onPress={onSkip} disabled={busy} />
          <Text dir={dir} align="center" variant="caption" className="text-warm-600 dark:text-neutral-400" style={{ lineHeight: 18 }}>
            {/* Skipping skips every look still to come, so the hint counts them. */}
            {total - index > 1 ? s.hifzSecondLooksSkipHint : s.hifzSecondLookSkipHint}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
