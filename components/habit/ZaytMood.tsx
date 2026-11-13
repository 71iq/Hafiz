import { Image } from "react-native";

/**
 * Zayt's moods (5.11). Only warm and calm moods are bundled: the worried, heavy-hearted, sad and
 * discouraged art is never shown in response to a missed day or review (ZAY-01). Static images, so
 * nothing moves for users who reduce motion (ZAY-03).
 */
const MOODS = {
  gentle_welcome: require("../../assets/zayt/zayt-gentle-welcome.png"),
  warm_glow_good: require("../../assets/zayt/zayt-warm-glow-good.png"),
  quiet_shimmer_easy: require("../../assets/zayt/zayt-quiet-shimmer-easy.png"),
  focused_hard: require("../../assets/zayt/zayt-focused-hard.png"),
  compassionate_again: require("../../assets/zayt/zayt-compassionate-again.png"),
  recovering_calm: require("../../assets/zayt/zayt-recovering-calm.png"),
  tired_low_energy: require("../../assets/zayt/zayt-tired-low-energy.png"),
} as const;

export type ZaytMoodName = keyof typeof MOODS;

/** Decorative: the text beside Zayt carries the meaning, so screen readers skip the image. */
export function ZaytMood({ mood, height = 72 }: { mood: ZaytMoodName; height?: number }) {
  return (
    <Image
      source={MOODS[mood]}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      resizeMode="contain"
      style={{ height, width: Math.round(height * 0.62) }}
    />
  );
}
