import { Pressable, View } from "react-native";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Text } from "@/components/ui/Text";
import type { RecitationErrorType } from "@/lib/hifz/errors";
import type { UIStrings } from "@/lib/i18n/strings";

/** The error types a user can mark on a word after reciting (ERR-01), in the order people need them. */
const MARKABLE_TYPES: readonly RecitationErrorType[] = [
  "wrong_word",
  "skip_word",
  "harakah",
  "added_word",
  "skip_ayah",
  "mutashabih_drift",
  "seam",
  "tajweed",
];

export function errorTypeLabel(type: RecitationErrorType, s: UIStrings): string {
  switch (type) {
    case "skip_word":
      return s.hifzErrorSkipWord;
    case "wrong_word":
      return s.hifzErrorWrongWord;
    case "added_word":
      return s.hifzErrorAddedWord;
    case "harakah":
      return s.hifzErrorHarakah;
    case "skip_ayah":
      return s.hifzErrorSkipAyah;
    case "mutashabih_drift":
      return s.hifzErrorDrift;
    case "seam":
      return s.hifzErrorSeam;
    case "tajweed":
      return s.hifzErrorTajweed;
    case "hesitation":
      return s.hifzErrorWrongWord;
    case "waqf_ibtida":
      return s.hifzErrorTajweed;
  }
}

type Props = {
  open: boolean;
  current: RecitationErrorType | null;
  /** The tapped word's reference, so the user knows which word they are marking. */
  subtitle?: string;
  dir: "ltr" | "rtl";
  s: UIStrings;
  onChoose: (type: RecitationErrorType) => void;
  onRemove: () => void;
  onClose: () => void;
};

/** Choose what went wrong on a tapped word, or remove the mark. Described neutrally (ERR-07). */
export function MistakeTypeSheet({ open, current, subtitle, dir, s, onChoose, onRemove, onClose }: Props) {
  return (
    <ResponsiveSheet open={open} onClose={onClose} maxWidth={420} maxHeight={560}>
      <OverlayHeader title={s.hifzMistakeTypeTitle} subtitle={subtitle} onClose={onClose} isRTL={dir === "rtl"} showHandle />
      <OverlayBody contentContainerClassName="px-5 py-4" contentContainerStyle={{ gap: 8 }}>
        {MARKABLE_TYPES.map((type) => {
          const selected = current === type;
          return (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChoose(type)}
              className={`min-h-[46px] justify-center rounded-2xl px-4 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"}`}
            >
              <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className={selected ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-200"}>
                {errorTypeLabel(type, s)}
              </Text>
            </Pressable>
          );
        })}
        {current ? (
          <View className="pt-2">
            <Pressable accessibilityRole="button" onPress={onRemove} className="min-h-[44px] justify-center rounded-2xl px-4">
              <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="text-warm-500 dark:text-neutral-400">
                {s.hifzErrorRemove}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </OverlayBody>
    </ResponsiveSheet>
  );
}
